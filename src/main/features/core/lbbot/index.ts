import type {
    LbBotDiscography,
    LbBotDownloadResult,
    LbBotEdition,
    LbBotFillState,
    LbBotFillStatus,
    LbBotGap,
    LbBotGapSource,
    LbBotGapStatus,
    LbBotGapTask,
    LbBotGapTrack,
    LbBotGapTrackState,
    LbBotRelease,
    LbBotReleaseDetail,
    LbBotReleaseStatus,
    LbBotResult,
    LbBotSourceCoverage,
    LbBotSourceFile,
    LbBotSourceFiles,
    LbBotStatus,
    LbBotTrack,
    LbBotTracklist,
    LbBotVariant,
} from '/@/shared/types/lbbot-types';

import { BrowserWindow, ipcMain, Notification } from 'electron';

import { getHubConfig } from '../hub';

/**
 * navi-connect lb-bot client (main process).
 *
 * lb-bot knows what is *missing* from the library: a per-artist MusicBrainz
 * discography index, and a Soulseek acquisition pipeline that can fill a gap.
 * This exposes the read side plus the two writes the UI offers (index an artist,
 * download a missing album) — see ../../../../../DESIGN-lbbot-client-integration.md.
 *
 * HUB ONLY, unlike the AudioMuse client next door. That one keeps a direct-LAN
 * fallback because AudioMuse has its own bearer token; lb-bot's Flask API has no
 * authentication at all, so a direct route would mean shipping its LAN address to
 * every device and bypassing the only gate that exists. No hub configured means
 * the feature is simply off.
 *
 * Everything here is fail-soft: an unreachable hub, an unconfigured LBBOT_URL, or
 * any upstream error returns the empty/unknown shape, and the renderer hides the
 * surface rather than showing an error. The artist page must render exactly as it
 * does today when lb-bot is not there.
 */

/** `ws://host:4790` → `http://host:4790`; null when the hub isn't configured. */
const hubBase = (): null | string => {
    const { enabled, token, url } = getHubConfig();
    if (!enabled || !url || !token) return null;
    return url
        .replace(/^ws/, 'http')
        .replace(/\/+$/, '')
        .replace(/\/connect$/, '');
};

const authHeaders = (): Record<string, string> => ({
    Authorization: `Bearer ${getHubConfig().token}`,
});

type Json = Record<string, unknown>;

/**
 * Turn a non-2xx into a sentence worth showing.
 *
 * Two of these are not what their status code normally means, and getting either
 * wrong wastes a debugging round:
 *
 * - **404 is not "not found".** Every route here is a hub whitelist entry, so a
 *   404 means *the hub proxies no such route* — it is older than this app and
 *   needs restarting. `hub.py` is a long-running process; editing it changes
 *   nothing until it restarts, which alone accounted for a whole round of "the
 *   button does nothing" on the Navic side.
 * - **502 is usually "busy", not "refused".** Every lb-bot route takes its
 *   process-wide `_review_lock`, and the hub's default 20s proxy timeout is the
 *   only thing separating slow from failed. The hub's own body reads
 *   `{"error": "lb-bot unreachable"}`, which taken literally is misleading while
 *   a large search holds that lock.
 *
 * Anything else prefers lb-bot's own `error`, which it writes for humans.
 */
const describeFailure = (status: number, body: Json | null): string => {
    const upstream = typeof body?.error === 'string' ? body.error : '';
    if (status === 404) {
        return 'This hub does not know that route — restart the hub to pick up its newer lb-bot features.';
    }
    if (status === 502 || status === 504) {
        return 'lb-bot is busy or unreachable. It handles one request at a time while searching; try again in a moment.';
    }
    if (status === 0) return 'Could not reach the hub.';
    return upstream || `Request failed (${status})`;
};

const failed = <T>(status: number, error: string): LbBotResult<T> => ({
    data: null,
    error,
    ok: false,
    status,
});

/**
 * How long the two *polled* routes get before this side gives up on the tick.
 *
 * Everything else here inherits Node's default, which is effectively the hub's own
 * timeout (20 s for `album/status`, 45 s for the gap) plus the socket. That is right
 * for a one-shot the user pressed, and wrong for something running every five
 * seconds: a tick that has not answered in twelve has already missed its slot, and
 * the next one will do. The hub's timeouts sitting above this is deliberate — the
 * client is the side that has to give up first.
 */
const POLL_TIMEOUT_MS = 12_000;

