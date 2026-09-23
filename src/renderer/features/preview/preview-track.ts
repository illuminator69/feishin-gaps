import { LibraryItem, QueueSong, Song } from '/@/shared/types/domain-types';
import { PREVIEW_ID_PREFIX, PreviewTrack } from '/@/shared/types/preview-types';

/**
 * navi-connect: turning a resolved preview into something the queue can hold.
 *
 * The whole design rests on one fact: an `ext:` track is an ordinary queue
 * track everywhere except at the two points that resolve a URL. It carries its
 * own signed `streamUrl`, so it needs no server, no transcode decision and no
 * `getStreamUrl` round trip — and because every field the hub keeps
 * (`SQ_TRACK_FIELDS`) is one it already has, it survives a transfer, a
 * saved-queue round trip and a state reload without a single protocol change.
 *
 * The two points that must know are:
 *   - `use-stream-url.tsx`, which resolves the playing track's URL, and
 *   - `buildHubTracks` / `buildHubTracksForSongs`, which resolve one per queue
 *     track when publishing to the hub.
 * Everything else — scrobbling, the playerbar, the queue table, Continue
 * Listening — is deliberately left unaware.
 */

/** Whether an id names a preview rather than a library track. */
export const isPreviewId = (id: null | string | undefined): boolean =>
    typeof id === 'string' && id.startsWith(PREVIEW_ID_PREFIX);

/** Whether any track in a queue is a preview. The question the cast guard asks. */
export const hasPreviewTrack = (tracks: { id: string }[]): boolean =>
    tracks.some((track) => isPreviewId(track.id));

/**
 * A queue-playable Song for a preview.
 *
 * `_serverId` is set to the current server even though nothing about this track
 * belongs to it, and that is load-bearing rather than sloppy: a whole run of the
 * player treats an empty `_serverId` as "not ready" — `useSongUrl` gates its
 * query on it, and a stub without one restores into a player sitting in PLAYING
 * with no source. The preview short-circuit fires before the server is ever
 * asked anything, so the id is never used to make a request.
 *
 * `_itemType` is equally non-negotiable: `use-scrobble` reads
 * `song._itemType.includes('song')` without guarding it, so a stub missing it
 * crashes the moment it becomes the playing track.
 *
 * `imageId` is deliberately left null. It is the *song id* elsewhere in this
 * system, and an `ext:` id handed to Navidrome's cover endpoint is a 404 per
 * render; the Cover Art Archive URL the sidecar sends goes in `imageUrl`
 * instead.
 */
export const previewSong = (track: PreviewTrack, serverId: string): Song =>
    ({
        _itemType: LibraryItem.SONG,
        _previewMime: track.mime || undefined,
        _previewStreamUrl: track.streamUrl,
        _serverId: serverId,
        album: track.album,
        albumArtists: [],
        albumId: undefined,
        artistName: track.artist,
        artists: track.artist ? [{ id: '', name: track.artist }] : [],
        duration: Math.round((track.durationMs || 0) / 1000),
        id: track.id,
        imageId: null,
        imageUrl: track.imageUrl || undefined,
        name: track.title,
        userFavorite: false,
        userRating: null,
    }) as unknown as Song;

/**
 * The hub wire record for a preview track.
 *
 * Shared by the two publishers so they cannot drift — the failure mode if they
 * do is silent and expensive: the other device receives an `ext:` track with a
 * Navidrome stream URL attached (or none), and plays nothing while showing a
 * perfectly normal playing bar.
 *
 * Note `streamUrl` is passed through *verbatim*, not rewritten to the public
 * server base the way a library track's is. It is already absolute and already
 * signed — rewriting its host to Navidrome's would point it at a server that has
 * never heard of the file.
 */
export const previewHubTrack = (song: QueueSong | Song): Record<string, unknown> => ({
    album: song.album ?? undefined,
    artist: song.artistName,
    durationMs: song.duration ? song.duration * 1000 : undefined,
    id: song.id,
    imageUrl: song.imageUrl ?? undefined,
    mime: song._previewMime,
    streamUrl: song._previewStreamUrl,
    title: song.name,
});
