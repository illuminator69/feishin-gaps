import type {
    LbBotAlbumCandidate,
    LbBotArtistCandidate,
    LbBotDiscography,
    LbBotDownloadResult,
    LbBotFillStatus,
    LbBotGap,
    LbBotGapSource,
    LbBotGapTrackState,
    LbBotMeta,
    LbBotRelease,
    LbBotReleaseDetail,
    LbBotResolvedEdition,
    LbBotResult,
    LbBotSimilarAlbums,
    LbBotSimilarArtists,
    LbBotSourceFiles,
    LbBotTracklist,
} from '/@/shared/types/lbbot-types';

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import isElectron from 'is-electron';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
    useActiveFill,
    useActiveFillsActions,
    useActiveFillsStore,
    useActiveGap,
} from '/@/renderer/features/lbbot/stores/active-fills.store';

/**
 * lb-bot surfaces for the renderer.
 *
 * The contract for every hook here is the same one Tier-2 AudioMuse follows:
 * never on the critical render path, never an error state. A missing hub, an
 * unconfigured LBBOT_URL, an unreachable lb-bot and an unindexed artist all
 * resolve to "render nothing", because the artist page has to look exactly as it
 * does today whenever this layer is absent.
 */

const lbBot = isElectron() ? window.api.lbBot : null;

/** Cover Art Archive front cover for a release-group.
 *
 * Built here rather than proxied: lb-bot's /api/cover serves *Navidrome* art
 * keyed by a Navidrome album id, which by definition does not exist for a
 * release the library doesn't have. The Archive is public, so the client fetches
 * it directly — which also keeps multi-megabyte images out of the hub's cache.
 */
export const caaCoverUrl = (rgid: string, size: 250 | 500 = 250): string =>
    rgid ? `https://coverartarchive.org/release-group/${rgid}/front-${size}` : '';

/**
 * Discography rows with no album of their own on this page.
 *
 * **Not a `status === 'missing'` filter, and it must never become one again.**
 * A completed fill flips lb-bot's index row to `present` while Navidrome still
 * has no album for it, so filtering on `missing` drops the tile out of *both*
 * lists — the album vanishes from the page *because the download succeeded*.
 *
 * The honest question is whether lb-bot matched the row to a Navidrome album, so
 * that is what is asked. `incomplete` rows fall out here for free: they are
 * albums the library owns, they carry their Navidrome ids, and they belong on
 * the owned side with a `9/12` badge rather than as a ghost tile.
 */
export const unownedReleases = (data: LbBotDiscography | null | undefined): LbBotRelease[] =>
    (data?.releases ?? []).filter((release) => release.navidromeAlbumIds.length === 0);

/** An unmatched row lb-bot no longer calls `missing` is a fill that has landed
 *  and is waiting on a Navidrome scan — not something to download again. */
export const isAwaitingLibrary = (release: LbBotRelease): boolean => release.status !== 'missing';

/** Albums the library holds part of, keyed by the Navidrome album ids lb-bot
 *  matched them to — which is how a page or a context menu finds the gap for an
 *  album it already has. Only rows carrying a live review group qualify: without
 *  a `group_id` there is nothing to act on. */
export const gapsByAlbumId = (
    data: LbBotDiscography | null | undefined,
): Map<string, LbBotRelease> => {
    const map = new Map<string, LbBotRelease>();
    for (const release of data?.releases ?? []) {
        if (release.status !== 'incomplete' || !release.groupId) continue;
        for (const albumId of release.navidromeAlbumIds) map.set(albumId, release);
    }
    return map;
};

/**
 * Album titles compared the way a person would: case, accents, punctuation and
 * parenthesised edition suffixes all discarded. "Kid A" and "Kid A (Remastered)"
 * are the same record for this purpose.
 *
 * Deliberately stops there. A dash suffix would be the obvious next rule, but
 * "Hail to the Thief - Live" is a different record from "Hail to the Thief", and
 * the cost of the two mistakes is not symmetric: leaving a duplicate on screen is
 * untidy, while collapsing two real releases hides an album the user cannot then
 * download at all.
 */
const titleKey = (title: string): string =>
    title
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[[({].*?[\])}]/g, '')
        .replace(/[^a-z0-9]+/g, '')
        .trim();

/**
 * Drop missing releases the library demonstrably already has.
 *
 * lb-bot's index only learns a release-group is present when something writes
 * that row — a full MusicBrainz rescan, or a fill completing. Anything else that
 * puts an album in the library (a manual copy, a Fill-gaps run against a
 * different release of the same group, a title lb-bot's matcher didn't
 * recognize) leaves the row saying `missing` while Navidrome plainly has it, and
 * the artist page then shows the same album twice — once real, once greyed out.
 *
 * The index is the wrong place to fix that from here: correcting it means a
 * MusicBrainz walk at one request a second. Navidrome is the authority on what
 * the library holds, and it is already loaded on this page, so reconcile against
 * it at render time and let the next rescan tidy the row.
 */
export const withoutOwned = (releases: LbBotRelease[], ownedTitles: string[]): LbBotRelease[] => {
    if (releases.length === 0 || ownedTitles.length === 0) return releases;
    const owned = new Set(ownedTitles.map(titleKey).filter(Boolean));
    return releases.filter((release) => {
        const key = titleKey(release.title);
        return !key || !owned.has(key);
    });
};

const useLbBotStatus = () =>
    useQuery({
        enabled: !!lbBot,
        gcTime: Infinity,
        queryFn: () => lbBot!.status(),
        queryKey: ['lbbot', 'status'],
        // The hub gaining an LBBOT_URL doesn't restart this app, so don't cache
        // "off" forever — but don't re-probe on every artist page either.
        staleTime: 10 * 60 * 1000,
    });

/** Whether the lb-bot layer is reachable at all. One probe per session. */
export const useLbBotAvailable = (): boolean => useLbBotStatus().data?.available === true;

/**
 * Whether the hub in front of lb-bot proxies a given route.
 *
 * This app ships independently of the hub, and the hub is a long-running process
 * that only picks up an edit when it restarts — so "my client is newer than my
 * hub" is a permanent condition, not an edge case, and without asking it shows
 * up as a button that silently 404s. An **empty** list is an older hub that
 * doesn't advertise at all: assume supported rather than hiding a feature that
 * probably works.
 */
export const useHubSupports = (route: string): boolean => {
    const routes = useLbBotStatus().data?.routes;
    return !routes || routes.length === 0 || routes.includes(route);
};