/**
 * The one place an lb-bot request is made.
 *
 * Returns a result rather than `null` so a caller can tell "lb-bot said no" from
 * "the hub isn't there" from "this hub is too old". The fail-soft readers below
 * throw that away again on purpose; the writes and the user-initiated reads do
 * not — see LbBotResult.
 */
const request = async <T = Json>(
    method: 'GET' | 'POST',
    path: string,
    options: { body?: Json; params?: Record<string, string>; timeoutMs?: number } = {},
): Promise<LbBotResult<T>> => {
    const base = hubBase();
    if (!base) return failed(0, 'No navi-connect hub is configured.');
    let res: Response;
    try {
        const url = new URL(`${base}${path}`);
        for (const [key, value] of Object.entries(options.params ?? {})) {
            if (value) url.searchParams.set(key, value);
        }
        res = await fetch(url.toString(), {
            ...(options.body ? { body: JSON.stringify(options.body) } : {}),
            headers: {
                ...authHeaders(),
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            },
            method,
            ...(options.timeoutMs ? { signal: AbortSignal.timeout(options.timeoutMs) } : {}),
        });
    } catch (error) {
        // With the cause: `TypeError: fetch failed` on its own says only that
        // something went wrong at the socket, and the cause is the difference
        // between a hub that is down, a name that doesn't resolve and a request
        // that timed out.
        const cause = (error as { cause?: unknown }).cause;
        console.error(
            `[lbbot] ${method} ${path} — ${String(error)}${cause ? ` (${String(cause)})` : ''}`,
        );
        return failed(0, 'Could not reach the hub — it may be down or still starting.');
    }

    let body: Json | null = null;
    try {
        body = (await res.json()) as Json;
    } catch {
        body = null;
    }

    if (!res.ok) {
        // Logged unconditionally: a button that does nothing, with nothing in the
        // console either, is the bug this whole result type exists to prevent.
        console.error(`[lbbot] ${method} ${path} → ${res.status}`);
        return failed(res.status, describeFailure(res.status, body));
    }
    return { data: (body ?? {}) as T, error: '', ok: true, status: res.status };
};

/** Fail-soft read: an unreachable hub, an unconfigured LBBOT_URL and an upstream
 *  error all collapse to null, and the surface hides itself. Right for the probe
 *  and the discography; wrong for anything the user pressed. */
const get = async (path: string, params?: Record<string, string>): Promise<Json | null> =>
    (await request('GET', path, { params })).data;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number => {
    const n = typeof value === 'string' ? Number(value) : (value as number);
    return Number.isFinite(n) ? n : 0;
};

// ---------------------------------------------------------------------------
// Availability probe
// ---------------------------------------------------------------------------

// The hub always answers /lb/status, even with LBBOT_URL unset — that is the
// whole point of routing the prefix unconditionally, so "not configured" arrives
// as JSON rather than as the WebSocket upgrade's 426 text/plain.
//
// `routes` is what this hub can actually proxy. A client ships independently of
// the hub, and the hub is a long-running process, so "my app is newer than the
// hub it talks to" is a permanent condition rather than an edge case. Passing
// the list on lets the UI say "this hub can't do gap filling yet — restart it"
// instead of offering a button that 404s. An *empty* list is an older hub that
// doesn't advertise: assume supported rather than hiding working features.
ipcMain.handle('lbbot-status', async (): Promise<LbBotStatus> => {
    const data = await get('/lb/status');
    return {
        available: data?.configured === true && data?.upstreamReachable === true,
        routes: Array.isArray(data?.routes)
            ? data.routes.filter((route): route is string => typeof route === 'string')
            : [],
    };
});

// ---------------------------------------------------------------------------
// Discography
// ---------------------------------------------------------------------------

