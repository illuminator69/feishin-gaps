import type { PlayerContext } from '/@/renderer/features/player/context/player-context';
import type {
    StationAnswer,
    StationCatalog,
    StationCharacterId,
    StationNextBody,
    StationResult,
    StationSeed,
    StationSignalAnswer,
    StationSignalKind,
    StationStartBody,
    StationTrack,
} from '/@/shared/types/station-types';

import isElectron from 'is-electron';

import { api } from '/@/renderer/api';
import {
    bindingFromAnswer,
    keepResolved,
    SEED_TRACKS_MAX,
    spreadPick,
    START_COUNT,
    StationBinding,
} from '/@/renderer/features/player/station/station-logic';
import { getStationMode, useStationStore } from '/@/renderer/features/player/station/station-store';
import { beginQueueSession } from '/@/renderer/features/player/utils/saved-queue-source';
import { useHubStore } from '/@/renderer/store/hub.store';
import { useSettingsStore } from '/@/renderer/store/settings.store';
import { logger } from '/@/renderer/utils/logger';
import { Album, Song } from '/@/shared/types/domain-types';
import { Play } from '/@/shared/types/types';

/**
 * navi-connect stations (I-040): the renderer's half of the station client. The calls go
 * through the main process (`window.api.station`), which holds the hub's base and token.
 *
 * Every radio entry point asks `playStationRadio` first and runs its own upstream path when it
 * answers false: no hub, a hub without stations, an engine that answered 503, or a seed the
 * engine does not know. Nothing here falls back to random songs.
 */

const bridge = () => (isElectron() ? (window.api?.station ?? null) : null);

const noBridge = <T>(): StationResult<T> => ({
    data: null,
    error: 'Stations need the desktop app.',
    ok: false,
    status: 0,
});

const deviceId = (): string | undefined => useHubStore.getState().myDeviceId ?? undefined;

/** The probe. Null when nothing readable came back (no hub, an older hub, a timeout). */
export const probeStations = async (): Promise<null | StationCatalog> => {
    const station = bridge();
    if (!station) return null;
    const result = await station.characters();
    return result.ok ? result.data : null;
};

const noteFallback = <T>(result: StationResult<T>, route: string): StationResult<T> => {
    if (!result.ok && (result.status === 503 || result.fallback)) {
        logger.warn('Station engine unavailable, using Auto DJ', { route, status: result.status });
        useStationStore.getState().actions.latchFallback();
    }
    return result;
};

export const startStation = async (
    body: StationStartBody,
): Promise<StationResult<StationAnswer>> => {
    const station = bridge();
    if (!station) return noBridge();
    const result = await station.start({ deviceId: deviceId(), ...body });
    // Your mix answers 503 whenever AudioMuse is down (the fingerprint has no Tier 1 equivalent,
    // PROTOCOL §18.1), while a radio would still play through Navidrome. That says nothing about
    // the engine as a whole, so it does not switch autoplay over to Auto DJ.
    return body.seed.kind === 'yourMix' ? result : noteFallback(result, 'start');
};

export const nextStation = async (body: StationNextBody): Promise<StationResult<StationAnswer>> => {
    const station = bridge();
    if (!station) return noBridge();
    return noteFallback(await station.next({ deviceId: deviceId(), ...body }), 'next');
};

/** A signal for the bound station. Fire and forget: a signal that does not land only steers less. */
export const signalStation = async (
    kind: StationSignalKind,
    extra: { trackId?: string; value?: StationCharacterId } = {},
): Promise<null | StationSignalAnswer> => {
    const station = bridge();
    const bound = useStationStore.getState().bound;
    if (!station || !bound) return null;
    const result = await station.signal({ kind, stationId: bound.stationId, ...extra });
    if (!result.ok) {
        logger.warn('Station signal not applied', { kind, status: result.status });
        return null;
    }
    return result.data;
};

/**
 * Served tracks as Songs, in the order served. An id this server cannot resolve is DROPPED: a
 * placeholder would play with no duration and no metadata. The songs the queue already holds
 * are reused rather than asked for again.
 */
export const resolveStationSongs = async (
    tracks: StationTrack[],
    serverId: null | string,
    known?: Map<string, Song>,
): Promise<Song[]> => {
    if (!serverId || tracks.length === 0) return [];
    const resolved = await Promise.all(
        tracks.map((track) => {
            const already = known?.get(track.id);
            if (already) return Promise.resolve(already);
            return api.controller
                .getSongDetail({ apiClientProps: { serverId }, query: { id: track.id } })
                .catch(() => null);
        }),
    );
    const songs = keepResolved(resolved);
    if (songs.length < tracks.length) {
        logger.warn('Station tracks this server could not resolve were dropped', {
            dropped: tracks.length - songs.length,
            served: tracks.length,
        });
    }
    return songs;
};

/** Whether a radio entry point should try a station before its own path. */
export const stationsReady = (): boolean => getStationMode() === 'stations';

export const currentCharacter = (): StationCharacterId =>
    useSettingsStore.getState().station?.character ?? 'balanced';

