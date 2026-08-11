/**
 * lb-bot wire shapes, shared by the main-process client, the preload bridge and
 * the renderer. lb-bot speaks snake_case; the main process normalizes to these
 * once so nothing downstream has to know that.
 *
 * See ../../../../DESIGN-lbbot-client-integration.md.
 */

export interface LbBotDiscography {
    artistName: string;
    indexed: boolean;
    releases: LbBotRelease[];
    /** Epoch seconds of the scan that built this index. Upstream: `scanned_at`. */
    scannedAt: number;
    /** Index older than lb-bot's TTL, or built by an older scan version. */
    stale: boolean;
}

export interface LbBotDownloadResult {
    /** Empty when ok. lb-bot's own sentence where it wrote one — it writes them
     *  for humans, so it is shown verbatim rather than paraphrased. */
    error: string;
    /** A fill for this release was already in flight; the second tap is a no-op. */
    existing: boolean;
    ok: boolean;
    releaseMbid: string;
    /** HTTP status, or 0 when the request never left this process. */
    status: number;
}

/**
 * Which copy of an album to prefer when several are on offer.
 *
 * Mirrors lb-bot's `QUALITY_PREFERENCES`. Held here rather than fetched because
 * lb-bot's only reader of the list is its prefs endpoint, which is a *write*
 * surface the hub deliberately does not whitelist — and the set has to change on
 * lb-bot's side before it could mean anything here anyway. An unknown value is
 * rejected upstream with a 400, so drift fails loudly rather than silently
 * fetching the wrong thing.
 */
export type LbBotQuality = 'flac-16-44' | 'flac-any' | 'highest-bitrate' | 'prefer-opus';

/**
 * Every write, and every read a user is waiting on, answers with this.
 *
 * The old contract was `null` on any failure, which is right for the availability
 * probe and the discography read — those hide their surface — and wrong for a
 * button: pressing it and getting nothing back, no message and no log, is
 * indistinguishable from the app being broken. It cost a full round of feedback
 * on the Navic side, where the real cause was a hub that hadn't been restarted
 * and was 404ing every new route.
 */
export interface LbBotResult<T> {
    data: null | T;
    /** Empty when `ok`. lb-bot's own `error` sentence when it wrote one, else a
     *  translated transport failure — see `describeFailure` in the main client. */
    error: string;
    ok: boolean;
    /** HTTP status, or 0 when the request never left this process. */
    status: number;
}

/** What the hub says it can proxy. An empty list means an older hub that doesn't
 *  advertise — assume supported rather than hiding working features. */
export interface LbBotStatus {
    available: boolean;
    routes: string[];
}

export const LB_BOT_QUALITY_OPTIONS: { label: string; value: LbBotQuality }[] = [
    { label: 'Best FLAC available', value: 'flac-any' },
    { label: 'CD quality (16-bit/44.1kHz)', value: 'flac-16-44' },
    { label: 'Highest bitrate', value: 'highest-bitrate' },
    { label: 'Prefer Opus', value: 'prefer-opus' },
];

export interface LbBotEdition {
    coverUrl: string;
    format: string;
    /** Digital | CD | Vinyl | Cassette | Other */
    label: string;
    releaseMbid: string;
    year: string;
}

/**
 * unknown → searching → queued → downloading → placing → placed → verified,
 * with needs_match and failed as side exits.
 *
 * `unknown` is the resting state of every album nobody has asked for, so it must
 * never render as an error. `placed` means the files are in the library folder;
 * `verified` means Navidrome has indexed them, which is the only state that
 * really answers "is it in my library".
 */
export type LbBotFillState =
    | 'downloading'
    | 'failed'
    | 'needs_match'
    | 'placed'
    | 'placing'
    | 'queued'
    | 'searching'
    | 'unknown'
    | 'verified';

export interface LbBotFillStatus {
    album: string;
    artist: string;
    done: number;
    failed: number;
    /** lb-bot review group, when the album has one — required for Allow MP3. */
    groupId: string;
    /** The search rejected mp3s and would have found something with them. */
    mp3WouldHelp: boolean;
    percent: number;
    /** The per-fill quality override this download was started with, if any. */
    quality: string;
    /** lb-bot's own sentence for a failure. Shown verbatim. */
    reason: string;
    releaseMbid: string;
    /** The release-group the fill was started from — the handle the artist page
     *  needs to match a status back to the tile that started it. */
    rgid: string;
    state: LbBotFillState;
    total: number;
}