/**
 * The raw advertised route list, for a caller checking several routes at once.
 *
 * `useHubSupports` is the right shape for one route at a call site; the Discover
 * catalogue asks about a different route per row and would otherwise have to
 * call a hook in a loop.
 */
export const useLbBotStatusRoutes = (): string[] | undefined => useLbBotStatus().data?.routes;

/**
 * An artist's full MusicBrainz discography as lb-bot indexed it.
 *
 * The GET is an instant SQLite read on lb-bot's side keyed by the same Navidrome
 * artist id this page already holds, so it is safe to fire on every page open —
 * the expensive MusicBrainz walk is only ever the explicit POST below.
 */
export const useLbBotDiscography = (ndId: string, mbid?: null | string) => {
    const available = useLbBotAvailable();
    return useQuery({
        enabled: !!lbBot && available && !!ndId,
        queryFn: () => lbBot!.discography(ndId, mbid ?? undefined),
        queryKey: ['lbbot', 'discography', ndId],
        // The hub caches this for 60s; asking more often than that only costs
        // round trips. Refetching on focus would poll lb-bot every alt-tab.
        refetchOnWindowFocus: false,
        staleTime: 60 * 1000,
    });
};

/** Trigger the (slow, rate-limited) MusicBrainz scan for one artist. */
export const useIndexArtist = (ndId: string) => {
    const queryClient = useQueryClient();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');

    const indexArtist = useCallback(
        async (mbid: string, name: string) => {
            if (!lbBot || !mbid || !name) return false;
            setPending(true);
            setError('');
            // What the index says *before* the scan. A rescan of an artist that
            // is already indexed never flips `indexed`, so waiting on that flag
            // alone declared victory on the first tick and dropped the spinner
            // while MusicBrainz was still being walked — which is exactly the
            // case a rescan button exists for.
            const before = queryClient.getQueryData<LbBotDiscography | null>([
                'lbbot',
                'discography',
                ndId,
            ]);
            const previousScan = before?.scannedAt ?? 0;
            const taskId = await lbBot.indexArtist(ndId, mbid, name);
            if (!taskId) {
                setPending(false);
                setError('lb-bot did not start the scan. Is it reachable?');
                return false;
            }
            // A big discography takes 10-60s at MusicBrainz's one-request-a-second.
            // Rather than polling a task, re-read the index a few times and let the
            // shelf appear when it appears — a miss just means "not yet".
            let attempts = 0;
            const tick = window.setInterval(async () => {
                attempts += 1;
                const data = await queryClient.fetchQuery({
                    queryFn: () => lbBot!.discography(ndId, mbid),
                    queryKey: ['lbbot', 'discography', ndId],
                });
                const rescanned = (data?.scannedAt ?? 0) > previousScan;
                // A failed scan used to be invisible: the index simply never
                // changed, the spinner ran out after 100 s, and the page said
                // nothing. lb-bot now keeps the old discography and says why.
                const scan = data?.scan;
                // Matched by task id, not time: lb-bot's clock is not this one.
                const failed = scan?.state === 'failed' && scan.taskId === taskId;
                if (failed) setError(scan.error || 'The discography scan failed.');
                // A scan that retries MusicBrainz can take a few minutes; the
                // scan record says when it is really over, so waiting is cheap.
                if ((data?.indexed && rescanned) || failed || attempts >= 60) {
                    window.clearInterval(tick);
                    setPending(false);
                }
            }, 5000);
            return true;
        },
        [ndId, queryClient],
    );

    return { error, indexArtist, pending };
};

/**
 * Teach the index about one release-group, then re-read the discography.
 *
 * The case this exists for is constant rather than rare: lb-bot serves a stored
 * discography immediately even when stale *by design*, so a release published
 * since the last scan is simply absent — which is every row the Fresh tab leads
 * to. A full rescan for one album is a MusicBrainz request per second per
 * release-group, so it is never the answer here.
 *
 * Fires once per rgid and remembers that it did, including on failure: this runs
 * from a render effect on a page the user is looking at, and a route that is not
 * there (an older hub) or a MusicBrainz outage would otherwise retry forever.
 */
export const useIndexRelease = (ndId: string, artistMbid: string) => {
    const queryClient = useQueryClient();
    const tried = useRef(new Set<string>());

    return useCallback(
        async (
            rgid: string,
            opts: {
                artist?: string;
                external?: boolean;
                name?: string;
                title?: string;
                type?: string;
                year?: string;
            } = {},
        ) => {
            if (!lbBot || !rgid || tried.current.has(rgid)) return false;
            if (!artistMbid && !ndId) return false;
            tried.current.add(rgid);
            const result = await lbBot.indexRelease({
                artist: opts.artist,
                external: opts.external,
                mbid: artistMbid,
                name: opts.name,
                ndId,
                rgid,
                title: opts.title,
                type: opts.type,
                year: opts.year,
            });
            if (!result.ok) return false;
            await queryClient.invalidateQueries({ queryKey: ['lbbot', 'discography', ndId] });
            return true;
        },
        [ndId, artistMbid, queryClient],
    );
};

/**
 * Site-wide fresh releases, recent and upcoming.
 *
 * Unrelated to the home page's carousels, which query the user's own library.
 * lb-bot caches the ListenBrainz feed for an hour and the hub for a minute, so
 * this is cheap to re-enter — but there is nothing to poll for either.
 */
export const useLbBotFreshReleases = (days: number) => {
    const available = useLbBotAvailable();
    return useQuery({
        enabled: !!lbBot && available,
        queryFn: () => lbBot!.freshReleases(days),
        queryKey: ['lbbot', 'fresh-releases', days],
        refetchOnWindowFocus: false,
        staleTime: 10 * 60 * 1000,
    });
};

/**
 * MusicBrainz artist search — the "Not in your library" half of search.
 *
 * Until `/lb/artist/lookup` was whitelisted, a client could only reach an
 * external artist page if it already held an MBID from a Fresh row, which
 * blocked every acquisition path that starts with "I want this artist".
 *
 * Deliberately not fired on every keystroke: it is a live MusicBrainz search
 * behind lb-bot's global 1 req/sec lock, so the caller passes the *debounced*
 * query and short queries are skipped outright.
 */
const LOOKUP_MIN_LENGTH = 3;

export const useLbBotArtistLookup = (query: string, enabled = true) => {
    const available = useLbBotAvailable();
    const term = query.trim();
    return useQuery<LbBotArtistCandidate[]>({
        enabled: !!lbBot && available && enabled && term.length >= LOOKUP_MIN_LENGTH,
        queryFn: () => lbBot!.artistLookup(term),
        queryKey: ['lbbot', 'artist-lookup', term],
        refetchOnWindowFocus: false,
        // A search ranking, not an entity — but stable enough within a session
        // that retyping the same term should not cost another MusicBrainz second.
        staleTime: 10 * 60 * 1000,
    });
};