const toRelease = (row: unknown): LbBotRelease[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    const rgid = str(r.rgid);
    if (!rgid) return [];
    const ndIds = Array.isArray(r.navidrome_album_ids)
        ? r.navidrome_album_ids.filter((id): id is string => typeof id === 'string')
        : [];
    const secondary = Array.isArray(r.secondary_types)
        ? r.secondary_types.flatMap((t) => (typeof t === 'string' && t ? [t.toLowerCase()] : []))
        : [];
    // The `incomplete` extras. lb-bot doesn't merely *label* a release
    // incomplete — it builds the Fill-gaps review group while classifying it
    // (`_make_review_group`, source="artist_discography"), so `group_id` here is
    // a live handle needing no separate scan and no extra call. Dropping these
    // was what made gap filling look like it needed new plumbing upstream.
    //
    // **The counts are `present`/`total`, and only on `incomplete` rows.** They
    // are not the `present_tracks`/`total_tracks` spelling used elsewhere in
    // lb-bot's API, and reading that spelling here is what left every incomplete
    // album with a 0/0 count — so the `9/12` badge measured nothing, rendered
    // nothing, and the artist page had no way at all to say which albums were
    // short of tracks.
    const groupId = str(r.group_id);
    return [
        {
            effectiveType: str(r.effective_type) || str(r.primary_type),
            ...(groupId ? { groupId } : {}),
            navidromeAlbumIds: ndIds,
            ...(r.present == null ? {} : { presentTracks: num(r.present) }),
            primaryType: str(r.primary_type).toLowerCase(),
            rgid,
            secondaryTypes: secondary,
            status: (str(r.status) || 'missing') as LbBotReleaseStatus,
            title: str(r.title),
            ...(r.total == null ? {} : { totalTracks: num(r.total) }),
            year: str(r.year) || (r.year ? String(r.year) : ''),
        },
    ];
};

// An instant SQLite read on lb-bot's side keyed by the Navidrome artist id the
// page already holds — never a MusicBrainz round trip, so it is safe to fire on
// every artist page open. `indexed: false` means "never scanned", which the UI
// offers to fix; it is not an error.
ipcMain.handle(
    'lbbot-discography',
    async (_event, args: { mbid?: string; ndId: string }): Promise<LbBotDiscography | null> => {
        if (!args.ndId && !args.mbid) return null;
        const data = await get('/lb/artist/discography', {
            mbid: args.mbid ?? '',
            nd_id: args.ndId,
        });
        if (!data) return null;
        if (data.indexed !== true) {
            return { artistName: '', indexed: false, releases: [], scannedAt: 0, stale: false };
        }
        const releases = Array.isArray(data.releases) ? data.releases : [];
        return {
            artistName: str(data.artist_name),
            indexed: true,
            releases: releases.flatMap(toRelease),
            // Epoch seconds of the scan that built this index. It is the only
            // thing that changes when a *rescan* of an already-indexed artist
            // finishes — `indexed` was already true — so it is what the rescan
            // button watches to know it is done.
            scannedAt: num(data.scanned_at),
            stale: data.stale === true,
        };
    },
);

// Scanning an artist walks MusicBrainz at one request a second — 10-60s for a
// large discography — so it is always an explicit user action, never automatic
// on page open. Returns the background task id, or null if the trigger failed.
ipcMain.handle(
    'lbbot-index-artist',
    async (_event, args: { mbid: string; name: string; ndId: string }): Promise<null | string> => {
        // lb-bot requires both: the MBID is what it scans, the name is what it
        // matches the library against. Without an MBID there is nothing to ask.
        if (!args.mbid || !args.name) return null;
        const { data } = await request('POST', '/lb/artist/discography', {
            body: { mbid: args.mbid, name: args.name, nd_id: args.ndId },
        });
        return data?.ok === true ? str(data.task_id) : null;
    },
);

// ---------------------------------------------------------------------------
// Missing-album detail + download
// ---------------------------------------------------------------------------

const toEdition = (row: unknown): LbBotEdition[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    return [
        {
            coverUrl: str(r.coverUrl),
            format: str(r.format),
            label: str(r.label),
            releaseMbid: str(r.releaseMbid),
            year: str(r.year),
        },
    ];
};

const toVariant = (row: unknown): LbBotVariant[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    const editions = Array.isArray(r.editions) ? r.editions.flatMap(toEdition) : [];
    return [
        {
            coverUrl: str(r.coverUrl),
            disambiguation: str(r.disambiguation),
            editions,
            releaseMbid: str(r.releaseMbid),
            title: str(r.title),
            trackCount: num(r.trackCount),
            year: str(r.year),
        },
    ];
};

// Unlike the discography read, this one sits on a rate-limited MusicBrainz call
// upstream. The hub caches it for hours (the editions of a release do not
// change), but a cold call can take seconds — the sheet must show a skeleton.
ipcMain.handle(
    'lbbot-album-releases',
    async (_event, args: { rgid: string }): Promise<LbBotReleaseDetail | null> => {
        if (!args.rgid) return null;
        const data = await get('/lb/album/releases', { rgid: args.rgid });
        if (!data) return null;
        const releases = Array.isArray(data.releases) ? data.releases : [];
        return {
            artist: str(data.artist),
            coverUrl: str(data.coverUrl),
            title: str(data.title),
            variants: releases.flatMap(toVariant),
        };
    },
);

