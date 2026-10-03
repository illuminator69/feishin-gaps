import type { LbBotOverride } from '/@/shared/types/lbbot-types';

/**
 * I-019: server-stored MusicBrainz overrides for library artists.
 *
 * Pure, so `artist-override.harness.ts` can run it without React or Electron.
 * Navidrome's own tag stays the default; a row in lb-bot's `artist_overrides`
 * (keyed by the Navidrome artist id) replaces it wherever an artist MBID feeds
 * an lb-bot call or a MusicBrainz / ListenBrainz link.
 */

/** What the picker and the entry point need to tell apart. */
export type OverrideKind =
    /** No MBID at all: the tag is empty and nothing is overridden. */
    | 'none'
    /** The user set one. */
    | 'override'
    /** Set by the user, but it happens to equal Navidrome's tag. */
    | 'override-same'
    /** Navidrome's tag, no override. */
    | 'tag';

export type OverridesByNdId = Record<string, LbBotOverride>;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const BARE_UUID = new RegExp(`^${UUID}$`, 'i');
const ARTIST_URL = new RegExp(
    `^(?:https?://)?(?:[a-z0-9-]+\\.)?musicbrainz\\.org/artist/(${UUID})(?:[/?#].*)?$`,
    'i',
);

/**
 * `effectiveArtistMbid(ndId, tagMbid) = overrides[ndId]?.mbid ?? tagMbid`
 * (contract). An override with an empty `mbid` is not one. `Object.hasOwn`, not `in`: a
 * Navidrome id is opaque text and must never resolve through the prototype.
 */
export const effectiveArtistMbid = (
    overrides: null | OverridesByNdId | undefined,
    ndId: null | string | undefined,
    tagMbid: null | string | undefined,
): null | string | undefined => {
    if (overrides && ndId && Object.hasOwn(overrides, ndId)) {
        const mbid = overrides[ndId]?.mbid;
        if (mbid) return mbid;
    }
    return tagMbid;
};

/** The wire list as the map the resolver reads. A row needs both ids to mean anything. */
export const overridesByNdId = (rows: readonly LbBotOverride[]): OverridesByNdId => {
    const map: OverridesByNdId = {};
    for (const row of rows) {
        if (row.ndArtistId && row.mbid) map[row.ndArtistId] = row;
    }
    return map;
};

export const overrideKind = (
    overrides: null | OverridesByNdId | undefined,
    ndId: string,
    tagMbid: null | string | undefined,
): OverrideKind => {
    const effective = effectiveArtistMbid(overrides, ndId, tagMbid);
    const overridden = effective !== tagMbid && Boolean(effective);
    if (overridden) return 'override';
    if (overrides && Object.hasOwn(overrides, ndId) && overrides[ndId]?.mbid) {
        return 'override-same';
    }
    return tagMbid ? 'tag' : 'none';
};

/**
 * A pasted bare MBID or a `musicbrainz.org/artist/<uuid>` URL → the lowercase
 * uuid, else null. Only the artist path on musicbrainz.org (or one of its
 * subdomains): a release or label uuid is not an artist, and a look-alike host
 * is not MusicBrainz.
 */
export const parseMbidInput = (input: string): null | string => {
    const text = input.trim();
    if (BARE_UUID.test(text)) return text.toLowerCase();
    const match = ARTIST_URL.exec(text);
    return match ? match[1].toLowerCase() : null;
};

/** Why a set or remove failed, in the words the picker shows. */
export interface OverrideFailure {
    /** lb-bot's `code`, when it sent one. */
    code: string;
    message: string;
    /** HTTP status; 0 = never reached the hub. */
    status: number;
}

/**
 * A code-less 404 (the hub or an older GET-only lb-bot has no such route) and a
 * 405 (an lb-bot older than the hub: its catch-all route is GET-only, so an
 * unknown POST answers "method not allowed") both mean the same thing. A 404
 * that carries a `code` is lb-bot's own answer and stays what it is.
 */
export const describeOverrideFailure = (result: {
    code?: string;
    error?: string;
    retryable?: boolean;
    status: number;
}): OverrideFailure => {
    const base = { code: result.code ?? '', status: result.status };
    if (result.status === 409) {
        return {
            ...base,
            message: 'A fill for this artist is running. Try again when it is done.',
        };
    }
    if (result.status === 404 && result.code === 'unknown_mbid') {
        return { ...base, message: 'MusicBrainz has no artist with that id.' };
    }
    if (result.status === 404 && result.code === 'no_override') {
        return { ...base, message: 'There is no override to remove.' };
    }
    if (result.status === 405 || (result.status === 404 && !result.code)) {
        return { ...base, message: 'This lb-bot is older and cannot store overrides yet.' };
    }
    if (result.status === 502 && result.retryable) {
        // lb-bot's own words: the cause is MusicBrainz for a set and may be
        // Navidrome's artist list for a remove.
        return {
            ...base,
            message: result.error
                ? `${result.error} Nothing was changed. Try again.`
                : 'lb-bot could not complete that right now. Nothing was changed. Try again.',
        };
    }
    return { ...base, message: result.error || 'lb-bot did not accept that.' };
};

/**
 * Whether, and with what, to follow a set / remove with the page's own scan flow.
 * lb-bot starts the scan itself and answers its `task_id`; `""` means it chose
 * not to (a set onto an MBID whose discography another artist holds, or a remove
 * after which nothing resolves), and starting one anyway would rewrite the wrong
 * artist's row. A set follows with the `mbid` lb-bot answered; a remove falls
 * back to the tag, so without one there is nothing to scan.
 */
export const planScan = (
    kind: 'remove' | 'set',
    answer: { mbid?: string; taskId: string },
    requested: { mbid: string; name: string; tagMbid: null | string | undefined },
): null | { mbid: string; name: string } => {
    if (!answer.taskId || !requested.name) return null;
    const mbid = kind === 'set' ? answer.mbid || requested.mbid : requested.tagMbid;
    return mbid ? { mbid, name: requested.name } : null;
};