/**
 * MusicBrainz album search — the other half of "Not in your library".
 *
 * Same 1 req/sec lock, so the same rules: debounced term only, and nothing
 * shorter than {@link LOOKUP_MIN_LENGTH}. Note both lookups share that one
 * global second, so a search box firing them together spends two.
 *
 * Unlike the artist lookup, an owned hit is *not* dropped and not routed
 * externally: lb-bot marks ownership by release-group id, which is exact, and
 * `releaseAlbumId` is where the tap goes.
 */
export const useLbBotAlbumLookup = (query: string, enabled = true) => {
    const available = useLbBotAvailable();
    const term = query.trim();
    return useQuery<LbBotAlbumCandidate[]>({
        enabled: !!lbBot && available && enabled && term.length >= LOOKUP_MIN_LENGTH,
        queryFn: () => lbBot!.albumLookup(term),
        queryKey: ['lbbot', 'album-lookup', term],
        refetchOnWindowFocus: false,
        staleTime: 10 * 60 * 1000,
    });
};

/**
 * "Similar albums" for an album page.
 *
 * lb-bot has answered this route since the Fresh work shipped and no client has
 * ever called it — step 5 of DESIGN-lbbot-client-integration.md, left unticked.
 *
 * It needs the *artist*, not the album: similarity is computed artist-to-artist
 * (ListenBrainz, cross-checked with Last.fm) and rolled up to one album each.
 * `rgid` only excludes the album you are on, and lb-bot backfills the slot.
 *
 * Empty is the common case on a small or unindexed library, and it is not an
 * error — the shelf renders nothing.
 */
export const useLbBotSimilarAlbums = (args: {
    artistMbid?: null | string;
    artistName?: null | string;
    rgid?: null | string;
}) => {
    const available = useLbBotAvailable();
    const { artistMbid, artistName, rgid } = args;
    return useQuery<LbBotSimilarAlbums | null>({
        enabled: !!lbBot && available && !!(artistMbid || artistName),
        queryFn: () =>
            lbBot!.albumSimilar({
                artistMbid: artistMbid ?? undefined,
                artistName: artistName ?? undefined,
                rgid: rgid ?? undefined,
            }),
        queryKey: ['lbbot', 'album-similar', artistMbid || artistName, rgid],
        refetchOnWindowFocus: false,
        // The hub holds this for hours and lb-bot caches the similarity for 24h.
        staleTime: 60 * 60 * 1000,
    });
};

/**
 * "Fans also like" — similar artists, the ones you do not own included.
 *
 * The sibling `useLbBotSimilarAlbums` is deliberately a shelf of records you
 * already have. This is the other reading of the same merge: lb-bot marks each
 * row `owned` / `indexed` rather than filtering, so the unowned artists — the
 * point of a Discover row — survive to the client.
 *
 * Gated on `useHubSupports` as well as availability: the route is newer than
 * some hubs, and a hub that has not been restarted answers 404, which
 * `describeFailure` reports as "the hub is older than this app".
 *
 * Empty is the common case on a cold library and is not an error.
 */
export const useLbBotSimilarArtists = (args: {
    limit?: number;
    mbid?: null | string;
    name?: null | string;
}) => {
    const available = useLbBotAvailable();
    const supported = useHubSupports('GET /lb/artist/similar');
    const { limit, mbid, name } = args;
    return useQuery<LbBotSimilarArtists | null>({
        enabled: !!lbBot && available && supported && !!(mbid || name),
        queryFn: () =>
            lbBot!.artistSimilar({
                limit,
                mbid: mbid ?? undefined,
                name: name ?? undefined,
            }),
        queryKey: ['lbbot', 'artist-similar', mbid || name, limit],
        refetchOnWindowFocus: false,
        // lb-bot caches the merge for 24h; what moves inside that window is the
        // ownership marking, which the hub keeps on its short TTL. An hour here
        // is well inside both and saves re-asking as the row's seed rotates
        // back around.
        staleTime: 60 * 60 * 1000,
    });
};

/**
 * Editorial "About" for an artist: the real, full-length, attributed text this
 * page has never had — Navidrome's Last.fm agent returns a summary that ends in
 * a "Read more on Last.fm" anchor and nothing else.
 *
 * `mbid` is strongly preferred; passing only a name costs lb-bot a MusicBrainz
 * search and takes its top hit, which for a generically-named artist is a
 * coin toss. Both are accepted because Navidrome does not always carry an MBID.
 *
 * `staleTime: Infinity` — the text is an encyclopaedia article, lb-bot caches it
 * for 30 days and the hub for six hours. Asking again within a session is pure
 * round trip.
 */
export const useLbBotArtistMeta = (mbid?: null | string, name?: null | string) => {
    const available = useLbBotAvailable();
    return useQuery<LbBotMeta | null>({
        enabled: !!lbBot && available && !!(mbid || name),
        queryFn: () =>
            lbBot!.metaArtist({
                mbid: mbid ?? undefined,
                name: mbid ? undefined : (name ?? undefined),
            }),
        queryKey: ['lbbot', 'meta-artist', mbid || `name:${name}`],
        refetchOnWindowFocus: false,
        staleTime: Infinity,
    });
};

/** The same for a release-group, plus release credits. `releaseMbid` is an
 *  optimisation, not a requirement: it saves lb-bot resolving the canonical
 *  release at one rate-limited MusicBrainz request per second. */
export const useLbBotAlbumMeta = (rgid?: null | string, releaseMbid?: null | string) => {
    const available = useLbBotAvailable();
    return useQuery<LbBotMeta | null>({
        enabled: !!lbBot && available && !!rgid,
        queryFn: () => lbBot!.metaAlbum({ releaseMbid: releaseMbid ?? undefined, rgid: rgid! }),
        queryKey: ['lbbot', 'meta-album', rgid],
        refetchOnWindowFocus: false,
        staleTime: Infinity,
    });
};

/** Editions of one release-group. Sits on MusicBrainz upstream — show a skeleton. */
export const useLbBotAlbumReleases = (rgid: null | string) =>
    useQuery<LbBotReleaseDetail | null>({
        enabled: !!lbBot && !!rgid,
        queryFn: () => lbBot!.albumReleases(rgid!),
        queryKey: ['lbbot', 'album-releases', rgid],
        // Which editions a release-group has does not change; the hub holds this
        // for hours and there is no reason for the renderer to ask again.
        staleTime: Infinity,
    });