// `presenceKnown` is false for an album the library holds nothing of — which is
// the normal case here. Every track is missing; that is not an error state.
ipcMain.handle(
    'lbbot-album-tracklist',
    async (
        _event,
        args: { albumIds?: string[]; releaseMbid: string },
    ): Promise<LbBotTracklist | null> => {
        if (!args.releaseMbid) return null;
        const data = await get('/lb/album/tracklist', {
            album_ids: (args.albumIds ?? []).join(','),
            release_mbid: args.releaseMbid,
        });
        if (!data) return null;
        const rows = Array.isArray(data.tracks) ? data.tracks : [];
        const presenceKnown = data.presenceKnown === true;
        return {
            presenceKnown,
            tracks: rows.flatMap((row): LbBotTrack[] => {
                if (!row || typeof row !== 'object') return [];
                const r = row as Json;
                return [
                    {
                        position: num(r.position),
                        present: presenceKnown ? r.present === true : undefined,
                        title: str(r.title),
                    },
                ];
            }),
        };
    },
);

const UNKNOWN_STATUS: LbBotFillStatus = {
    album: '',
    artist: '',
    done: 0,
    failed: 0,
    groupId: '',
    mp3WouldHelp: false,
    percent: 0,
    quality: '',
    reason: '',
    releaseMbid: '',
    rgid: '',
    state: 'unknown',
    total: 0,
};

const toFillStatus = (data: Json | null): LbBotFillStatus => {
    if (!data) return UNKNOWN_STATUS;
    return {
        album: str(data.album),
        artist: str(data.artist),
        done: num(data.done),
        failed: num(data.failed),
        groupId: str(data.groupId),
        mp3WouldHelp: data.mp3WouldHelp === true,
        percent: num(data.percent),
        quality: str(data.quality),
        reason: str(data.reason),
        releaseMbid: str(data.releaseMbid),
        rgid: str(data.rgid),
        state: (str(data.state) || 'unknown') as LbBotFillState,
        total: num(data.total),
    };
};

// Idempotent per release-group on lb-bot's side: tapping Download twice (or from
// two devices) returns the fill already in flight instead of starting a second
// search, a second set of transfers and a second placement pass over one folder.
ipcMain.handle(
    'lbbot-download-album',
    async (
        _event,
        args: {
            artist?: string;
            quality?: string;
            releaseMbid?: string;
            rgid: string;
            sourceFolder?: string;
            sourceUsername?: string;
            title?: string;
            totalTracks?: number;
        },
    ): Promise<LbBotDownloadResult> => {
        if (!args.rgid) {
            return { error: 'No release', existing: false, ok: false, releaseMbid: '', status: 0 };
        }
        // An empty quality is omitted rather than sent: lb-bot reads "" as "use
        // the global Source preference", and sending the key at all would make
        // this download look like an override in its own status view. Same for
        // the chosen source — absent means "let lb-bot rank".
        const result = await request('POST', '/lb/album/download', {
            body: {
                rgid: args.rgid,
                // The edition the user picked, which lb-bot now honours instead
                // of re-resolving the group to "official, earliest" — and which
                // also sidesteps its MusicBrainz failure cooldown. `rgid` still
                // rides along: placement uses it to flip the index row.
                ...(args.releaseMbid
                    ? {
                          artist: args.artist ?? '',
                          release_mbid: args.releaseMbid,
                          title: args.title ?? '',
                          total_tracks: args.totalTracks ?? 0,
                      }
                    : {}),
                ...(args.quality ? { quality: args.quality } : {}),
                ...(args.sourceUsername ? { sourceUsername: args.sourceUsername } : {}),
                ...(args.sourceFolder ? { sourceFolder: args.sourceFolder } : {}),
            },
        });
        const data = result.data;
        const resolved = (data?.resolved ?? {}) as Json;
        const ok = result.ok && data?.ok === true;
        return {
            // A 200 carrying `ok: false` is lb-bot refusing for its own reason —
            // which it states in `error`, and which is the sentence worth showing.
            error: ok ? '' : result.error || str(data?.error) || 'lb-bot refused the download.',
            existing: data?.existing === true,
            ok,
            releaseMbid: str(resolved.release_mbid),
            status: result.status,
        };
    },
);

