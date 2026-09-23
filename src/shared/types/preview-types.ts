/**
 * navi-connect: the yt-dlp preview sidecar.
 *
 * A preview is a track the library does **not** have, played from an external
 * provider so an unowned album can be heard before it is worth acquiring. Its id
 * is `ext:<provider>:<providerId>` — the same convention lb-bot already uses for
 * `mb:<mbid>` artists and albums, and the one thing in the stack allowed to mint
 * one is the sidecar.
 *
 * **The hub does not stream.** It proxies `/preview/resolve` as ordinary buffered
 * JSON and signs the `streamUrl` on the way out; the audio itself is fetched
 * straight from the sidecar, which is the media origin. The whole rationale lives
 * in `navi-connect/CLAUDE.md` — the short version is that `HttpProxy` terminates
 * in a single `bytes` body with a library-computed `Content-Length`, so a stream
 * on the WebSocket port is truncated by `open_timeout` rather than served.
 *
 * The answer is deliberately **queue-track-shaped**: every field below is in the
 * hub's `SQ_TRACK_FIELDS` whitelist, so a preview survives saved-queue
 * sanitisation, `syncSavedQueues` and a state reload unchanged, and transfer /
 * the device picker / Continue Listening need no protocol work at all.
 */

/** The `ext:` id prefix. Nothing in this client mints one — the sidecar does. */
export const PREVIEW_ID_PREFIX = 'ext:';

export interface PreviewStatus {
    /** The hub has a `PREVIEW_URL`. False means the feature is simply off. */
    configured: boolean;
    /** Whether a cookie jar is configured and present on the sidecar. Never its
     *  contents and never its path — a health field, not a credential. Shown
     *  nowhere; it is here because it is the first thing to check when
     *  `extractorBlocked` flips. */
    cookies: boolean;
    /**
     * The extractor is being refused by the provider.
     *
     * **This is the difference between "nothing matched" and "nothing can
     * match", and without it the whole feature can be dead while every probe
     * says fine** — a blocked extractor answers `{}` to every resolve, which is
     * indistinguishable from an obscure track having no preview. A client that
     * did not read this would offer a Preview button on every row and answer
     * "no preview found" every single time.
     *
     * Additive: absent reads as false, which is the behaviour of a hub too old
     * to send it.
     */
    extractorBlocked: boolean;
    /**
     * Whether a preview can be cast.
     *
     * False when the hub has no `PREVIEW_PUBLIC_URL`, i.e. the `streamUrl` it
     * mints is a LAN address. A Chromecast fetches that URL itself, from the
     * speaker's own network position, so an unreachable one does not fail — it
     * plays silence. Decided here rather than discovered at the speaker: a
     * transfer to a cast target is refused while an `ext:` track is queued.
     */
    previewCastable: boolean;
    upstreamReachable: boolean;
}

/**
 * One resolved preview, or `null` for "no preview found".
 *
 * The sidecar answers `{}` with HTTP 200 for a track it could not match — a
 * legitimate answer and never an error, the same rule lb-bot's `strict=False`
 * metadata chain follows. The main process turns that into `null`.
 */
export interface PreviewTrack {
    album: string;
    artist: string;
    /** The sidecar's own confidence in the match, 0..1. Used to label a shaky
     *  result rather than to hide it — a wrong preview is obvious in one second,
     *  and a silently dropped one is not. */
    confidence: number;
    durationMs: number;
    /** `ext:<provider>:<providerId>`. */
    id: string;
    imageUrl: string;
    /** Cast's `MediaItemConverter` requires it, so it rides on the wire. */
    mime: string;
    provider: string;
    /** Absolute, signed (`exp` + `sig`) and fetched WITHOUT the hub token — a
     *  capability, minted by the hub, valid for `PREVIEW_TTL`. */
    streamUrl: string;
    title: string;
}