/** Canonical tracklist for one release. */
export const useLbBotTracklist = (releaseMbid: null | string) =>
    useQuery<LbBotTracklist | null>({
        enabled: !!lbBot && !!releaseMbid,
        queryFn: () => lbBot!.albumTracklist(releaseMbid!),
        queryKey: ['lbbot', 'tracklist', releaseMbid],
        staleTime: Infinity,
    });

/** States nothing further will happen from. `placed` is deliberately absent:
 *  the interesting transition is placed → verified, which is Navidrome
 *  confirming the files are actually in the library. */
const TERMINAL_STATES = new Set(['failed', 'needs_match', 'verified']);

/** How many "unknown" answers to accept before giving up on a fill.
 *
 *  `unknown` is ambiguous: it is both "this release has no fill" and "the
 *  download POST returned but lb-bot's worker thread hasn't written its first
 *  ledger row yet", which is the normal first second or two after a tap. Treating
 *  it as terminal stopped the poll before the fill had started; treating it as
 *  live forever would poll a release nobody is filling. So: bounded patience. */
const UNKNOWN_POLL_LIMIT = 18; // ≈90s at the 5s interval below

/** Upper bound on how long one tile keeps watching a fill it started. */
const WATCH_TIMEOUT_MS = 20 * 60 * 1000;

/** The poll floor, and how many identical answers it takes to step off it. */
const POLL_BASE_MS = 5000;
const QUIET_TICKS_FIRST = 4;
const QUIET_TICKS_SECOND = 10;

/**
 * How long before the next poll, given how many consecutive identical answers.
 *
 * Five seconds stays the answer for anything that is moving. But the data behind
 * these routes only changes when lb-bot's own sixty-second transfer poll runs, so
 * a download in progress is mostly re-reading a body it already has. An unchanged
 * payload is free information: back off, and snap back the moment it differs.
 */
const pollInterval = (quietTicks: number): number => {
    if (quietTicks < QUIET_TICKS_FIRST) return POLL_BASE_MS;
    if (quietTicks < QUIET_TICKS_SECOND) return POLL_BASE_MS * 2;
    return POLL_BASE_MS * 4;
};

/**
 * Poll one release's fill.
 *
 * `enabled` is the caller's "is the sheet open" — polling continues only while
 * something is on screen to show it, and stops on a terminal state. `placed` is
 * deliberately not terminal: the interesting transition is placed → verified,
 * which is Navidrome confirming the files are actually in the library.
 */
export const useLbBotFillStatus = (releaseMbid: null | string, enabled: boolean) => {
    const queryClient = useQueryClient();
    const queryKey = ['lbbot', 'album-status', releaseMbid];
    // Consecutive unknowns, and consecutive *identical* answers. Both have to be
    // counted outside the query data — react-query's own counters answer "how many
    // fetches", which is a different question from either of these.
    const ticks = useRef({ quiet: 0, unknown: 0 });
    return useQuery<LbBotFillStatus>({
        enabled: !!lbBot && !!releaseMbid && enabled,
        queryFn: async () => {
            const next = await lbBot!.albumStatus(releaseMbid!);
            // This poll's read is fail-soft, so a transient upstream failure —
            // and 502 here usually means lb-bot is *busy*, holding its
            // process-wide lock, rather than gone — arrives as `unknown`. Once a
            // fill has been seen, `unknown` is a failed tick and not a fill that
            // stopped existing, and showing it would flip a downloading tile
            // back to "not in library" for five seconds. Keep the last real
            // answer; the next tick corrects it either way.
            const previous = queryClient.getQueryData<LbBotFillStatus>(queryKey);
            const stale = next.state === 'unknown' && previous && previous.state !== 'unknown';
            const answer = stale ? previous : next;

            // `unknown` only means "give up" when it keeps saying so. It used to be
            // counted with `dataUpdateCount`, which counts every successful fetch —
            // so after ninety seconds of healthy polling any single tick that read
            // `unknown` stopped the watch on a fill that was still running.
            ticks.current.unknown = answer.state === 'unknown' ? ticks.current.unknown + 1 : 0;

            // lb-bot refreshes slskd's transfer state every sixty seconds and this
            // route just reads the counters that loop last wrote, so a long download
            // spends eleven ticks in twelve returning a byte-identical body — each
            // one taking the process-wide lock lb-bot's own 2s-polling SPA is on.
            const same =
                previous &&
                previous.state === answer.state &&
                previous.done === answer.done &&
                previous.total === answer.total &&
                previous.failed === answer.failed;
            ticks.current.quiet = same ? ticks.current.quiet + 1 : 0;

            return answer;
        },
        queryKey,
        // Never tighter than five seconds — lb-bot is one Python process with a
        // process-wide lock and its own 2s-polling SPA already on it — and slower
        // than that once nothing is changing. Any difference at all snaps it back.
        refetchInterval: (query) => {
            const state = query.state.data?.state ?? 'unknown';
            if (TERMINAL_STATES.has(state)) return false;
            if (state === 'unknown' && ticks.current.unknown > UNKNOWN_POLL_LIMIT) return false;
            return pollInterval(ticks.current.quiet);
        },
        staleTime: 0,
    });
};

export const startAlbumDownload = async (
    rgid: string,
    quality?: string,
    source?: { folder: string; peer: string },
    edition?: LbBotResolvedEdition,
    excludeUsers?: string[],
    /** Names for the ledger row when no edition was resolved to supply them —
     *  a one-tap acquire has the title and artist from whatever row it was
     *  fired from, and without them the downloads view captions the row with a
     *  release-group id. */
    names?: { album?: string; artist?: string },
): Promise<LbBotDownloadResult> => {
    if (!lbBot) {
        return {
            error: 'lb-bot is not available.',
            existing: false,
            ok: false,
            releaseMbid: '',
            status: 0,
        };
    }
    const result = await lbBot.downloadAlbum(rgid, quality, source, edition, excludeUsers);
    if (result.ok) {
        // Registered here rather than in the sheet: the fill takes minutes, and
        // the page behind the sheet is what has to keep watching it. The edition's
        // artist and title ride along so the downloads view can name the row even
        // after lb-bot (whose ledger is in memory) has forgotten the fill.
        useActiveFillsStore.getState().actions.start(rgid, result.releaseMbid, quality ?? '', {
            album: edition?.title || names?.album,
            artist: edition?.artist || names?.artist,
            // The whole edition, not just its display fields: a Retry has to re-send
            // it or lb-bot re-resolves the group and the chosen pressing is lost.
            edition,
            excludedPeers: excludeUsers,
            sourceFolder: source?.folder,
            sourcePeer: source?.peer,
        });
    }
    return result;
};