// The progress poll. Deliberately not the task id from the download call: that
// task completes the moment slskd accepts the enqueue, roughly a minute before
// anything reaches the library. Poll only while a relevant view is open, and no
// faster than the hub's cache TTL.
ipcMain.handle(
    'lbbot-album-status',
    async (_event, args: { releaseMbid?: string; rgid?: string }): Promise<LbBotFillStatus> => {
        if (!args.releaseMbid && !args.rgid) return UNKNOWN_STATUS;
        return toFillStatus(
            (
                await request('GET', '/lb/album/status', {
                    params: {
                        release_mbid: args.releaseMbid ?? '',
                        rgid: args.rgid ?? '',
                    },
                    timeoutMs: POLL_TIMEOUT_MS,
                })
            ).data,
        );
    },
);

// Widens the accepted formats for one album's searches only — lb-bot's global
// policy stays flac/opus. Offered only when a failure reported `mp3WouldHelp`
// and lb-bot has a review group for the album to hang the flag on.
ipcMain.handle(
    'lbbot-allow-mp3',
    async (_event, args: { allow?: boolean; groupId: string }): Promise<boolean> => {
        if (!args.groupId) return false;
        const { data } = await request('POST', '/lb/album/allow-mp3', {
            body: { allow: args.allow !== false, group_id: args.groupId },
        });
        return data?.ok === true;
    },
);

// ---------------------------------------------------------------------------
// Source review — shared by the album download (§3) and gap filling (§4)
// ---------------------------------------------------------------------------
//
// One set of normalizers, because the two flows show the same thing: lb-bot's
// ranked Soulseek folders, each paired against a canonical tracklist. The only
// difference is where the files come from — `/lb/album/sources` carries them
// inline, `/lb/gap` has them stripped by the hub and needs `gapSourceFiles`.

const strList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

const toCoverage = (value: unknown): LbBotSourceCoverage => {
    const r = (value ?? {}) as Json;
    return {
        haveTracks: num(r.haveTracks),
        totalTracks: num(r.totalTracks),
        unmatched: strList(r.unmatched),
    };
};

const toSourceFile = (row: unknown): LbBotSourceFile[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    const match = r.matchedTo;
    return [
        {
            accepted: r.accepted !== false,
            bitrate: num(r.bitrate),
            durationSec: num(r.durationSec),
            ext: str(r.ext),
            filename: str(r.filename),
            // Null is meaningful, not missing: a file matching no tracklist slot
            // is the tell that a folder is the wrong album however plausible its
            // name reads. Never collapse it to an empty object.
            matchedTo:
                match && typeof match === 'object'
                    ? {
                          basis: str((match as Json).basis),
                          position: str((match as Json).position),
                          title: str((match as Json).title),
                      }
                    : null,
            sizeMb: num(r.sizeMb),
        },
    ];
};

const toSource = (row: unknown): LbBotGapSource[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    return [
        {
            albumMatch: num(r.albumMatch),
            albumMatchOk: r.albumMatchOk === true,
            bitrate: str(r.bitrate),
            coverage: str(r.coverage),
            coverageDetail: toCoverage(r.coverageDetail),
            coverageFull: r.coverageFull === true,
            fileCount: num(r.fileCount),
            files: Array.isArray(r.files) ? r.files.flatMap(toSourceFile) : [],
            filesTruncated: r.filesTruncated === true,
            flags: strList(r.flags),
            folder: str(r.folder),
            format: str(r.format),
            freeSlot: r.freeSlot === true,
            id: num(r.id),
            peer: str(r.peer),
            queueLength: num(r.queueLength),
            rank: num(r.rank),
            recommendation: str(r.recommendation),
            recommended: r.recommended === true,
            score: num(r.score),
            size: str(r.size),
            speedMbps: num(r.speedMbps),
        },
    ];
};

