import isElectron from 'is-electron';
import { useEffect, useState } from 'react';
import { generatePath, useNavigate } from 'react-router';

import { api } from '/@/renderer/api';
import { AppRoute } from '/@/renderer/router/routes';
import {
    useCurrentServerId,
    useHubActiveDeviceVolume,
    useHubIsRemoteActive,
    useHubRemoteIsPlaying,
    useHubRemoteNowPlaying,
    useHubRemoteRepeat,
    useHubRemoteShuffle,
    useHubStore,
    usePlayerRepeat,
    usePlayerShuffle,
    usePlayerSong,
    usePlayerStatus,
    usePlayerVolume,
} from '/@/renderer/store';
import { usePlayerTimestamp } from '/@/renderer/store/timestamp.store';
import { QueueSong, Song } from '/@/shared/types/domain-types';
import { PlayerRepeat, PlayerShuffle, PlayerStatus } from '/@/shared/types/types';

const hub = isElectron() ? window.api.hub : null;

/**
 * Player hooks that transparently follow the REMOTE session when playback is on
 * another navi-connect device, so existing UI (lyrics, side queue) reflects
 * what's actually playing instead of the frozen local player.
 */

// Remote tracks arrive with only id + plain album/artist NAMES. To make the
// playerbar's album/artist links work we resolve the full Song once per id
// (cached; in-flight deduped across the components that call the hook).
const remoteDetailCache = new Map<string, Song>();
const remoteDetailInflight = new Map<string, Promise<null | Song>>();

const resolveRemoteDetail = (serverId: string, id: string): Promise<null | Song> => {
    const cached = remoteDetailCache.get(id);
    if (cached) return Promise.resolve(cached);
    let inflight = remoteDetailInflight.get(id);
    if (!inflight) {
        inflight = api.controller
            .getSongDetail({ apiClientProps: { serverId }, query: { id } })
            .then((song) => {
                if (song) remoteDetailCache.set(id, song as Song);
                return (song as Song) ?? null;
            })
            .catch(() => null)
            .finally(() => remoteDetailInflight.delete(id));
        remoteDetailInflight.set(id, inflight);
    }
    return inflight;
};

/** The current song — remote now-playing when remote-active, else local. */
export const useRemoteAwarePlayerSong = (): QueueSong | undefined => {
    const isRemote = useHubIsRemoteActive();
    const localSong = usePlayerSong();
    const remote = useHubRemoteNowPlaying();
    const serverId = useCurrentServerId();
    const [detail, setDetail] = useState<null | Song>(null);

    // Resolve the full song for the remote now-playing track (album id + artist
    // ids) so the playerbar links navigate correctly.
    const remoteId = isRemote ? remote?.id : undefined;
    useEffect(() => {
        if (!remoteId || !serverId) {
            setDetail(null);
            return undefined;
        }
        let cancelled = false;
        void resolveRemoteDetail(serverId, remoteId).then((song) => {
            if (!cancelled) setDetail(song);
        });
        return () => {
            cancelled = true;
        };
    }, [remoteId, serverId]);

    if (!isRemote || !remote) return localSong;

    const resolved = detail?.id === remote.id ? detail : (remoteDetailCache.get(remote.id) ?? null);

    // Synthesize enough of a QueueSong for the lyrics pipeline (id + serverId
    // drive the server lyrics fetch; name/artist/duration drive remote search)
    // plus favorite/rating so the playerbar's heart + stars reflect the remote
    // track, and (when resolved) albumId/artists so its links navigate.
    return {
        _serverId: serverId ?? '',
        album: remote.album ?? resolved?.album ?? '',
        albumArtists: resolved?.albumArtists,
        albumId: resolved?.albumId ?? undefined,
        artistName: remote.artist ?? '',
        artists:
            resolved?.artists && resolved.artists.length > 0
                ? resolved.artists
                : remote.artist
                  ? [{ id: '', name: remote.artist }]
                  : [],
        duration: remote.durationMs ?? 0,
        id: remote.id,
        // Build the cover from a Navidrome id with OUR own server creds rather
        // than trusting the publishing device's imageUrl (which may be a LAN /
        // tokened URL this client can't reach). The song id doubles as the
        // cover-art id across this system; the resolved detail's imageId is used
        // when available. imageUrl is left unset so ItemImage falls back to the id.
        imageId: resolved?.imageId ?? remote.id,
        imageUrl: undefined,
        name: remote.title ?? '',
        userFavorite: remote.favorite ?? false,
        userRating: remote.rating ?? null,
    } as unknown as QueueSong;
};