/**
 * Why a one-tap acquire did not fire, in the terms the caller has to explain.
 *
 * `review` is not a failure — it is the picker doing its job. Every reason here
 * is a question only the user can answer.
 */
export type AcquireOutcome =
    | { format: string; kind: 'started'; peer: string; result: LbBotDownloadResult }
    | {
          kind: 'review';
          reason: 'incomplete' | 'noSources' | 'unavailable' | 'uncertainMatch' | 'wrongFormat';
      };

/** Formats a lossless preference is actually satisfied by. */
const LOSSLESS = /^(flac|alac|wav|aiff|ape|wv)$/i;

/**
 * Star-on-an-unowned-row: acquire in one gesture, but never blind.
 *
 * lb-bot's own documentation records why the blind version was removed — it
 * fetched the wrong record for a self-titled album, where every candidate
 * folder's name looks plausible, and nothing before or after the fact said so.
 * That is what `/lb/album/sources` and the two-step picker exist for. So this
 * reviews on the user's behalf and only fires when there is nothing left to
 * decide: lb-bot's top-ranked folder, its own "is this the right record"
 * verdict, and complete coverage **against the canonical MusicBrainz tracklist
 * rather than a file count**. Anything else returns `review` and the caller
 * opens the picker.
 *
 * Two things it is easy to get wrong here:
 *
 * 1. **It is one gesture, not an instant result.** `/lb/album/sources` is a
 *    live slskd fan-out and takes 30-90s. The caller has to show that, because
 *    the ledger has nothing to show until the download is actually posted.
 * 2. **Quality is a ranking term upstream, not a filter**, so the top-ranked
 *    folder can legitimately be MP3 when the preference is FLAC. The preference
 *    itself lives in lb-bot when it is the default (`''`), so there is nothing
 *    to check against — but when the user has picked a *lossless* one on this
 *    client, a lossy top pick is exactly the surprise the source row exists to
 *    prevent, and it goes to the picker instead.
 *
 * The sources fetch is keyed identically to {@link useLbBotAlbumSources}, so the
 * picker this falls through to opens on the answer already in hand rather than
 * starting a second search.
 */
export const useAcquireAlbum = () => {
    const queryClient = useQueryClient();
    return useCallback(
        async (release: {
            artist?: string;
            rgid: string;
            title?: string;
        }): Promise<AcquireOutcome> => {
            if (!lbBot || !release.rgid) return { kind: 'review', reason: 'unavailable' };

            const answer = await queryClient.fetchQuery<LbBotResult<LbBotGapSource[]>>({
                queryFn: () => lbBot!.albumSources(release.rgid),
                queryKey: ['lbbot', 'album-sources', release.rgid, ''],
                staleTime: 60 * 1000,
            });
            const sources = answer?.ok ? (answer.data ?? []) : null;
            if (!sources) return { kind: 'review', reason: 'unavailable' };

            const top = sources[0];
            if (!top) return { kind: 'review', reason: 'noSources' };
            if (!top.albumMatchOk) return { kind: 'review', reason: 'uncertainMatch' };
            if (!top.coverageFull || top.coverageDetail.totalTracks <= 0) {
                return { kind: 'review', reason: 'incomplete' };
            }

            const quality = useActiveFillsStore.getState().preferredQuality;
            const wantsLossless = quality === 'flac-16-44' || quality === 'flac-any';
            if (wantsLossless && !LOSSLESS.test((top.format || '').trim())) {
                return { kind: 'review', reason: 'wrongFormat' };
            }

            const result = await startAlbumDownload(
                release.rgid,
                quality,
                { folder: top.folder, peer: top.peer },
                undefined,
                undefined,
                { album: release.title, artist: release.artist },
            );
            return { format: top.format, kind: 'started', peer: top.peer, result };
        },
        [queryClient],
    );
};

/**
 * Drop everything this artist page derives from the library, in both directions.
 *
 * A landed album changes two independent answers at once — Navidrome now has an
 * album it didn't, and lb-bot no longer counts that release-group as missing —
 * and showing one without the other is exactly the double-listing this fixes.
 */
const PLACED_FALLBACK_REFRESH_MS = 20_000;

export const useLbBotLibraryRefresh = () => {
    const queryClient = useQueryClient();
    return useCallback(
        (ndArtistId?: string, landing?: LbBotLibraryLanding) => {
            // The hub drops its cached discography before it broadcasts, so this
            // re-read is lb-bot's live answer rather than a minute-old copy.
            if (landing?.event === 'artistScanned' && landing.ndArtistId) {
                // A scan changes one artist's index and nothing in Navidrome.
                void queryClient.invalidateQueries({
                    queryKey: ['lbbot', 'discography', landing.ndArtistId],
                });
                return;
            }
            void queryClient.invalidateQueries({ queryKey: ['lbbot', 'discography'] });
            if (ndArtistId) {
                void queryClient.invalidateQueries({
                    queryKey: ['lbbot', 'discography', ndArtistId],
                });
            }
            if (landing?.event === 'artistScanned') return;
            // `albumPlaced` fires before Navidrome's scan, so re-reading the
            // library then only fetches it as it was. `albumIndexed` follows
            // once Navidrome has the album and is the one worth a refetch.
            const invalidateLibrary = () =>
                void queryClient.invalidateQueries({
                    predicate: (query) =>
                        query.queryKey[1] === 'albums' || query.queryKey[1] === 'albumArtists',
                });
            if (landing?.event === 'albumPlaced') {
                // An lb-bot predating `albumIndexed` never sends the follow-up,
                // so still look once its quick scan has plausibly finished.
                window.setTimeout(invalidateLibrary, PLACED_FALLBACK_REFRESH_MS);
                return;
            }
            invalidateLibrary();
        },
        [queryClient],
    );
};

/** What a `library` frame (or the local fill poll) says landed. */
export interface LbBotLibraryLanding {
    /** `albumPlaced` (files placed, not scanned), `albumIndexed` (Navidrome has
     *  it) or `artistScanned` (a discography scan finished or failed). */
    event?: string;
    ndAlbumIds?: string[];
    ndArtistId?: string;
}

/**
 * Watch one tile's fill: poll while it is live, and refresh the page once it
 * lands. Returns undefined for a release nobody started, which is nearly all of
 * them — the hook costs nothing until the user acts.
 */