// The route no client ever called, and the one that makes a download reviewable.
// Coverage here is computed against the canonical MusicBrainz tracklist rather
// than a file count — lb-bot's own comment records that the count-based version
// "reported a folder holding a completely different album as a complete match".
//
// Slow on purpose: a live slskd fan-out, 30-90s. The hub gives it the long
// timeout and a short cache so re-opening the modal doesn't start another search.
// Unlike the gap poll this is NOT stripped, so the per-file evidence rides along
// with the search and needs no second call.
ipcMain.handle(
    'lbbot-album-sources',
    async (
        _event,
        args: {
            album?: string;
            artist?: string;
            releaseMbid?: string;
            rgid: string;
            total?: number;
        },
    ): Promise<LbBotResult<LbBotGapSource[]>> => {
        if (!args.rgid) return failed(0, 'No release');
        // The release we already resolved, when we have one. lb-bot otherwise
        // re-resolves the group at MusicBrainz, and its resolver caches a
        // transient failure for five minutes without retrying inside that
        // window — so one 503 made this a hard "Could not resolve album" for the
        // same album for the next five minutes. These values came from
        // /lb/album/releases, so they cost nothing.
        const result = await request('GET', '/lb/album/sources', {
            params: {
                rgid: args.rgid,
                ...(args.releaseMbid
                    ? {
                          album: args.album ?? '',
                          artist: args.artist ?? '',
                          release_mbid: args.releaseMbid,
                          total: String(args.total ?? 0),
                      }
                    : {}),
            },
        });
        if (!result.ok) return failed(result.status, result.error);
        const rows = Array.isArray(result.data?.sources) ? result.data.sources : [];
        return { data: rows.flatMap(toSource), error: '', ok: true, status: result.status };
    },
);

// ---------------------------------------------------------------------------
// Gap filling
// ---------------------------------------------------------------------------

const toGapTrack = (row: unknown): LbBotGapTrack[] => {
    if (!row || typeof row !== 'object') return [];
    const r = row as Json;
    return [
        {
            downloadError: str(r.downloadError),
            position: num(r.position),
            state: (str(r.state) || 'missing') as LbBotGapTrackState,
            title: str(r.title),
        },
    ];
};

const toGapTask = (value: unknown): LbBotGapTask | null => {
    if (!value || typeof value !== 'object') return null;
    const r = value as Json;
    return {
        current: str(r.current),
        error: str(r.error),
        id: str(r.id),
        label: str(r.label),
        status: str(r.status),
        summary: str(r.summary),
    };
};

// One review group: the tracklist with per-track state, the ranked sources, and
// the running search. Never cached by the hub, and `sources[].files` is stripped
// there — that listing is fetched per source, on demand, below.
//
// Deliberately NOT /api/tasks or /api/gaps: both deep-copy lb-bot's entire
// multi-MB review state under its process-wide lock, and neither is whitelisted.
// Everything a client needs about a running search is `sourceTask` here.
ipcMain.handle(
    'lbbot-gap',
    async (_event, args: { groupId: string }): Promise<LbBotResult<LbBotGap>> => {
        if (!args.groupId) return failed(0, 'No review group');
        const result = await request('GET', '/lb/gap', {
            params: { group_id: args.groupId },
            timeoutMs: POLL_TIMEOUT_MS,
        });
        if (!result.ok) return failed(result.status, result.error);
        const d = result.data ?? {};
        return {
            data: {
                album: str(d.album),
                albumId: str(d.albumId),
                allowMp3: d.allowMp3 === true,
                artist: str(d.artist),
                canonicalMbid: str(d.canonicalMbid),
                extra: num(d.extra),
                failDetail: str(d.failDetail),
                failReason: str(d.failReason),
                id: str(d.id) || args.groupId,
                missingCount: num(d.missingCount),
                mp3WouldHelp: d.mp3WouldHelp === true,
                noSourceReason: str(d.noSourceReason),
                present: num(d.present),
                sources: Array.isArray(d.sources) ? d.sources.flatMap(toSource) : [],
                sourcesFoundAt: num(d.sourcesFoundAt),
                sourcesPage: num(d.sourcesPage),
                sourcesPages: num(d.sourcesPages),
                sourcesTotal: num(d.sourcesTotal),
                sourceTask: toGapTask(d.sourceTask),
                status: (str(d.status) || 'ready') as LbBotGapStatus,
                total: num(d.total),
                tracks: Array.isArray(d.tracks) ? d.tracks.flatMap(toGapTrack) : [],
            },
            error: '',
            ok: true,
            status: result.status,
        };
    },
);

