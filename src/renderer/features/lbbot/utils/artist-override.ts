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