export const useWatchedFill = (rgid: string, ndArtistId: string) => {
    const fill = useActiveFill(rgid);
    const { describe, settle } = useActiveFillsActions();
    const refresh = useLbBotLibraryRefresh();

    const status = useLbBotFillStatus(fill?.releaseMbid ?? null, !!fill && !fill.settled);
    const state = status.data?.state;
    // The effect below re-runs on every poll. Refreshing on each tick that
    // merely *reads* placed/verified re-fetched the whole page every 5-20 s.
    const refreshedFor = useRef<string | undefined>(undefined);

    useEffect(() => {
        if (!fill || fill.settled || !state) return;

        // Fold what the poll knows into the ledger row, so the downloads view can
        // name the album without a second read — and can still name it after
        // lb-bot has forgotten the fill, its own record being in memory.
        describe(fill.rgid, {
            album: status.data?.album,
            artist: status.data?.artist,
            attempts: status.data?.attempts,
            // What kind of failure, and whether a plain Retry is worth offering.
            // These come from lb-bot; the alternative was matching on the wording
            // of `reason`, which is a sentence written for a human.
            failureKind: status.data?.failureKind,
            // The only place an album fill ever learns its review group id, and
            // therefore the only thing that can make Allow MP3 do anything at all.
            groupId: status.data?.groupId,
            lastSource: status.data?.source,
            mp3WouldHelp: status.data?.mp3WouldHelp,
            retryable: status.data?.retryable,
            state,
        });

        // `placed` says the files are in the library folder. Navidrome may not
        // have indexed them yet — that's what `verified` is for — but refreshing
        // now is what makes the album appear the moment its scan finishes,
        // rather than a minute later.
        if ((state === 'placed' || state === 'verified') && refreshedFor.current !== state) {
            refreshedFor.current = state;
            refresh(ndArtistId, {
                event: state === 'verified' ? 'albumIndexed' : 'albumPlaced',
            });
        }

        // lb-bot gives up verifying after ten minutes and leaves the fill on
        // `placed` forever. Without a wall clock of our own that is a poll with
        // no end, so stop watching well after anything could still happen.
        const expired = Date.now() - fill.startedAt > WATCH_TIMEOUT_MS;
        if (TERMINAL_STATES.has(state)) {
            settle(fill.rgid, {
                attempts: status.data?.attempts,
                failureKind: status.data?.failureKind,
                mp3WouldHelp: status.data?.mp3WouldHelp,
                outcome:
                    state === 'verified'
                        ? 'done'
                        : status.data?.failureKind === 'cancelled'
                          ? 'cancelled'
                          : 'failed',
                reason: status.data?.reason,
                retryable: status.data?.retryable,
                state,
            });
        } else if (expired) {
            // Ran out of clock rather than failed — a different thing, and worth
            // saying so: nothing is known to have gone wrong.
            settle(fill.rgid, { outcome: 'gaveUp', state });
        }
    }, [fill, state, status.data, settle, describe, refresh, ndArtistId]);

    return fill ? status.data : undefined;
};

export const allowMp3ForAlbum = async (groupId: string): Promise<boolean> =>
    lbBot ? lbBot.allowMp3(groupId, true) : false;

// ---------------------------------------------------------------------------
// Reviewing a source before committing to it
// ---------------------------------------------------------------------------

/**
 * How many consecutive failed polls to absorb before saying anything.
 *
 * lb-bot takes a process-wide lock on *every* route, and the hub's proxy timeout
 * is the only thing separating "slow" from "502" — so an ordinary poll can fail
 * while a large search holds that lock. The poll is retried in five seconds
 * anyway; blanking a modal for one bad tick is the defect, not the tick.
 */
const TRANSIENT_FAILURE_LIMIT = 2;

/**
 * Keep the last good payload across transient upstream failures, and surface an
 * error only once they stop looking transient.
 *
 * The ref is written during render rather than in an effect so the very first
 * result is already reflected in what this returns; guarding on the result's
 * identity keeps that idempotent under React's double-render.
 */
const useToleratedResult = <T>(result: LbBotResult<T> | undefined) => {
    const state = useRef<{ data: null | T; failures: number; seen: unknown }>({
        data: null,
        failures: 0,
        seen: null,
    });
    if (result && result !== state.current.seen) {
        state.current.seen = result;
        if (result.ok) {
            state.current.data = result.data;
            state.current.failures = 0;
        } else {
            state.current.failures += 1;
        }
    }
    return {
        data: state.current.data,
        error: state.current.failures > TRANSIENT_FAILURE_LIMIT ? (result?.error ?? '') : '',
    };
};

/**
 * The ranked Soulseek folders for one release-group.
 *
 * Fired only when the user asks — it is a live slskd fan-out and takes 30-90s.
 * The hub caches it briefly, so re-opening the modal doesn't start another
 * search, which is why the query is kept fresh here for the same span.
 */
export const useLbBotAlbumSources = (
    rgid: null | string,
    enabled: boolean,
    edition?: LbBotResolvedEdition,
) => {
    const query = useQuery<LbBotResult<LbBotGapSource[]>>({
        enabled: !!lbBot && !!rgid && enabled,
        gcTime: 5 * 60 * 1000,
        queryFn: () => lbBot!.albumSources(rgid!, edition),
        // Keyed on the edition too: two pressings of the same group are two
        // different searches, and re-using one's answer for the other is exactly
        // the wrong-record mistake this screen exists to prevent.
        queryKey: ['lbbot', 'album-sources', rgid, edition?.releaseMbid ?? ''],
        retry: false,
        staleTime: 60 * 1000,
    });
    return {
        error: query.data && !query.data.ok ? query.data.error : '',
        isLoading: query.isFetching,
        refetch: query.refetch,
        sources: query.data?.ok ? (query.data.data ?? []) : null,
    };
};

/** Track states that mean "nothing further is coming for this slot". */
const SETTLED_TRACK_STATES: ReadonlySet<LbBotGapTrackState> = new Set<LbBotGapTrackState>([
    'done',
    'downloaded',
    'skipped',
]);

/**
 * Fill progress, counted off the tracks rather than off a task.
 *
 * A gap fill is per-track and has no single transfer to report, so this is the
 * only honest measure. **Measured against the tracks actually being filled, not
 * the album's length**: progress against 17 when only 12 were queued stalls at
 * 12/17 and reads as a hang.
 */
export const gapProgress = (gap: LbBotGap | null | undefined) => {
    const wanted = (gap?.tracks ?? []).filter((track) => track.state !== 'present');
    const done = wanted.filter((track) => SETTLED_TRACK_STATES.has(track.state));
    const failed = wanted.filter((track) => track.state === 'failed');
    return {
        done: done.length,
        failed: failed.length,
        percent: wanted.length ? Math.round((done.length / wanted.length) * 100) : 0,
        wanted: wanted.length,
    };
};