export interface StationQueue {
    binding: StationBinding;
    songs: Song[];
}

/**
 * Start a station and build the queue it plays: the seed songs the caller already has, then the
 * station's first batch. Null means the caller runs its own path; the reason is logged.
 */
export const buildStationQueue = async (args: {
    character?: StationCharacterId;
    count?: number;
    leading: Song[];
    seed: StationSeed;
    serverId: string;
}): Promise<null | StationQueue> => {
    if (getStationMode() !== 'stations') return null;
    const result = await startStation({
        character: args.character ?? currentCharacter(),
        count: Math.max(1, Math.min(50, args.count ?? START_COUNT)),
        exclude: args.leading.map((song) => song.id),
        // Every entry point starts a radio: it keeps going whether or not Autoplay is on.
        origin: 'radio',
        seed: args.seed,
    });
    if (!result.ok || !result.data) {
        logger.info('Station radio not started, using the app radio', {
            code: result.code,
            status: result.status,
        });
        return null;
    }
    const answer = result.data;
    const songs = await resolveStationSongs(answer.tracks, args.serverId);
    if (args.leading.length + songs.length === 0) return null;
    return {
        binding: bindingFromAnswer(answer, { startedHere: true }),
        songs: [...args.leading, ...songs],
    };
};

/**
 * Play a station's queue: replace the queue, and when the replace really happens arm its binding
 * and announce the new session (which binds it). The `setQueue` this causes names the station,
 * through hub or locally.
 *
 * Both wait for the replace (`onApply`), not for this call: with "Discard the current queue?"
 * up, an announcement made here went stale after 4 s, so the confirmed replace began a second,
 * nameless session that unbound the radio; and a cancelled one left the queue still playing
 * bound to the radio it had declined.
 */
export const playStationQueue = (
    queue: StationQueue,
    sessionName: string,
    player: Pick<PlayerContext, 'addToQueueByData'>,
    skipConfirmation?: boolean,
): void => {
    player.addToQueueByData(queue.songs, Play.NOW, undefined, undefined, skipConfirmation, () => {
        useStationStore.getState().actions.arm(queue.binding);
        beginQueueSession('radio', sessionName);
    });
};

/** Track, album or artist radio, as a station. False: run the caller's own radio. */
export const playStationRadio = async (args: {
    character?: StationCharacterId;
    leading: Song[];
    player: Pick<PlayerContext, 'addToQueueByData'>;
    seed: StationSeed;
    serverId: string;
    sessionName: string;
    /** The remote web control already asked on the phone. */
    skipConfirmation?: boolean;
}): Promise<boolean> => {
    try {
        const queue = await buildStationQueue(args);
        if (!queue) return false;
        playStationQueue(queue, args.sessionName, args.player, args.skipConfirmation);
        return true;
    } catch (error) {
        logger.error('Station radio failed', { error: (error as Error).message });
        return false;
    }
};

/** A track radio's seed: the track itself, which plays first. */
export const trackRadioSeed = (song: Song): { leading: Song[]; seed: StationSeed } => ({
    leading: [song],
    seed: { ids: [song.id], kind: 'track', name: song.name },
});

/** An album radio's seed: up to five of its tracks, spread over the album, which play first. */
export const albumRadioSeed = async (
    serverId: string,
    album: Pick<Album, 'id' | 'name'> & { songs?: Song[] },
): Promise<null | { leading: Song[]; seed: StationSeed }> => {
    let songs = album.songs ?? [];
    if (songs.length === 0) {
        const detail = await api.controller
            .getAlbumDetail({ apiClientProps: { serverId }, query: { id: album.id } })
            .catch(() => null);
        songs = detail?.songs ?? [];
    }
    const leading = spreadPick(songs, SEED_TRACKS_MAX);
    if (leading.length === 0) return null;
    return {
        leading,
        seed: { ids: leading.map((song) => song.id), kind: 'tracks', name: album.name },
    };
};

/** An artist radio's seed: up to five of the artist's top songs, which play first. */
export const artistRadioSeed = async (
    serverId: string,
    artist: { id: string; name: string },
): Promise<null | { leading: Song[]; seed: StationSeed }> => {
    const top = await api.controller
        .getTopSongs({
            apiClientProps: { serverId },
            query: { artist: artist.name, artistId: artist.id, limit: SEED_TRACKS_MAX },
        })
        .catch(() => null);
    const leading = (top?.items ?? []).slice(0, SEED_TRACKS_MAX);
    if (leading.length === 0) return null;
    return {
        leading,
        seed: { ids: leading.map((song) => song.id), kind: 'tracks', name: artist.name },
    };
};

/** "Your mix": the seedless station, from the hub's Navidrome user's own most-played. */
export const playYourMix = async (args: {
    character?: StationCharacterId;
    player: Pick<PlayerContext, 'addToQueueByData'>;
    serverId: string;
    sessionName: string;
}): Promise<boolean> => playStationRadio({ ...args, leading: [], seed: { kind: 'yourMix' } });
