import type {
    LbBotAlbumCandidate,
    LbBotArtistCandidate,
    LbBotBrowse,
    LbBotDeezerGenres,
    LbBotDiscography,
    LbBotDownloadResult,
    LbBotFillFrame,
    LbBotFillState,
    LbBotFillStatus,
    LbBotGap,
    LbBotGapSource,
    LbBotGapTrackState,
    LbBotMeta,
    LbBotRelease,
    LbBotReleaseDetail,
    LbBotResolvedEdition,
    LbBotResolvedLink,
    LbBotResult,
    LbBotSimilarAlbums,
    LbBotSimilarArtists,
    LbBotSourceFiles,
    LbBotTracklist,
    LbBotWishlist,
} from '/@/shared/types/lbbot-types';

import { keepPreviousData, QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import isElectron from 'is-electron';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '/@/renderer/api';
import {
    ActiveFill,
    useActiveFill,
    useActiveFillsStore,
    useActiveGap,
} from '/@/renderer/features/lbbot/stores/active-fills.store';
import {
    fieldedAlbumQuery,
    hasEditionSuffix,
    normalizeAlbumTitle,
    sameAlbumTitle,
    sameArtist,
} from '/@/renderer/features/lbbot/utils/album-match';
import { artistLinkPath } from '/@/renderer/features/lbbot/utils/external-paths';
import { useCurrentServerId } from '/@/renderer/store';
import { useHubConnected } from '/@/renderer/store/hub.store';
import { toast } from '/@/shared/components/toast/toast';
import { AlbumArtistListSort, AlbumListSort, SortOrder } from '/@/shared/types/domain-types';

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
const TERMINAL_STATES = new Set<string>(['cancelled', 'failed', 'needs_match', 'verified']);

/**
 * Bounded patience for `unknown`.
 *
 * `unknown` is ambiguous: it is both "this release has no fill" and "the
 * download POST returned but lb-bot's worker thread hasn't written its first
 * ledger row yet", which is the normal first second or two after a tap. So a
 * fresh fill ignores it for a grace period, and an established one settles
 * `gaveUp` only after lb-bot has said it CONTINUOUSLY for two minutes — a
 * window measured on the clock, not in ticks, because ticks now arrive from a
 * 30 s poll, a 5 s poll and the hub's push alike.
 */
const UNKNOWN_GRACE_MS = 30 * 1000;
const UNKNOWN_SETTLE_MS = 120 * 1000;

/** How long a fill may go without MOVING (state, files or bytes) before we
 *  stop believing in it. Measured from the last progress, not from the tap: a
 *  slow peer is not a dead fill. */
const WATCH_TIMEOUT_MS = 20 * 60 * 1000;

/** The poll floor, and how many identical answers it takes to step off it. */
const POLL_BASE_MS = 5000;
const QUIET_TICKS_FIRST = 4;
const QUIET_TICKS_SECOND = 10;

/** While the hub socket is up and a `fill` push or a fills answer arrived
 *  within PUSH_FRESH_MS, the poll is only a safety net and runs slowly. */
const PUSHED_POLL_MS = 30 * 1000;
const PUSH_FRESH_MS = 60 * 1000;

/**
 * How long before the next poll, given how many consecutive identical answers.
 *
 * Five seconds stays the answer for anything that is moving. An unchanged
 * payload is free information: back off, and snap back the moment it differs.
 */
const pollInterval = (quietTicks: number): number => {
    if (quietTicks < QUIET_TICKS_FIRST) return POLL_BASE_MS;
    if (quietTicks < QUIET_TICKS_SECOND) return POLL_BASE_MS * 2;
    return POLL_BASE_MS * 4;
};

/**
 * What the ledger watcher below registers so the two entry points that are not
 * React — a `fill` frame off the hub socket, and a cancel button — can reach the
 * query cache and the library refresh.
 */
const registry: {
    lastPushAt: number;
    queryClient: null | QueryClient;
    refresh: ((ndArtistId?: string, landing?: LbBotLibraryLanding) => void) | null;
} = { lastPushAt: 0, queryClient: null, refresh: null };

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;

const FILL_STATES: ReadonlySet<string> = new Set<LbBotFillState>([
    'cancelled',
    'downloading',
    'failed',
    'needs_match',
    'placed',
    'placing',
    'queued',
    'searching',
    'unknown',
    'verified',
]);

/** A `fill` frame's album shape, read with the same rules the main process
 *  applies to a status body — the frame IS that body, minus the file list. */
export const fillFrameToStatus = (frame: LbBotFillFrame): LbBotFillStatus => {
    const rawState = str(frame.state) || 'unknown';
    const state = (FILL_STATES.has(rawState) ? rawState : 'unknown') as LbBotFillState;
    return {
        activeFiles: num(frame.activeFiles),
        album: str(frame.album),
        allowMp3: frame.allowMp3 === true,
        artist: str(frame.artist),
        attempts: num(frame.attempts),
        bytesDone: num(frame.bytesDone),
        bytesTotal: num(frame.bytesTotal),
        cancellable:
            typeof frame.cancellable === 'boolean'
                ? frame.cancellable
                : state === 'searching' || state === 'queued' || state === 'downloading',
        done: num(frame.done),
        failed: num(frame.failed),
        failureKind: str(frame.failureKind) as LbBotFillStatus['failureKind'],
        groupId: str(frame.groupId),
        mp3WouldHelp: frame.mp3WouldHelp === true,
        percent: num(frame.percent),
        quality: str(frame.quality),
        reason: str(frame.reason),
        releaseMbid: str(frame.releaseMbid),
        retryable: frame.retryable === true,
        retryAt: num(frame.retryAt),
        rgid: str(frame.rgid),
        serverTime: num(frame.serverTime),
        source: str(frame.source),
        speedBps: num(frame.speedBps),
        state,
        total: num(frame.total),
        updatedAt: num(frame.updatedAt),
        verifyGaveUp: frame.verifyGaveUp === true,
    };
};

const outcomeFor = (status: LbBotFillStatus) =>
    status.state === 'verified' || (status.state === 'placed' && status.verifyGaveUp)
        ? 'done'
        : status.state === 'cancelled'
          ? 'cancelled'
          : 'failed';

/**
 * The ONE place lb-bot's answer about an album fill reaches the ledger.
 *
 * A poll of one row, a poll of every row and a `fill` frame off the hub socket
 * all end here, so push cannot disagree with poll about what a state means.
 * It is also where the three things a status can be are kept apart: a real
 * state moves the row; `unknown` is bounded patience (above); and a FAILED
 * poll never comes here at all — `noteCheck` records it, and the row keeps
 * saying what it last knew plus "can't reach lb-bot".
 */
export const applyFillStatus = (rgid: string, status: LbBotFillStatus, now = Date.now()): void => {
    const { actions, fills } = useActiveFillsStore.getState();
    const fill = fills[rgid];
    const mbid = status.releaseMbid || fill?.releaseMbid;
    // Keep an open modal's single-item read in step with what the ledger heard.
    if (mbid) registry.queryClient?.setQueryData(['lbbot', 'album-status', mbid], status);
    if (!fill) return;
    actions.noteCheck(rgid, '');

    if (status.state === 'unknown') {
        if (fill.settled || now - fill.startedAt < UNKNOWN_GRACE_MS) return;
        const since = fill.unknownSince || now;
        if (!fill.unknownSince) actions.describe(rgid, { unknownSince: since });
        if (now - since >= UNKNOWN_SETTLE_MS) {
            actions.settle(rgid, {
                outcome: 'gaveUp',
                reason: 'lb-bot no longer knows this download',
                state: fill.state,
            });
        }
        return;
    }

    // A settled row whose server side has come back to life — lb-bot's own
    // automatic retry, a wishlist re-search, a retry from the other client —
    // re-opens, so the ledger follows the fill rather than its last verdict.
    if (fill.settled) {
        const backAlive =
            !TERMINAL_STATES.has(status.state) &&
            status.updatedAt * 1000 > (fill.finishedAt ?? 0) - 1000;
        if (!backAlive) {
            // The server no longer has a retry pending (it fired, or lb-bot
            // restarted): stop watching this settled row for one.
            if ((fill.retryAt ?? 0) > 0 && !status.retryAt) actions.describe(rgid, { retryAt: 0 });
            return;
        }
        actions.reopen(rgid, status.releaseMbid);
    }

    const moved =
        status.state !== fill.state ||
        status.done !== (fill.done ?? 0) ||
        status.failed !== (fill.failedFiles ?? 0) ||
        status.bytesDone !== (fill.bytesDone ?? 0);
    actions.describe(rgid, {
        album: status.album,
        allowMp3: status.allowMp3,
        artist: status.artist,
        attempts: status.attempts,
        bytesDone: status.bytesDone,
        bytesTotal: status.bytesTotal,
        cancellable: status.cancellable,
        done: status.done,
        failedFiles: status.failed,
        failureKind: status.failureKind,
        groupId: status.groupId,
        lastSource: status.source,
        mp3WouldHelp: status.mp3WouldHelp,
        percent: status.percent,
        retryable: status.retryable,
        retryAt: status.retryAt ? status.retryAt * 1000 : 0,
        speedBps: status.speedBps,
        state: status.state,
        total: status.total,
        unknownSince: 0,
        verifyGaveUp: status.verifyGaveUp,
        ...(moved ? { lastProgressAt: now } : {}),
    });

    // `placed` says the files are in the library folder; refreshing now is what
    // makes the album appear the moment Navidrome's scan finishes.
    if ((status.state === 'placed' || status.state === 'verified') && fill.state !== status.state) {
        registry.refresh?.(undefined, {
            event: status.state === 'verified' ? 'albumIndexed' : 'albumPlaced',
        });
    }

    if (TERMINAL_STATES.has(status.state) || (status.state === 'placed' && status.verifyGaveUp)) {
        actions.settle(rgid, {
            attempts: status.attempts,
            cancellable: status.cancellable,
            failureKind: status.failureKind,
            mp3WouldHelp: status.mp3WouldHelp,
            outcome: outcomeFor(status),
            reason: status.reason,
            retryable: status.retryable,
            retryAt: status.retryAt ? status.retryAt * 1000 : 0,
            state: status.state,
            verifyGaveUp: status.verifyGaveUp,
        });
        return;
    }
    if (!moved && now - (fill.lastProgressAt ?? fill.startedAt) > WATCH_TIMEOUT_MS) {
        // Ran out of clock rather than failed — a different thing, and worth
        // saying so: nothing is known to have gone wrong.
        actions.settle(rgid, {
            outcome: 'gaveUp',
            reason: 'No progress for 20 minutes',
            state: status.state,
        });
    }
};

/**
 * How long a fresh gap watch refuses to settle, whatever the group says.
 *
 * The POST returns before lb-bot's worker has written anything, so a group
 * that has just been asked to fill still looks idle.
 */
const GAP_SETTLE_GRACE_MS = 90 * 1000;

/** The gap counterpart of `applyFillStatus`: one writer for the gap ledger. */
export const applyGapSummary = (groupId: string, gap: LbBotGap, now = Date.now()): void => {
    const { actions, gaps } = useActiveFillsStore.getState();
    registry.queryClient?.setQueryData(['lbbot', 'gap', groupId], {
        data: gap,
        error: '',
        ok: true,
        status: 200,
    });
    const watch = gaps[groupId];
    if (!watch) return;
    actions.noteCheck(groupId, '');
    const busy = gapIsBusy(gap);
    if (watch.settled) {
        if (busy) actions.startGap(groupId, { album: gap.album, artist: gap.artist });
        else return;
    }
    const progress = gapProgress(gap);
    const moved =
        gap.status !== watch.state ||
        progress.done !== (watch.done ?? 0) ||
        progress.failed !== (watch.failedFiles ?? 0);
    actions.describe(groupId, {
        album: gap.album,
        artist: gap.artist,
        cancellable:
            gap.status === 'downloading' ||
            gap.tracks.some((t) => t.state === 'downloading' || t.state === 'queued'),
        done: progress.done,
        failedFiles: progress.failed,
        mp3WouldHelp: gap.mp3WouldHelp,
        percent: progress.percent,
        state: gap.status,
        total: progress.wanted,
        ...(moved ? { lastProgressAt: now } : {}),
    });
    // `complete` means the tracks are in the album folder; the discography row
    // and Navidrome's own list both have to be re-read or the album double-lists.
    if (gap.status === 'complete' && watch.state !== 'complete') registry.refresh?.(undefined);

    const age = now - watch.startedAt;
    if (!busy && now - (watch.lastProgressAt ?? watch.startedAt) > WATCH_TIMEOUT_MS) {
        actions.settleGap(groupId, { outcome: 'gaveUp', state: gap.status });
        return;
    }
    // Never inside the startup grace, and never while `gapIsBusy` (which reads
    // `sourceTask`, not `status`) — this API looks idle before it is busy.
    if (age < GAP_SETTLE_GRACE_MS || busy) return;
    actions.settleGap(groupId, {
        mp3WouldHelp: gap.mp3WouldHelp,
        // `picking` with the search finished is the picker holding candidates
        // and waiting on the user — a "your move", not a failure.
        outcome:
            gap.status === 'complete' ? 'done' : gap.status === 'picking' ? 'needsPick' : 'failed',
        reason: gap.failReason || gap.noSourceReason || gap.sourceTask?.error,
        state: gap.status,
    });
};

/** A `fill` frame off the hub socket: lb-bot pushed a state or progress change. */
export const applyFillFrame = (frame: LbBotFillFrame): void => {
    registry.lastPushAt = Date.now();
    const key = str(frame.key);
    if (frame.kind === 'album') {
        const status = fillFrameToStatus(frame);
        const { fills } = useActiveFillsStore.getState();
        const rgid = fills[key] ? key : fills[status.rgid] ? status.rgid : key || status.rgid;
        if (rgid) applyFillStatus(rgid, status);
    } else if (frame.kind === 'gap') {
        // The frame is a summary; the poll carries the tracks. Re-read now.
        if (key) void registry.queryClient?.invalidateQueries({ queryKey: ['lbbot', 'gap', key] });
        void registry.queryClient?.invalidateQueries({ queryKey: ['lbbot', 'fills'] });
    } else if (frame.kind === 'wishlist') {
        void registry.queryClient?.invalidateQueries({ queryKey: ['lbbot', 'wishlist'] });
    }
};

/**
 * The ledger's own watcher. Mounted once, at the app root, whether or not any
 * page is showing a fill.
 *
 * Polling used to happen only from mounted rows — a tile, a `/downloads` row
 * that passed the current filter, an open modal — so a fill that failed while
 * none of those was on screen read "Downloading" until something remounted it,
 * and choosing the "Didn't land" chip stopped polling the fills in flight. This
 * reads every unsettled row in ONE request (`/lb/fills`), in the background
 * too, and hands each answer to `applyFillStatus` / `applyGapSummary`.
 *
 * Push accelerates it: while the hub socket is up and a `fill` frame arrived
 * recently, this is a 30 s safety net; otherwise it is the 5/10/20 s poll.
 */
export const useFillLedgerWatcher = () => {
    const queryClient = useQueryClient();
    const refresh = useLbBotLibraryRefresh();
    const connected = useHubConnected();
    useEffect(() => {
        registry.queryClient = queryClient;
        registry.refresh = refresh;
    }, [queryClient, refresh]);

    const fills = useActiveFillsStore((state) => state.fills);
    const gaps = useActiveFillsStore((state) => state.gaps);
    const releaseMbids = useMemo(
        () =>
            [
                ...new Set(
                    Object.values(fills)
                        // Settled rows with a pending automatic retry are watched too:
                        // that is how the row learns the retry began.
                        .filter((f) => f.releaseMbid && (!f.settled || (f.retryAt ?? 0) > 0))
                        .map((f) => f.releaseMbid),
                ),
            ].sort(),
        [fills],
    );
    const groupIds = useMemo(
        () =>
            Object.values(gaps)
                .filter((g) => !g.settled)
                .map((g) => g.groupId)
                .sort(),
        [gaps],
    );
    const quiet = useRef(0);
    const lastDigest = useRef('');

    useQuery({
        enabled: !!lbBot && (releaseMbids.length > 0 || groupIds.length > 0),
        queryFn: async () => {
            const result = await lbBot!.fills(releaseMbids, groupIds);
            const state = useActiveFillsStore.getState();
            const keys = [
                ...Object.values(state.fills)
                    .filter((f) => releaseMbids.includes(f.releaseMbid))
                    .map((f) => f.rgid),
                ...groupIds,
            ];
            if (!result.ok || !result.data) {
                const error = result.error || 'Could not reach lb-bot';
                for (const key of keys) state.actions.noteCheck(key, error);
                throw new Error(error);
            }
            const albums = result.data.albums;
            const digest = JSON.stringify([
                Object.entries(albums).map(([mbid, s]) => [
                    mbid,
                    s.state,
                    s.done,
                    s.failed,
                    s.bytesDone,
                    s.percent,
                    s.retryAt,
                ]),
                Object.values(result.data.gaps).map((g) => [
                    g.id,
                    g.status,
                    g.sourceTask?.status,
                    g.tracks.map((t) => t.state).join(''),
                ]),
            ]);
            quiet.current = digest === lastDigest.current ? quiet.current + 1 : 0;
            lastDigest.current = digest;
            const now = Date.now();
            for (const fill of Object.values(state.fills)) {
                const status = albums[fill.releaseMbid];
                if (status) applyFillStatus(fill.rgid, status, now);
            }
            for (const [gid, gap] of Object.entries(result.data.gaps)) {
                applyGapSummary(gid, gap, now);
            }
            return result.data;
        },
        queryKey: ['lbbot', 'fills', releaseMbids.join(','), groupIds.join(',')],
        refetchInterval: () =>
            connected && Date.now() - registry.lastPushAt < PUSH_FRESH_MS
                ? PUSHED_POLL_MS
                : pollInterval(quiet.current),
        refetchIntervalInBackground: true,
        retry: false,
        staleTime: 0,
    });
};

/**
 * Poll one release's fill while a modal is open on it.
 *
 * The ledger watcher above already reads every watched fill; this is the one
 * single-item read, for a modal that wants the per-file list and a 5 s cadence
 * while the user is looking. A failed poll THROWS: react-query keeps the last
 * data and counts the failure, and the row says "can't reach" — it used to
 * arrive as `unknown`, which is a real answer meaning something else entirely.
 */
export const useLbBotFillStatus = (releaseMbid: null | string, enabled: boolean, rgid?: string) => {
    const queryClient = useQueryClient();
    const queryKey = ['lbbot', 'album-status', releaseMbid];
    const ticks = useRef({ quiet: 0 });
    return useQuery<LbBotFillStatus>({
        enabled: !!lbBot && !!releaseMbid && enabled,
        queryFn: async () => {
            const result = await lbBot!.albumStatus(releaseMbid!);
            if (!result.ok || !result.data) {
                const error = result.error || 'Could not reach lb-bot';
                if (rgid) useActiveFillsStore.getState().actions.noteCheck(rgid, error);
                throw new Error(error);
            }
            const next = result.data;
            const previous = queryClient.getQueryData<LbBotFillStatus>(queryKey);
            const same =
                previous &&
                previous.state === next.state &&
                previous.done === next.done &&
                previous.bytesDone === next.bytesDone &&
                previous.failed === next.failed;
            ticks.current.quiet = same ? ticks.current.quiet + 1 : 0;
            const key = rgid || next.rgid;
            if (key) applyFillStatus(key, next);
            return next;
        },
        queryKey,
        refetchInterval: (query) => {
            const state = query.state.data?.state ?? 'unknown';
            if (TERMINAL_STATES.has(state)) return false;
            return pollInterval(ticks.current.quiet);
        },
        retry: false,
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
    /** Widen this one album's search to MP3 — the whole-album counterpart of a
     *  gap group's opt-in. */
    allowMp3?: boolean,
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
    const result = await lbBot.downloadAlbum(
        rgid,
        quality,
        source,
        edition,
        excludeUsers,
        allowMp3,
    );
    if (result.ok) {
        // Registered here rather than in the sheet: the fill takes minutes, and
        // the page behind the sheet is what has to keep watching it. The edition's
        // artist and title ride along so the downloads view can name the row even
        // after lb-bot has forgotten the fill.
        useActiveFillsStore.getState().actions.start(rgid, result.releaseMbid, quality ?? '', {
            album: edition?.title || names?.album,
            allowMp3: allowMp3 === true,
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
 * Acquire an unowned album in one gesture — reviewed, not blind.
 *
 * Reads the ranked sources first and only posts the download when lb-bot's own
 * top-ranked folder leaves nothing to decide: `recommended`, `albumMatchOk`,
 * and coverage complete against the canonical MusicBrainz tracklist. Anything
 * else opens the picker it would have bypassed — the one-tap version existed
 * once and fetched the wrong record for a self-titled album.
 *
 *  * `wrongFormat`: `quality` is a *ranking* term upstream, not a filter, so the
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
            //
            // With the album ids the frame now carries, only the lists and the
            // named albums are dropped — not every album detail in the cache.
            const ids = landing?.ndAlbumIds ?? [];
            const artist = landing?.ndArtistId ?? ndArtistId ?? '';
            const invalidateLibrary = () =>
                void queryClient.invalidateQueries({
                    predicate: (query) => {
                        const [, kind, scope] = query.queryKey as [string, string?, string?];
                        if (kind === 'albums') {
                            if (ids.length === 0 || scope === 'list') return true;
                            const serialized = JSON.stringify(query.queryKey);
                            return ids.some((id) => serialized.includes(id));
                        }
                        if (kind === 'albumArtists') {
                            if (!artist || scope === 'list') return true;
                            return JSON.stringify(query.queryKey).includes(artist);
                        }
                        return false;
                    },
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
 * One tile's fill, from the ledger. The ledger watcher keeps it live; this
 * costs nothing for a release nobody started, which is nearly all of them.
 * The second argument is kept for call-site compatibility — the page refresh
 * on landing is now the watcher's job, whichever page is open.
 */
export const useWatchedFill = (rgid: string, _ndArtistId?: string): ActiveFill | undefined => {
    const fill = useActiveFill(rgid);
    return fill && !fill.settled
        ? fill
        : fill?.settled && fill.outcome === 'done'
          ? undefined
          : fill;
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
 * A gap fill's last known group, for the page. The ledger watcher polls it
 * (and the modal, while open); this only reads what they wrote to the query
 * cache. Returns undefined for a gap nobody started, which is nearly all of
 * them, so the hook costs nothing until the user acts.
 */
export const useWatchedGap = (groupId: string, _ndArtistId?: string) => {
    const watch = useActiveGap(groupId);
    const query = useQuery<LbBotResult<LbBotGap>>({
        enabled: false,
        queryFn: () => lbBot!.gap(groupId),
        queryKey: ['lbbot', 'gap', groupId],
    });
    return watch && query.data?.ok ? (query.data.data ?? undefined) : undefined;
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
    options: { allowMp3?: boolean; anotherSource?: boolean } = {},
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
        { album: fill.album, artist: fill.artist },
        options.allowMp3 === true || fill.allowMp3 === true,
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
export const cancelFill = async (row: {
    isGap: boolean;
    key: string;
    /** For a fill this client never started (it is running from another device):
     *  the modal knows the release even when the ledger has no row. */
    releaseMbid?: string;
}): Promise<boolean> => {
    const { actions, fills } = useActiveFillsStore.getState();
    if (row.isGap) {
        const result = await cancelGapFill(row.key);
        if (result.ok) actions.settleGap(row.key, { outcome: 'cancelled', state: 'cancelled' });
        return result.ok;
    }
    const fill = fills[row.key];
    const releaseMbid = row.releaseMbid || fill?.releaseMbid;
    if (!lbBot) return false;
    if (!releaseMbid) {
        if (!fill) return false;
        actions.settle(row.key, { outcome: 'cancelled', state: 'cancelled' });
        return true;
    }
    const { cancelled, ok, status } = await lbBot.cancelAlbum(releaseMbid);
    if (!ok) return false;
    if (!cancelled) {
        // lb-bot answered, and said no: too late (the files are being placed)
        // or nothing was running. Its status says which — show that, not a
        // row that claims a cancel happened.
        if (
            status.state === 'placing' ||
            status.state === 'placed' ||
            status.state === 'verified'
        ) {
            toast.show({ message: "Too late to cancel — it's being added to the library." });
            if (fill) applyFillStatus(row.key, status);
        } else if (fill && !fill.settled) {
            actions.settle(row.key, { outcome: 'cancelled', state: 'cancelled' });
        }
        return true;
    }
    if (fill?.settled) {
        // A failed row whose automatic retry was pending: the verdict changes
        // in place rather than through `settle`, which is once-only.
        actions.describe(row.key, {
            cancellable: false,
            outcome: 'cancelled',
            retryAt: 0,
            state: 'cancelled',
        });
    } else if (fill) {
        actions.settle(row.key, {
            failureKind: '',
            outcome: 'cancelled',
            retryable: false,
            state: 'cancelled',
        });
    }
    return true;
};

/**
 * Widen this one album's search to include mp3, then ask again. Offered when
 * lb-bot said the search rejected mp3s and would otherwise have found something.
 *
 * With a review group, the opt-in is set on the group (`/lb/album/allow-mp3`)
 * and the retry follows. Without one — an artist-page download has none — the
 * retry itself carries `allowMp3`, the whole-album counterpart lb-bot now
 * takes on `album/download`. Either way the retry runs only if the opt-in took.
 */
export const allowMp3AndRetry = async (row: {
    groupId: string;
    isGap: boolean;
    key: string;
}): Promise<boolean> => {
    if (row.groupId) {
        if (!(await allowMp3ForAlbum(row.groupId))) return false;
        return retryFill(row);
    }
    if (row.isGap) return false;
    return retryFill(row, { allowMp3: true });
};

// ---------------------------------------------------------------------------
// Track C: Deezer browse, paste-a-link, wishlist
// ---------------------------------------------------------------------------

/**
 * Deezer's charts and editorial selections, ownership-marked.
 *
 * One hook for both feeds because they are the same request with a different
 * path, and the rows are the same shape — the difference is the *question*, and
 * that lives in the row's `because` line rather than in the data.
 *
 * Gated on `useHubSupports` as well as availability, like `/lb/artist/similar`:
 * this route is newer than some hubs, and a hub that has not been restarted
 * answers 404, which `describeFailure` reports as "the hub is older than this
 * app". Hiding the row is the right answer, not showing that sentence.
 *
 * lb-bot caches both feeds for six hours and the hub for the same, so a long
 * `staleTime` here costs nothing and saves a round trip per navigation.
 */
const useLbBotBrowse = (feed: 'chart' | 'editorial', limit = 20, genre = '0') => {
    const available = useLbBotAvailable();
    const supported = useHubSupports(`GET /lb/deezer/${feed}`);
    return useQuery<LbBotBrowse | null>({
        enabled: !!lbBot && available && supported,
        queryFn: () =>
            feed === 'chart'
                ? lbBot!.deezerChart(limit, genre)
                : lbBot!.deezerEditorial(limit, genre),
        // The genre is in the key, so switching chips is a cache lookup after
        // the first visit rather than another trip through the hub's four
        // shared proxy slots.
        queryKey: ['lbbot', 'deezer', feed, limit, genre],
        refetchOnWindowFocus: false,
        staleTime: 60 * 60 * 1000,
    });
};

export const useLbBotDeezerChart = (limit = 20, genre = '0') =>
    useLbBotBrowse('chart', limit, genre);
export const useLbBotDeezerEditorial = (limit = 20, genre = '0') =>
    useLbBotBrowse('editorial', limit, genre);

/**
 * Deezer's genre list, for the chip row that scopes both feeds above.
 *
 * Gated on the hub advertising the route, which is what makes this additive: an
 * older hub hides the chips entirely and both rows behave exactly as they did
 * before, because `genre` defaults to Deezer's "All" and that is byte-for-byte
 * the request they were already making.
 *
 * Genre is the only axis offered. Deezer's open API has no country parameter —
 * the chart is geolocated by lb-bot's egress address — so a country picker
 * could only ever be a control that silently did nothing.
 */
export const useLbBotDeezerGenres = () => {
    const available = useLbBotAvailable();
    const supported = useHubSupports('GET /lb/deezer/genres');
    return useQuery<LbBotDeezerGenres | null>({
        enabled: !!lbBot && available && supported,
        queryFn: () => lbBot!.deezerGenres(),
        queryKey: ['lbbot', 'deezer', 'genres'],
        refetchOnWindowFocus: false,
        // Deezer has changed these ids before, which is why they are a route and
        // not a table — but not within a session.
        staleTime: Infinity,
    });
};

/**
 * Where a Deezer browse tile should open.
 *
 * A `BrowseTarget` rather than a bare release-group id, and that shape is the
 * fix for half of a real failure: an id can express only one of three outcomes,
 * which is how a tile for an album the user owned in full came to open a
 * download page captioned "Not in your library".
 */
export type BrowseTarget =
    | { albumId: string; kind: 'library' }
    | { artist: string; kind: 'external'; rgid: string; title: string; year?: string };

/**
 * Resolve one Deezer browse row to a destination, library first.
 *
 * lb-bot marks the browse feeds against its **local release-group index**, which
 * only covers artists whose discography somebody has actually scanned. So
 * `releaseOwned: false` means "not in lb-bot's index", **not** "not in your
 * library" — two different questions that happen to share a word. Measured
 * 2026-09-23: the real `Daft Punk — Discovery` comes back `releaseOwned: false`
 * from the deployed service, for an album owned in full, because that artist had
 * never been scanned. No amount of fixing the search fixes that half.
 *
 * Navidrome holds the whole library and answers "do I have this" exactly, for
 * one cheap request. So the order is:
 *
 *   1. lb-bot already marked it owned, with an id → the library album
 *   2. **the library itself, matched on artist + title** → the library album
 *   3. lb-bot resolved an rgid → the external page
 *   4. one *fielded* MusicBrainz search, validated → library if owned, else external
 *   5. decline, and say so
 *
 * Steps 2 and 4 both drop the edition suffix: Deezer ships "Discovery
 * (Remastered)" where MusicBrainz and the library both say "Discovery".
 */
/**
 * Where an artist credit should open, given whatever handles are to hand.
 *
 * The album page's artist control has always been gated on an artist id **or**
 * an MBID. Reached from the Fresh tab or a discography shelf one of those is
 * populated; reached from a **Deezer browse row** neither is, because Deezer
 * carries no MusicBrainz ids at all — which is the whole reason those rows
 * arrive unresolved. So the control hid itself, correctly, and took the only
 * route to the discography scan with it.
 *
 * Resolution order mirrors what the album side settled:
 *
 *   1. the artist id the caller already knew
 *   2. **the library, matched on name** — either the browse row's plain credit
 *      ("Daft Punk") or lb-bot's full MusicBrainz one, since either may be how
 *      the library filed them
 *   3. an MBID: the page's own, else the one `/lb/album/releases` answers
 *   4. nothing, and the credit stays plain text rather than becoming a control
 *      that refuses
 *
 * Library before MusicBrainz for the reason the album side established: an
 * owned artist must open *their* page, because the external one renders every
 * album they own as "Added - syncing".
 */
export const useArtistTarget = (args: {
    artistId?: string;
    artistMbid?: string;
    name?: string;
}): string | undefined => {
    const serverId = useCurrentServerId();
    const { artistId, artistMbid, name } = args;

    const local = useQuery<null | string>({
        enabled: Boolean(serverId) && !artistId && Boolean(name),
        queryFn: async () => {
            const found = await api.controller
                .getAlbumArtistList({
                    apiClientProps: { serverId: serverId! },
                    query: {
                        limit: 25,
                        searchTerm: name!,
                        sortBy: AlbumArtistListSort.NAME,
                        sortOrder: SortOrder.ASC,
                        startIndex: 0,
                    },
                })
                .catch(() => null);
            return (found?.items ?? []).find((row) => sameArtist(row.name, name!))?.id ?? null;
        },
        queryKey: ['lbbot', 'artist-target', serverId, name],
        staleTime: 5 * 60 * 1000,
    });

    return artistLinkPath(artistId || local.data || '', artistMbid || '');
};

export const useResolveBrowseAlbum = () => {
    const [pending, setPending] = useState('');
    const serverId = useCurrentServerId();

    /** Step 2. One Navidrome search, scored by the same rules step 4 uses, so a
     *  library hit and a MusicBrainz hit cannot disagree about what "the same
     *  album" means. */
    const localAlbumFor = useCallback(
        async (album: { artist: string; title: string }): Promise<null | string> => {
            if (!serverId) return null;
            const term = normalizeAlbumTitle(album.title);
            if (!term) return null;
            const found = await api.controller
                .getAlbumList({
                    apiClientProps: { serverId },
                    query: {
                        limit: 25,
                        searchTerm: term,
                        sortBy: AlbumListSort.NAME,
                        sortOrder: SortOrder.ASC,
                        startIndex: 0,
                    },
                })
                .catch(() => null);
            const hit = (found?.items ?? []).find(
                (row) =>
                    sameAlbumTitle(row.name, album.title) &&
                    sameArtist(row.albumArtistName || '', album.artist),
            );
            return hit?.id ?? null;
        },
        [serverId],
    );

    const resolve = useCallback(
        async (album: {
            artist: string;
            releaseAlbumId?: string;
            releaseOwned?: boolean;
            rgid?: string;
            title: string;
        }): Promise<BrowseTarget | null> => {
            // 1. lb-bot's own badge, when it carries an id to act on.
            if (album.releaseOwned && album.releaseAlbumId) {
                return { albumId: album.releaseAlbumId, kind: 'library' };
            }
            setPending(`${album.artist}-${album.title}`);
            try {
                // 2. The library, before the network. Free, exact and offline.
                const local = await localAlbumFor(album);
                if (local) return { albumId: local, kind: 'library' };

                // 3. lb-bot placed the row but the library does not have it.
                if (album.rgid) {
                    return {
                        artist: album.artist,
                        kind: 'external',
                        rgid: album.rgid,
                        title: album.title,
                    };
                }

                // 4. One fielded search, and the answer checked against the
                //    question. Trusting the order is what opened a parody.
                const query = fieldedAlbumQuery(album.artist, album.title);
                if (!lbBot || !query) return null;
                const candidates = await lbBot.albumLookup(query).catch(() => []);
                const valid = candidates.filter(
                    (row) =>
                        sameAlbumTitle(row.title, album.title) &&
                        sameArtist(row.artist, album.artist),
                );
                // Ordering the survivors. Ownership first: it is a fact about
                // the library, where a score is a guess about text. Then a
                // title with no bracketed qualifier, because several real
                // candidates strip to the same thing - measured on this exact
                // case, `Discovery`, `Discovery (Beta Version)` and `Discovery
                // (Sample Bandit Bootlegs)` all survive validation, and leaving
                // the pick to MusicBrainz's ranking puts a bootleg one place
                // from winning. Only then the order lb-bot sent.
                const ranked = valid
                    .map((row, index) => ({ index, row }))
                    .sort(
                        (a, b) =>
                            Number(b.row.releaseOwned) - Number(a.row.releaseOwned) ||
                            Number(hasEditionSuffix(a.row.title)) -
                                Number(hasEditionSuffix(b.row.title)) ||
                            a.index - b.index,
                    );
                const hit = ranked[0]?.row;
                if (!hit) return null;
                if (hit.releaseAlbumId) {
                    return { albumId: hit.releaseAlbumId, kind: 'library' };
                }
                // MusicBrainz named the record but lb-bot has no Navidrome id
                // for it — which may still be an album on disk by an unscanned
                // artist, so ask the library again under its canonical title.
                const canonical = await localAlbumFor({
                    artist: hit.artist || album.artist,
                    title: hit.title || album.title,
                });
                if (canonical) return { albumId: canonical, kind: 'library' };
                return {
                    artist: hit.artist || album.artist,
                    kind: 'external',
                    rgid: hit.rgid,
                    title: hit.title || album.title,
                    year: hit.year,
                };
            } finally {
                setPending('');
            }
        },
        [localAlbumFor],
    );

    return { pending, resolve };
};

/**
 * Deezer's "related artists" — a third similarity source beside ListenBrainz
 * and Last.fm.
 *
 * Answers in the *same* shape as `useLbBotSimilarArtists`, deliberately: lb-bot
 * marks ownership identically, so one renderer serves both and there is no
 * second vocabulary to keep in step.
 */
export const useLbBotRelatedArtists = (args: {
    limit?: number;
    mbid?: null | string;
    name?: null | string;
}) => {
    const available = useLbBotAvailable();
    const supported = useHubSupports('GET /lb/artist/related');
    const { limit, mbid, name } = args;
    return useQuery<LbBotSimilarArtists | null>({
        enabled: !!lbBot && available && supported && !!(mbid || name),
        queryFn: () =>
            lbBot!.artistRelated({ limit, mbid: mbid ?? undefined, name: name ?? undefined }),
        queryKey: ['lbbot', 'artist-related', mbid || name, limit],
        refetchOnWindowFocus: false,
        staleTime: 60 * 60 * 1000,
    });
};

/**
 * Resolve a pasted streaming URL.
 *
 * Imperative, because it is a one-shot the user pressed and the answer is
 * navigated to rather than rendered. Returns the result unchanged so the caller
 * can tell "lb-bot cannot read that link" (an error worth saying) from
 * `kind: 'unknown'` (a legitimate answer about a provider it does not parse).
 */
export const useResolveLink = () => {
    const [pending, setPending] = useState(false);

    const resolve = useCallback(async (url: string): Promise<LbBotResult<LbBotResolvedLink>> => {
        if (!lbBot) return NO_LINK;
        setPending(true);
        const result = await lbBot.resolveLink(url);
        setPending(false);
        return result;
    }, []);

    return { pending, resolve };
};

const NO_LINK: LbBotResult<LbBotResolvedLink> = {
    data: null,
    error: 'lb-bot is not available in this build.',
    ok: false,
    status: 0,
};

/**
 * The wishlist: albums nobody was sharing, kept for a slow re-search.
 *
 * Polled on a long interval rather than on a notification, because the thing
 * that changes it is lb-bot's own periodic re-search running on a scale of
 * hours — a landing also fires `/lb/notify`, which refreshes the library, but
 * the row leaving this list is a separate fact.
 */
export const useLbBotWishlist = () => {
    const available = useLbBotAvailable();
    const supported = useHubSupports('GET /lb/wishlist');
    return useQuery<LbBotWishlist>({
        enabled: !!lbBot && available && supported,
        queryFn: () => lbBot!.wishlist(),
        queryKey: ['lbbot', 'wishlist'],
        refetchOnWindowFocus: true,
        staleTime: 60 * 1000,
    });
};

/**
 * Add to / remove from the wishlist, invalidating the list either way.
 *
 * The add is offered on exactly one thing: a fill that failed `no_source`.
 * Everything else either retries usefully or needs fixing in lb-bot, and
 * offering a wishlist button there would be a second dead end wearing a
 * different label.
 */
export const useWishlistActions = () => {
    const queryClient = useQueryClient();

    const invalidate = useCallback(
        () => queryClient.invalidateQueries({ queryKey: ['lbbot', 'wishlist'] }),
        [queryClient],
    );

    const add = useCallback(
        async (args: { artist: string; rgid: string; title: string }): Promise<boolean> => {
            if (!lbBot) return false;
            const result = await lbBot.wishlistAdd(args);
            if (result.ok) void invalidate();
            else toast.error({ message: result.error || 'lb-bot would not take that request.' });
            return result.ok;
        },
        [invalidate],
    );

    const remove = useCallback(
        async (rgid: string): Promise<boolean> => {
            if (!lbBot) return false;
            const result = await lbBot.wishlistRemove(rgid);
            if (result.ok) void invalidate();
            else toast.error({ message: result.error || 'lb-bot would not take that request.' });
            return result.ok;
        },
        [invalidate],
    );

    return { add, remove };
};