/**
 * Is anything still happening to this gap?
 *
 * **Gated on `sourceTask.status`, which is the whole trap of this API.** The
 * search POST approves the group's pending tracks and *then* starts the
 * background search, so the very next poll reads `picking` with an empty source
 * list — and `picking` otherwise means "lb-bot wants a decision in its own match
 * workspace", a terminal, stop-polling state. Treating it as terminal here
 * settled the watch one tick after the press, so results arriving thirty seconds
 * later were never read and the modal sat on "asking slskd" until the user
 * pressed again. While the task is running, nothing the group says about itself
 * is final.
 *
 * Note the states tested for: lb-bot ends tasks `complete` or `error` — **never
 * `finished`**, which is a spelling that made an empty search indistinguishable
 * from one still running.
 */
export const gapIsBusy = (gap: LbBotGap | null | undefined): boolean => {
    if (!gap) return false;
    const task = gap.sourceTask?.status;
    if (task === 'queued' || task === 'running') return true;
    if (gap.status === 'downloading') return true;
    // Only a real transfer counts. **`picked` is not one** — it is lb-bot's
    // word for decision `approved` / `source_pending`, which is what the search
    // POST flips every missing track to before it starts looking. So `picked`
    // is precisely the state in which the user must be able to choose a source,
    // and treating it as in-flight disabled the Fill button forever: sources
    // listed, nothing clickable, no error to explain it.
    return gap.tracks.some((track) => track.state === 'downloading' || track.state === 'queued');
};

/**
 * One review group, polled while something is on screen to show it.
 *
 * Polls unconditionally rather than trying to be clever about when to stop: the
 * expensive mistake on this API is settling *early* (see `gapIsBusy`), the modal
 * only exists while the user is looking at it, and five seconds is the floor
 * lb-bot's single process and process-wide lock can afford anyway.
 */
export const useLbBotGap = (groupId: null | string, enabled: boolean) => {
    const queryClient = useQueryClient();
    const queryKey = ['lbbot', 'gap', groupId];
    const quiet = useRef(0);
    const query = useQuery<LbBotResult<LbBotGap>>({
        enabled: !!lbBot && !!groupId && enabled,
        // A failed tick must not blank the modal while the retry is pending.
        placeholderData: keepPreviousData,
        queryFn: async () => {
            const previous = queryClient.getQueryData<LbBotResult<LbBotGap>>(queryKey)?.data;
            const next = await lbBot!.gap(groupId!);
            // Per-track states are the whole of a gap's progress, so they are what
            // the "has anything moved?" digest is built from. Same reason as the
            // album path: most ticks re-read a body that has not changed.
            const digest = (gap: LbBotGap | null | undefined) =>
                gap
                    ? `${gap.status}|${gap.sourceTask?.status}|${gap.tracks.map((t) => t.state).join('')}`
                    : '';
            quiet.current = digest(previous) === digest(next.data) ? quiet.current + 1 : 0;
            return next;
        },
        queryKey,
        refetchInterval: () => pollInterval(quiet.current),
        retry: false,
        staleTime: 0,
    });
    const tolerated = useToleratedResult(query.data);
    return {
        error: tolerated.error,
        gap: tolerated.data,
        isLoading: query.isFetching && !tolerated.data,
        refetch: query.refetch,
    };
};

/**
 * A source's real folder listing, fetched when it is expanded and kept.
 *
 * `/lb/gap` has these stripped by the hub — lb-bot embeds every ranked source's
 * entire peer listing, ten to a page, on a path polled every five seconds. So
 * they are fetched per source, once, on demand. Cached for the life of the modal
 * because expanding a row twice must not re-walk the peer's directory.
 */
export const useGapSourceFiles = (groupId: null | string) => {
    const [expanded, setExpanded] = useState<Record<number, boolean>>({});
    const [files, setFiles] = useState<Record<number, LbBotResult<LbBotSourceFiles>>>({});
    const [loading, setLoading] = useState<Record<number, boolean>>({});

    const toggle = useCallback(
        async (index: number) => {
            const isOpen = expanded[index];
            setExpanded((prev) => ({ ...prev, [index]: !isOpen }));
            if (isOpen || files[index] || !lbBot || !groupId) return;
            setLoading((prev) => ({ ...prev, [index]: true }));
            const result = await lbBot.gapSourceFiles(groupId, index);
            setFiles((prev) => ({ ...prev, [index]: result }));
            setLoading((prev) => ({ ...prev, [index]: false }));
        },
        [expanded, files, groupId],
    );

    return { expanded, files, loading, toggle };
};

// ---------------------------------------------------------------------------
// Gap actions
// ---------------------------------------------------------------------------

const NO_CLIENT: LbBotResult<boolean> = {
    data: null,
    error: 'lb-bot is not available.',
    ok: false,
    status: 0,
};

export const searchGapSources = (groupId: string, force = false): Promise<LbBotResult<boolean>> =>
    lbBot ? lbBot.gapSearch(groupId, force) : Promise.resolve(NO_CLIENT);

export const autoFillGap = (groupId: string): Promise<LbBotResult<boolean>> =>
    lbBot ? lbBot.gapAuto(groupId) : Promise.resolve(NO_CLIENT);

export const fetchGapSource = (groupId: string, sourceId: number): Promise<LbBotResult<boolean>> =>
    lbBot ? lbBot.gapFetch(groupId, sourceId) : Promise.resolve(NO_CLIENT);

export const cancelGapFill = (groupId: string): Promise<LbBotResult<boolean>> =>
    lbBot ? lbBot.gapCancel(groupId) : Promise.resolve(NO_CLIENT);

export const rescanGapAlbum = (groupId: string): Promise<LbBotResult<boolean>> =>
    lbBot ? lbBot.gapRescan(groupId) : Promise.resolve(NO_CLIENT);

/**
 * How long a fresh gap watch refuses to settle, whatever the group says.
 *
 * The same bounded patience `UNKNOWN_POLL_LIMIT` gives an album download, for
 * the same reason: the POST returns before lb-bot's worker has written anything,
 * so a group that has just been asked to fill still looks idle.
 */
const GAP_SETTLE_GRACE_MS = 90 * 1000;

/**
 * Watch a gap fill from the page rather than from the modal.
 *
 * A fill takes minutes and outlives the modal that started it, so — exactly like
 * an album download — the watch lives in the persisted store and the shelf keeps
 * polling. Returns undefined for a gap nobody started, which is nearly all of
 * them, so the hook costs nothing until the user acts.
 */