/**
 * One album the library holds only part of, as lb-bot's Fill-gaps workspace sees
 * it. Ported field-for-field from Navic's `LbBotManager.kt`, which mirrors
 * lb-bot's Python verbatim so any field can be checked against its source by
 * name. lb-bot speaks camelCase for its screen-shaped views (this one) and
 * snake_case for index rows (the discography).
 */
export interface LbBotGap {
    album: string;
    albumId: string;
    /** The per-album MP3 opt-in is already set. Global policy stays flac/opus. */
    allowMp3: boolean;
    artist: string;
    /**
     * The release the gap is MEASURED AGAINST, taken from your own Navidrome tag.
     * A library tagged as a 17-track deluxe reports 17 slots even when every
     * pressing on offer has 12 — which reads as a miscount, and makes the short
     * download read as a bug, unless the UI names the edition. There is no
     * edition picker for gaps: `refresh_group_missing` overwrites this from the
     * Navidrome tag on every refresh, so pinning another one needs a new override
     * field in lb-bot.
     */
    canonicalMbid: string;
    /** Files the canonical tracklist can't account for. */
    extra: number;
    failDetail: string;
    failReason: string;
    id: string;
    missingCount: number;
    /** The search rejected mp3s and would have found something with them. */
    mp3WouldHelp: boolean;
    noSourceReason: string;
    present: number;
    sources: LbBotGapSource[];
    sourcesFoundAt: number;
    sourcesPage: number;
    sourcesPages: number;
    sourcesTotal: number;
    /**
     * The running search. **Gate every terminal judgement on this**, not on
     * `status`: the search POST approves the pending tracks and *then* starts the
     * background task, so the very next poll reads `picking` with no sources.
     * While `sourceTask.status` is `running` or `queued`, nothing the group says
     * about itself is final.
     */
    sourceTask: LbBotGapTask | null;
    status: LbBotGapStatus;
    total: number;
    tracks: LbBotGapTrack[];
}

/**
 * A ranked Soulseek folder. Identical shape for `/lb/album/sources` and for the
 * sources on a gap — which is why one component renders both.
 */
export interface LbBotGapSource {
    /** How much the folder's own name reads as this album. */
    albumMatch: number;
    /** The "is this even the right record" verdict — the one that catches a
     *  self-titled album, where every candidate folder's name looks plausible. */
    albumMatchOk: boolean;
    bitrate: string;
    /** "9/12 tracks" | "full" | "partial" | "unknown". */
    coverage: string;
    /** Matched against the canonical MusicBrainz tracklist, never a file count —
     *  the count-based version reported a folder holding a completely different
     *  album as a complete match. */
    coverageDetail: LbBotSourceCoverage;
    coverageFull: boolean;
    fileCount: number;
    /**
     * Populated on `/lb/album/sources` and **always empty on a gap poll**: the
     * hub strips it there, because lb-bot embeds every ranked source's entire
     * peer listing on a route a client polls every 5s. Fetch it on demand with
     * `gapSourceFiles` instead.
     */
    files: LbBotSourceFile[];
    filesTruncated: boolean;
    /** live / compilation / risk. */
    flags: string[];
    /** → `sourceFolder` on an album download. */
    folder: string;
    format: string;
    freeSlot: boolean;
    /** → `sourceId` on a gap fetch. Its index in this list. */
    id: number;
    /** → `sourceUsername` on an album download. */
    peer: string;
    queueLength: number;
    rank: number;
    recommendation: string;
    /** `rank === 1`. Pre-selected, so the confident case is one extra tap. */
    recommended: boolean;
    score: number;
    size: string;
    speedMbps: number;
}

/**
 * `picking` means two different things and the difference matters: *with*
 * sources it is "your move" now that the client has a picker; with none it is
 * the real "finish this in lb-bot's own web UI" hand-off.
 */
export type LbBotGapStatus = 'complete' | 'downloading' | 'failed' | 'picking' | 'ready';

export interface LbBotGapTask {
    current: string;
    error: string;
    id: string;
    label: string;
    /** lb-bot ends tasks `complete` or `error` — **never** `finished`. Testing
     *  for that made an empty search look identical to one still running. */
    status: string;
    summary: string;
}

export interface LbBotGapTrack {
    downloadError: string;
    position: number;
    state: LbBotGapTrackState;
    title: string;
}