/** Shuffle state — remote session's when remote-active, else local. */
export const useRemoteAwareShuffle = (): PlayerShuffle => {
    const isRemote = useHubIsRemoteActive();
    const localShuffle = usePlayerShuffle();
    const remoteShuffle = useHubRemoteShuffle();

    if (!isRemote) return localShuffle;
    return remoteShuffle ? PlayerShuffle.TRACK : PlayerShuffle.NONE;
};

/** Repeat state — remote session's when remote-active, else local. */
export const useRemoteAwareRepeat = (): PlayerRepeat => {
    const isRemote = useHubIsRemoteActive();
    const localRepeat = usePlayerRepeat();
    const remoteRepeat = useHubRemoteRepeat();

    if (!isRemote) return localRepeat;
    return remoteRepeat === 'one'
        ? PlayerRepeat.ONE
        : remoteRepeat === 'all'
          ? PlayerRepeat.ALL
          : PlayerRepeat.NONE;
};

/** Volume (0-100) — the active remote device's when remote-active, else local. */
export const useRemoteAwareVolume = (): number => {
    const isRemote = useHubIsRemoteActive();
    const localVolume = usePlayerVolume();
    const remoteVolume = useHubActiveDeviceVolume();

    return isRemote ? remoteVolume : localVolume;
};

/** Playback position in SECONDS — interpolated remote position, or local. */
export const useRemoteAwareTimestamp = (): number => {
    const isRemote = useHubIsRemoteActive();
    const localTs = usePlayerTimestamp();
    const isPlaying = useHubRemoteIsPlaying();
    const [, force] = useState(0);

    // Tick locally between the hub's ~1 Hz progress frames while remote-playing.
    useEffect(() => {
        if (!isRemote || !isPlaying) return undefined;
        const timer = setInterval(() => force((n) => n + 1), 250);
        return () => clearInterval(timer);
    }, [isRemote, isPlaying]);

    if (!isRemote) return localTs;

    const s = useHubStore.getState();
    const elapsed = s.remoteIsPlaying ? Date.now() - s.remotePositionAt : 0;
    return Math.max(0, (s.remotePositionMs + elapsed) / 1000);
};

/** Playback status — remote play/pause when remote-active, else local. */
export const useRemoteAwareStatus = (): PlayerStatus => {
    const isRemote = useHubIsRemoteActive();
    const localStatus = usePlayerStatus();
    const remotePlaying = useHubRemoteIsPlaying();

    if (!isRemote) return localStatus;
    return remotePlaying ? PlayerStatus.PLAYING : PlayerStatus.PAUSED;
};

/**
 * Returns a seek function that routes to the remote device when remote-active.
 * Returns false (didn't handle it) otherwise, so callers fall back to local.
 */
export const useRemoteSeek = (): ((sec: number) => boolean) => {
    const isRemote = useHubIsRemoteActive();
    return (sec: number) => {
        if (!isRemote || !hub) return false;
        hub.send({ action: 'seek', positionMs: Math.round(sec * 1000), t: 'act' });
        return true;
    };
};

/**
 * Navigate to the album/artist of a remote track. Remote tracks only carry a
 * song id, so the album/artist ids are resolved on demand via getSongDetail.
 */
export const useRemoteSongNavigation = () => {
    const navigate = useNavigate();
    const serverId = useCurrentServerId();

    const resolve = async (songId: string): Promise<null | Song> => {
        if (!serverId) return null;
        try {
            return (await api.controller.getSongDetail({
                apiClientProps: { serverId },
                query: { id: songId },
            })) as Song;
        } catch {
            return null;
        }
    };

    return {
        goToAlbum: async (songId: string) => {
            const song = await resolve(songId);
            if (song?.albumId) {
                navigate(generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: song.albumId }));
            }
        },
        goToArtist: async (songId: string) => {
            const song = await resolve(songId);
            const artistId = song?.albumArtists?.[0]?.id ?? song?.artists?.[0]?.id;
            if (artistId) {
                navigate(
                    generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, {
                        albumArtistId: artistId,
                    }),
                );
            }
        },
        resolve,
    };
};