export const useWatchedGap = (groupId: string, ndArtistId: string) => {
    const watch = useActiveGap(groupId);
    const { describe, settleGap } = useActiveFillsActions();
    const refresh = useLbBotLibraryRefresh();

    const { gap } = useLbBotGap(groupId || null, !!watch && !watch.settled);
    // Once per completion, not once per poll — see useWatchedFill.
    const refreshedComplete = useRef(false);

    useEffect(() => {
        if (!watch || watch.settled || !gap) return;

        // As on the album path: keep the ledger row able to name itself, so the
        // downloads view needs no read of its own.
        describe(groupId, {
            album: gap.album,
            artist: gap.artist,
            mp3WouldHelp: gap.mp3WouldHelp,
            state: gap.status,
        });

        // `complete` means the tracks are in the album folder; the discography
        // row and Navidrome's own list both have to be re-read or the album
        // double-lists.
        if (gap.status === 'complete' && !refreshedComplete.current) {
            refreshedComplete.current = true;
            refresh(ndArtistId);
        }

        const age = Date.now() - watch.startedAt;
        if (age > WATCH_TIMEOUT_MS) {
            settleGap(groupId, { outcome: 'gaveUp', state: gap.status });
            return;
        }
        // Two guards before calling it over, and both are the same lesson in
        // different clothes: this API looks idle before it is busy. lb-bot writes
        // its first ledger rows after the POST returns, so an early poll shows a
        // group that has been asked to do something and isn't yet doing it —
        // settling there is exactly the bug that made a search's results arrive
        // to nobody. So: never inside the startup grace, and never while
        // `gapIsBusy` (which reads `sourceTask`, not `status`).
        if (age < GAP_SETTLE_GRACE_MS || gapIsBusy(gap)) return;
        settleGap(groupId, {
            mp3WouldHelp: gap.mp3WouldHelp,
            // `picking` with the search finished is the picker holding candidates and
            // waiting on the user — a "your move", not a failure, and it must not be
            // worded as one. `ready` here means nothing was found at all.
            outcome:
                gap.status === 'complete'
                    ? 'done'
                    : gap.status === 'picking'
                      ? 'needsPick'
                      : 'failed',
            reason: gap.failReason || gap.noSourceReason || gap.sourceTask?.error,
            state: gap.status,
        });
    }, [watch, gap, groupId, settleGap, describe, refresh, ndArtistId]);

    return watch ? gap : undefined;
};

/**
 * Ask again for a fill the ledger remembers, with the options it was started with.
 *
 * Never automatic. lb-bot already walks its entire ranked source list before it
 * reports a failure, so an unattended retry re-runs the identical search against the
 * identical peers; the user asking again is the new information — the swarm has moved
 * on, or they have just allowed mp3.
 *
 * A gap retries as `search`, never `auto`: `auto` is what failed, and `search` stops
 * after ranking so the candidates can be judged. That review step matters more here,
 * not less — the tracks land inside a record the user already owns, so a different
 * pressing contaminates the album rather than merely disappointing.
 */
export const retryFill = async (
    row: { isGap: boolean; key: string; otherSourceExcludes?: string[] },
    options: { anotherSource?: boolean } = {},
): Promise<boolean> => {
    const { actions, fills } = useActiveFillsStore.getState();
    if (row.isGap) {
        const result = await searchGapSources(row.key, true);
        if (result.ok) actions.startGap(row.key);
        return result.ok;
    }
    const fill = fills[row.key];
    if (!fill) return false;
    // "Try another source" drops the chosen peer and tells lb-bot which ones to skip,
    // so re-ranking cannot hand the album straight back to the peer that crawled.
    const anotherSource = options.anotherSource === true;
    const result = await startAlbumDownload(
        row.key,
        fill.quality,
        !anotherSource && fill.sourcePeer
            ? { folder: fill.sourceFolder ?? '', peer: fill.sourcePeer }
            : undefined,
        // The pressing the user chose, re-sent verbatim. Dropping it here handed the
        // release-group back to lb-bot's resolver, which picks "official, earliest"
        // and caches a transient MusicBrainz failure for five minutes.
        fill.edition,
        anotherSource ? row.otherSourceExcludes : undefined,
    );
    // Re-open the existing row rather than adding a second one, so the history stays
    // one line per album rather than one per attempt.
    if (result.ok) actions.reopen(row.key, result.releaseMbid);
    return result.ok;
};

/**
 * Widen this one album's search to include mp3, then ask again. Offered only when
 * lb-bot said the search rejected mp3s and would otherwise have found something.
 *
 * `groupId` is lb-bot's **review group**, never the release-group id. A gap's key
 * is one; an album fill only learns it from a status poll, and it used to be given
 * `row.key` — the rgid — which `/lb/album/allow-mp3` accepted, matched nothing, and
 * reported through a result the caller discarded. The retry then ran against the
 * same format policy that had just rejected everything. So: refuse rather than
 * guess, and let the MP3 half actually decide whether to retry.
 */
/**
 * Stop a fill the user no longer wants — too slow, wrong peer, changed their mind.
 *
 * Settles the row from lb-bot's answer rather than waiting for a poll: the downloads
 * view may be the only thing open, and a cancel that still reads "Downloading" until
 * some artist page happens to poll is not a cancel. A fill lb-bot no longer knows
 * about is settled too — from the user's side it is not running either way.
 */
export const cancelFill = async (row: { isGap: boolean; key: string }): Promise<boolean> => {
    const { actions, fills } = useActiveFillsStore.getState();
    if (row.isGap) {
        const result = await cancelGapFill(row.key);
        if (result.ok) actions.settleGap(row.key, { outcome: 'cancelled', reason: 'Cancelled' });
        return result.ok;
    }
    const fill = fills[row.key];
    if (!fill || !lbBot) return false;
    if (!fill.releaseMbid) {
        actions.settle(row.key, { outcome: 'cancelled', reason: 'Cancelled' });
        return true;
    }
    const { ok } = await lbBot.cancelAlbum(fill.releaseMbid);
    if (ok) {
        actions.settle(row.key, {
            failureKind: 'cancelled',
            outcome: 'cancelled',
            reason: 'Cancelled',
            retryable: true,
            state: 'failed',
        });
    }
    return ok;
};

export const allowMp3AndRetry = async (row: {
    groupId: string;
    isGap: boolean;
    key: string;
}): Promise<boolean> => {
    if (!row.groupId) return false;
    if (!(await allowMp3ForAlbum(row.groupId))) return false;
    return retryFill(row);
};