/** `present` is a track the library already has; everything else is being (or
 *  failed to be) filled. A backwards transition is normal — lb-bot reports
 *  `downloading` for as long as a transfer group is pending. */
export type LbBotGapTrackState =
    | 'done'
    | 'downloaded'
    | 'downloading'
    | 'failed'
    | 'missing'
    | 'picked'
    | 'present'
    | 'queued'
    | 'skipped';

export interface LbBotRelease {
    /** album | ep | single | compilation | live | … (lb-bot's `effective_type`). */
    effectiveType: string;
    /** `incomplete` rows only: the Fill-gaps review group lb-bot *already built*
     *  while classifying this release (`_make_review_group`, unioned at
     *  `_union_review_groups`). It is a live handle — no separate scan, no extra
     *  call — which is the whole reason gap filling needs nothing upstream.
     *  Upstream name: `group_id`. */
    groupId?: string;
    navidromeAlbumIds: string[];
    /** Tracks of this release the library holds. `incomplete` rows only.
     *  Upstream: `present` — *not* `present_tracks`, which is a different
     *  spelling used by lb-bot's screen-shaped views. */
    presentTracks?: number;
    /** MusicBrainz primary type, lowercased. Kept raw alongside `effectiveType`
     *  because the artist page groups on the same primary/secondary split
     *  Navidrome's own albums use. */
    primaryType: string;
    rgid: string;
    /** MusicBrainz secondary types, lowercased (compilation, live, remix, …). */
    secondaryTypes: string[];
    status: LbBotReleaseStatus;
    title: string;
    /** Tracks the canonical release has. `incomplete` rows only. Upstream:
     *  `total` — see `presentTracks`. */
    totalTracks?: number;
    year: string;
}

export interface LbBotReleaseDetail {
    artist: string;
    coverUrl: string;
    title: string;
    /** A variant changes the tracklist (Original / Remaster / Deluxe). */
    variants: LbBotVariant[];
}

/** How much of a release-group the library holds. */
export type LbBotReleaseStatus = 'complete' | 'incomplete' | 'missing' | 'untagged';

/**
 * A release the client has already resolved, passed to lb-bot instead of letting
 * it re-resolve the release-group.
 *
 * Two things depend on it. lb-bot's resolver picks "official, earliest" on its
 * own, so without this the edition the user chose is silently overruled. And it
 * caches a transient MusicBrainz failure for five minutes and answers {} without
 * retrying inside that window — which turned one 503 into a hard "Could not
 * resolve album" on that album for everyone who asked next.
 */
export interface LbBotResolvedEdition {
    artist: string;
    releaseMbid: string;
    title: string;
    totalTracks: number;
}

export interface LbBotSourceCoverage {
    haveTracks: number;
    totalTracks: number;
    /** Tracklist slots nothing in the folder covers. */
    unmatched: string[];
}

/**
 * One file in a peer's folder, paired against the tracklist by lb-bot's own
 * ranked matcher.
 *
 * `matchedTo` is the evidence the whole review step exists for: **a file
 * matching no slot is the tell that a folder is the wrong album, however
 * plausible its name.**
 */
export interface LbBotSourceFile {
    /** False when the format is outside lb-bot's accepted list. */
    accepted: boolean;
    bitrate: number;
    durationSec: number;
    ext: string;
    filename: string;
    matchedTo: LbBotSourceMatch | null;
    sizeMb: number;
}

export interface LbBotSourceFiles {
    coverage: string;
    coverageDetail: LbBotSourceCoverage;
    /**
     * **False means the peer was unreachable** and these rows are the original
     * search hits, not the real folder. Say so; do not imply otherwise.
     */
    expanded: boolean;
    fileCount: number;
    files: LbBotSourceFile[];
    filesTruncated: boolean;
}

export interface LbBotSourceMatch {
    /** exact | prefix | contained | fuzzy | duration | position — lb-bot grades
     *  its own confidence, and the weak tiers are worth chipping. */
    basis: string;
    position: string;
    title: string;
}

export interface LbBotTrack {
    position: number;
    /** Undefined when presence is unknown (the library holds none of this album). */
    present?: boolean;
    title: string;
}

export interface LbBotTracklist {
    presenceKnown: boolean;
    tracks: LbBotTrack[];
}

export interface LbBotVariant {
    coverUrl: string;
    disambiguation: string;
    /** Same tracklist, different pressing — each carries its own cover art. */
    editions: LbBotEdition[];
    releaseMbid: string;
    title: string;
    trackCount: number;
    year: string;
}
