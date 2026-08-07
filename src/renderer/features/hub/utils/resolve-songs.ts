import { api } from '/@/renderer/api';
import { LibraryItem, Song } from '/@/shared/types/domain-types';

// navi-connect: shared id → Song resolution for anything that arrives as bare hub track
// metadata (a `do:load`/`do:queueChanged` directive, or a saved-queue record minted by the
// other client). Extracted so the hub hook and the saved-queue restore path can't drift.

/** The minimal track shape the hub wire format carries. */
export interface HubTrackLike {
    album?: null | string;
    artist?: null | string;
    durationMs?: null | number;
    favorite?: boolean;
    id: string;
    imageUrl?: null | string;
    rating?: null | number;
    title?: null | string;
}

/**
 * Synthesize a playable Song from hub track metadata. Used for any id the server
 * couldn't resolve — the id is a valid Navidrome id on this single-server setup, so
 * playback (and cover art, which is keyed by the same id) still works.
 */
export const placeholderSong = (track: HubTrackLike, serverId: string): Song =>
    ({
        // Non-negotiable: plenty of code reads `_itemType` without guarding it (use-scrobble does
        // `song._itemType.includes('song')`), so a stub without it crashes the moment it becomes the
        // playing song — which is every restore of a hub-derived queue.
        _itemType: LibraryItem.SONG,
        _serverId: serverId,
        album: track.album ?? '',
        albumArtists: [],
        albumId: undefined,
        artistName: track.artist ?? '',
        artists: track.artist ? [{ id: '', name: track.artist }] : [],
        duration: track.durationMs ?? 0,
        id: track.id,
        // The song id doubles as the cover-art id across this system; build the cover
        // with our own server creds (imageUrl left unset).
        imageId: track.id,
        imageUrl: track.imageUrl ?? undefined,
        name: track.title ?? '',
        userFavorite: track.favorite ?? false,
        userRating: track.rating ?? null,
    }) as unknown as Song;

/**
 * Resolve hub tracks to full Songs, STRICTLY 1:1 with the input. Filtering out songs
 * missing from this server's library (or a transient getSongDetail failure) would
 * shorten the queue and shift every index after it — the hub's `index` would then point
 * at the wrong track, which reads as the queue "resetting" after a transfer. Mirrors
 * Navic's resolveQueue.
 */
export const resolveHubTracks = async (
    tracks: HubTrackLike[],
    serverId: null | string,
): Promise<Song[]> => {
    if (!serverId || !tracks?.length) return [];
    const results = await Promise.all(
        tracks.map((track) =>
            api.controller
                .getSongDetail({ apiClientProps: { serverId }, query: { id: track.id } })
                .catch(() => null),
        ),
    );
    return results.map((song, i) => song ?? placeholderSong(tracks[i], serverId));
};
