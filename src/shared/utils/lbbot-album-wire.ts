import type {
    LbBotAlbumFailure,
    LbBotAlbumOverrideRow,
    LbBotAlbumState,
    LbBotAlbumTrackTag,
    LbBotCover,
    LbBotPreview,
    LbBotPreviewFile,
    LbBotPreviewSlot,
} from '/@/shared/types/lbbot-types';

/**
 * I-022: lb-bot's album-override bodies, read defensively.
 *
 * Pure (no Electron), so `lbbot-album-wire.harness.ts` can run it. The rules are
 * the project's usual ones: a field the body lacks is its empty value, a row
 * without its identity is not a row, and nothing is invented - `override: null`
 * means "no override", which is not an empty row.
 */

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => !!value && typeof value === 'object';
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const num = (value: unknown): number => {
    const n = typeof value === 'string' ? Number(value) : (value as number);
    return Number.isFinite(n) ? n : 0;
};

const toFailure = (row: unknown): LbBotAlbumFailure[] => {
    if (!isObject(row)) return [];
    const title = str(row.title);
    return title ? [{ reason: str(row.reason), title }] : [];
};

export const toOverrideRow = (row: unknown): LbBotAlbumOverrideRow | null => {
    if (!isObject(row)) return null;
    const id = str(row.id);
    if (!id) return null;
    return {
        album: str(row.album),
        albumId: str(row.albumId),
        artist: str(row.artist),
        coverUrl: str(row.coverUrl),
        done: num(row.done),
        failures: Array.isArray(row.failures) ? row.failures.flatMap(toFailure) : [],
        id,
        prevReleaseMbid: str(row.prevReleaseMbid),
        releaseMbid: str(row.releaseMbid),
        rgid: str(row.rgid),
        setAt: num(row.setAt),
        state: str(row.state),
        total: num(row.total),
    };
};

const toTag = (row: unknown): LbBotAlbumTrackTag[] => {
    if (!isObject(row)) return [];
    return [
        {
            disc: num(row.disc),
            duration: num(row.duration),
            title: str(row.title),
            track: num(row.track),
        },
    ];
};

export const toAlbumState = (body: unknown): LbBotAlbumState => {
    const b = isObject(body) ? body : {};
    return {
        album: str(b.album),
        albumId: str(b.albumId),
        artist: str(b.artist),
        override: toOverrideRow(b.override),
        releaseMbid: str(b.releaseMbid),
        rgid: str(b.rgid),
        tracks: Array.isArray(b.tracks) ? b.tracks.flatMap(toTag) : [],
    };
};

const toCover = (row: unknown): LbBotCover[] => {
    if (!isObject(row)) return [];
    const full = str(row.full);
    if (!full) return [];
    return [
        {
            full,
            releaseMbid: str(row.releaseMbid),
            // Only a release's own front is "release"; anything else is read as
            // the less specific claim.
            source: row.source === 'release' ? 'release' : 'release-group',
            thumb: str(row.thumb) || full,
        },
    ];
};

export const toCovers = (body: unknown): LbBotCover[] =>
    isObject(body) && Array.isArray(body.covers) ? body.covers.flatMap(toCover) : [];

const toSlot = (row: unknown): LbBotPreviewSlot | null =>
    isObject(row) ? { disc: num(row.disc), title: str(row.title), track: num(row.track) } : null;

const toFile = (row: unknown): LbBotPreviewFile[] => {
    if (!isObject(row)) return [];
    const from = toSlot(row.from);
    if (!from) return [];
    const to = toSlot(row.to);
    return [
        {
            basis: to ? str(row.basis) : '',
            // A file with no slot is left untouched, so it cannot be a change.
            changed: to ? row.changed === true : false,
            from,
            to,
        },
    ];
};

export const toPreview = (body: unknown): LbBotPreview => {
    const b = isObject(body) ? body : {};
    const release = isObject(b.release) ? b.release : {};
    const files = Array.isArray(b.files) ? b.files.flatMap(toFile) : [];
    const slotted = files.filter((file) => file.to !== null).length;
    return {
        albumId: str(b.albumId),
        files,
        matched: typeof b.matched === 'number' ? num(b.matched) : slotted,
        missing: Array.isArray(b.missing)
            ? b.missing.flatMap((slot) => {
                  const parsed = toSlot(slot);
                  return parsed ? [parsed] : [];
              })
            : [],
        release: {
            country: str(release.country),
            disambiguation: str(release.disambiguation),
            discCount: num(release.discCount),
            format: str(release.format),
            title: str(release.title),
            trackCount: num(release.trackCount),
            year: str(release.year),
        },
        releaseMbid: str(b.releaseMbid),
        unmatched: typeof b.unmatched === 'number' ? num(b.unmatched) : files.length - slotted,
    };
};