// The counterpart to the hub's `strip` on /lb/gap: the poll can't afford every
// source's peer listing, but the user still has to be able to answer "does this
// peer actually have my missing tracks, or twelve from another pressing". So it
// is fetched once, when a source is expanded. Upstream expands the peer's real
// directory, so it is slow — and `expanded: false` means the peer was
// unreachable and these rows are the original search hits, not the real folder.
ipcMain.handle(
    'lbbot-gap-source-files',
    async (
        _event,
        args: { groupId: string; sourceIndex: number },
    ): Promise<LbBotResult<LbBotSourceFiles>> => {
        if (!args.groupId) return failed(0, 'No review group');
        const result = await request('GET', '/lb/gap/source-files', {
            params: { group_id: args.groupId, source_index: String(args.sourceIndex) },
        });
        if (!result.ok) return failed(result.status, result.error);
        const d = result.data ?? {};
        return {
            data: {
                coverage: str(d.coverage),
                coverageDetail: toCoverage(d.coverageDetail),
                expanded: d.expanded === true,
                fileCount: num(d.fileCount),
                files: Array.isArray(d.files) ? d.files.flatMap(toSourceFile) : [],
                filesTruncated: d.filesTruncated === true,
            },
            error: '',
            ok: true,
            status: result.status,
        };
    },
);

/** The gap writes. Each answers with a task id the clients discard — `sourceTask`
 *  on the gap detail is how a running search is watched. */
const gapAction = async (route: string, body: Json): Promise<LbBotResult<boolean>> => {
    const result = await request('POST', route, { body });
    if (!result.ok) return failed(result.status, result.error);
    const ok = result.data?.ok !== false;
    return {
        data: ok,
        error: ok ? '' : str(result.data?.error) || 'lb-bot refused the request.',
        ok,
        status: result.status,
    };
};

// Find sources without enqueuing anything — the review step, and the reason §3
// and §4 share components. NOTE the trap this route sets: the POST approves the
// group's pending missing tracks and *then* starts the background search, so the
// very next poll reads `picking` with an empty source list. Terminal judgements
// belong on `sourceTask.status`, never on the group's own `status`.
ipcMain.handle('lbbot-gap-search', async (_event, args: { force?: boolean; groupId: string }) =>
    args.groupId
        ? gapAction('/lb/gap/search', { force: args.force === true, group_id: args.groupId })
        : failed<boolean>(0, 'No review group'),
);

// Search, rank and commit in one shot. Kept, but demoted: it is the old blind
// behaviour, and the picker exists because blind picked wrong.
ipcMain.handle('lbbot-gap-auto', async (_event, args: { groupId: string }) =>
    args.groupId
        ? gapAction('/lb/gap/auto', { group_id: args.groupId })
        : failed<boolean>(0, 'No review group'),
);

ipcMain.handle('lbbot-gap-fetch', async (_event, args: { groupId: string; sourceId: number }) =>
    args.groupId
        ? gapAction('/lb/gap/fetch', { group_id: args.groupId, sourceId: args.sourceId })
        : failed<boolean>(0, 'No review group'),
);

ipcMain.handle('lbbot-gap-cancel', async (_event, args: { groupId: string }) =>
    args.groupId
        ? gapAction('/lb/gap/cancel', { group_id: args.groupId })
        : failed<boolean>(0, 'No review group'),
);

// Re-reads the album from Navidrome *and* walks its folder for files Navidrome
// hasn't indexed yet — which is also the manual reconcile after a fill lands.
ipcMain.handle('lbbot-gap-rescan', async (_event, args: { groupId: string }) =>
    args.groupId
        ? gapAction('/lb/gap/rescan', { group_id: args.groupId })
        : failed<boolean>(0, 'No review group'),
);

/**
 * Tell the user a fill landed while Feishin was in the background.
 *
 * The renderer raises a toast unconditionally; this is the half a toast cannot do,
 * and it is deliberately suppressed when the window is focused so a fill that
 * completes while the user is watching does not announce itself twice.
 *
 * `Notification.isSupported()` is false on some Linux setups with no notification
 * daemon, where constructing one throws.
 */
ipcMain.handle('lbbot-notify', (event, args: { body: string; title: string }) => {
    if (!Notification.isSupported()) return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window?.isFocused()) return;
    try {
        const notification = new Notification({ body: args.body, title: args.title });
        // Bring Feishin forward on click — the album is on an artist page somewhere,
        // and the notification is the only handle the user has on it.
        notification.on('click', () => {
            window?.show();
            window?.focus();
        });
        notification.show();
    } catch (error) {
        console.error(`[lbbot] could not post notification — ${String(error)}`);
    }
});
