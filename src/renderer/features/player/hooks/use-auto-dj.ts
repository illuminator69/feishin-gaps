import { useQueryClient } from '@tanstack/react-query';
import React, { useEffect, useRef } from 'react';

import { api } from '/@/renderer/api';
import { eventEmitter } from '/@/renderer/events/event-emitter';
import { isRemoteSessionActive } from '/@/renderer/features/hub/utils/remote-queue';
import {
    fetchAlchemyIds,
    fetchFingerprintIds,
    moodCharacterParams,
} from '/@/renderer/features/player/auto-dj/audio-muse-source';
import { runAutoDjAlbumIds } from '/@/renderer/features/player/auto-dj/auto-dj-albums';
import { runAutoDjSongs } from '/@/renderer/features/player/auto-dj/auto-dj-songs';
import { getMoodFlowSignals } from '/@/renderer/features/player/auto-dj/mood-flow-signals';
import { useIsPlayerFetching, usePlayer } from '/@/renderer/features/player/context/player-context';
import {
    AUTO_DJ_STRATEGY,
    isShuffleEnabled,
    mapShuffledToQueueIndex,
    useAudioMuseSettings,
    useAutoDJSettings,
    useCurrentServer,
    useCurrentServerId,
    useHubStore,
    usePlayerStore,
    usePlayerStoreBase,
    useSettingsStore,
} from '/@/renderer/store';
import { LogCategory, logFn } from '/@/renderer/utils/logger';
import { logMsg } from '/@/renderer/utils/logger-message';
import { hasFeature } from '/@/shared/api/utils';
import { LibraryItem, QueueSong, Song } from '/@/shared/types/domain-types';
import { ServerFeature } from '/@/shared/types/features-types';
import { Play } from '/@/shared/types/types';

// Adaptive Mood Flow re-splice bounds: how many alchemy passes a single top-up may make, and how
// much each successive pass widens exploration (temperature multiplier grows by this per pass).
const MOOD_FLOW_MAX_PASSES = 3;
const MOOD_FLOW_DRIFT_STEP = 0.5;

export const useAutoDJ = () => {
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();
    const server = useCurrentServer();
    const player = usePlayer();
    const settings = useAutoDJSettings();
    const audioMuse = useAudioMuseSettings();
    const isFetching = useIsPlayerFetching();
    const remoteRunningRef = useRef(false);

    const hasSimilarSongsMusicFolder = hasFeature(server, ServerFeature.SIMILAR_SONGS_MUSIC_FOLDER);

    useEffect(() => {
        const albumStrategy = settings.albumStrategy ?? AUTO_DJ_STRATEGY.SIMILAR;
        const songStrategy = settings.songStrategy ?? AUTO_DJ_STRATEGY.SIMILAR;
        const source = settings.autoplaySource ?? 'autoDj';

        // Tier-2 top-up via the AudioMuse core API (Sonic Fingerprint / Mood Flow).
        // Both resolve to song ids fetched + appended; fail-soft (empty = no-op).
        const resolveSongsByIds = async (ids: string[]): Promise<Song[]> => {
            if (!serverId || ids.length === 0) return [];

            const songs = await Promise.all(
                ids.map((id) =>
                    api.controller
                        .getSongDetail({ apiClientProps: { serverId }, query: { id } })
                        .catch(() => null),
                ),
            );

            return songs.filter((song): song is Song => Boolean(song));
        };

        // Adaptive Mood Flow: pull the queue toward play-throughs (ADD) and away from skips
        // (SUBTRACT). One alchemy pass off a tight centroid can return mostly tracks already
        // queued, which would starve the top-up and silently fall back to Tier 1. So re-splice:
        // widen exploration (escalating temperature) over a few bounded passes until enough FRESH
        // ids are harvested. Fail-soft (any pass returning [] just contributes nothing).
        const fetchMoodFlowIds = async (
            seedId: string,
            existingIds: Set<string>,
        ): Promise<string[]> => {
            const { addIds, subtractIds } = getMoodFlowSignals();
            // Cold start (no signals yet) seeds with the current song — also the case for remote
            // playback, which produces no local progress to classify.
            const seededAddIds = addIds.length > 0 ? addIds : [seedId];
            const base = moodCharacterParams(settings.moodCharacter ?? 'steady');

            const harvested = new Set<string>();
            for (let pass = 0; pass < MOOD_FLOW_MAX_PASSES; pass += 1) {
                const temperature = (base.temperature ?? 1.0) * (1 + pass * MOOD_FLOW_DRIFT_STEP);
                const ids = await fetchAlchemyIds(
                    audioMuse,
                    seededAddIds,
                    subtractIds,
                    settings.itemCount,
                    { ...base, temperature },
                );
                for (const id of ids) {
                    if (!existingIds.has(id)) harvested.add(id);
                }
                // Stop the moment we have a full top-up; a first tight pass usually suffices.
                if (harvested.size >= settings.itemCount) break;
            }
            return [...harvested];
        };

        const appendAudioMuse = async (
            seedId: string,
            existingIds: Set<string>,
        ): Promise<boolean> => {
            if (!serverId) return false;
            let ids: string[];
            if (source === 'fingerprint') {
                ids = await fetchFingerprintIds(audioMuse, server, settings.itemCount);
            } else {
                ids = await fetchMoodFlowIds(seedId, existingIds);
            }

            const newIds = ids.filter((id) => !existingIds.has(id));
            if (newIds.length > 0) {
                const songs = await resolveSongsByIds(newIds);
                if (songs.length > 0) {
                    player.addToQueueByData(songs, Play.LAST);
                    eventEmitter.emit('AUTODJ_QUEUE_ADDED', { songCount: songs.length });
                    return true;
                }
            }

            return false;
        };

        const unsubscribe = usePlayerStoreBase.subscribe(
            (state) => {
                const queue = state.getQueue();
                let index = state.player.index;
                let remaining: number;

                if (isShuffleEnabled(state)) {
                    remaining = state.queue.shuffled.length - index - 1;
                    index = mapShuffledToQueueIndex(index, state.queue.shuffled);
                } else {
                    remaining = queue.items.slice(index + 1).length;
                }

                return { index, remaining, song: queue.items[index] };
            },
            async (properties) => {
                // While another navi-connect device is the active receiver, the
                // local player store is frozen — Auto DJ is driven off the hub
                // session by the separate subscription below instead.
                if (isRemoteSessionActive()) {
                    return;
                }

                if (!settings.enabled) {
                    return;
                }

                if (!properties.song?.id) {
                    return;
                }

                if (properties.remaining >= settings.timing) {
                    return;
                }

                logFn.debug(logMsg[LogCategory.PLAYER].autoPlayTriggered, {
                    category: LogCategory.PLAYER,
                    meta: { remaining: properties.remaining, songId: properties.song?.id },
                });

                try {
                    const queue = usePlayerStore.getState().getQueue();

                    if (source !== 'autoDj') {
                        const appended = await appendAudioMuse(
                            properties.song.id,
                            new Set(queue.items.map((item) => item.id)),
                        );
                        if (appended) {
                            return;
                        }
                    }

                    const hasMusicFolder = server?.musicFolderId && server.musicFolderId.length > 0;
                    const musicFolderId =
                        hasMusicFolder && server?.musicFolderId ? server.musicFolderId : undefined;
                    const trySimilarSongs =
                        !hasMusicFolder || (hasMusicFolder && hasSimilarSongsMusicFolder);

                    const runnerDepsBase = {
                        itemCount: settings.itemCount,
                        musicFolderId,
                        queryClient,
                        server,
                        serverId,
                        trySimilarSongs,
                    };

                    if (settings.mode === 'albums') {
                        if (!serverId) {
                            return;
                        }

                        const queueAlbumIdSet = new Set(
                            queue.items
                                .map((item) => item.albumId)
                                .filter((id): id is string => Boolean(id)),
                        );

                        const albumsToAdd = await runAutoDjAlbumIds({
                            ...runnerDepsBase,
                            albumStrategy,
                            currentSong: properties.song,
                            queueAlbumIdSet,
                        });

                        if (albumsToAdd.length > 0) {
                            await player.addToQueueByFetch(
                                serverId,
                                albumsToAdd,
                                LibraryItem.ALBUM,
                                Play.LAST,
                            );

                            eventEmitter.emit('AUTODJ_QUEUE_ADDED', {
                                songCount: albumsToAdd.length,
                            });
                        }

                        return;
                    }

                    if (!serverId) {
                        return;
                    }

                    const queueSongIdSet = new Set(queue.items.map((item) => item.id));

                    const songsToAdd = await runAutoDjSongs({
                        ...runnerDepsBase,
                        currentSong: properties.song,
                        queueSongIdSet,
                        songStrategy,
                    });

                    if (songsToAdd.length > 0) {
                        player.addToQueueByData(songsToAdd, Play.LAST);

                        eventEmitter.emit('AUTODJ_QUEUE_ADDED', {
                            songCount: songsToAdd.length,
                        });
                    }
                } catch (error) {
                    logFn.error(logMsg[LogCategory.PLAYER].autoPlayFailed, {
                        category: LogCategory.PLAYER,
                        meta: { error: (error as Error).message, songId: properties.song?.id },
                    });
                }
            },
            {
                equalityFn: (a, b) => {
                    return a.song?._uniqueId === b.song?._uniqueId && a.remaining === b.remaining;
                },
            },
        );

        // navi-connect: drive Auto DJ off the HUB session when another device is
        // the active receiver (the local player store doesn't advance then). The
        // adds route to the remote session via the intercepted player context.
        const runRemoteAutoDj = async (nowId: string) => {
            if (remoteRunningRef.current || !serverId) {
                return;
            }
            remoteRunningRef.current = true;

            try {
                // The hub track only carries an id — resolve the full song so the
                // runner has genres/albumArtists/albumId for its fallbacks.
                const seed = await api.controller
                    .getSongDetail({ apiClientProps: { serverId }, query: { id: nowId } })
                    .catch(() => null);
                if (!seed) {
                    return;
                }

                const remoteQueue = useHubStore.getState().remoteQueue;

                if (source !== 'autoDj') {
                    const appended = await appendAudioMuse(
                        nowId,
                        new Set(remoteQueue.map((track) => track.id)),
                    );
                    if (appended) {
                        return;
                    }
                }

                const hasMusicFolder = server?.musicFolderId && server.musicFolderId.length > 0;
                const musicFolderId =
                    hasMusicFolder && server?.musicFolderId ? server.musicFolderId : undefined;
                const trySimilarSongs =
                    !hasMusicFolder || (hasMusicFolder && hasSimilarSongsMusicFolder);

                const runnerDepsBase = {
                    itemCount: settings.itemCount,
                    musicFolderId,
                    queryClient,
                    server,
                    serverId,
                    trySimilarSongs,
                };

                if (settings.mode === 'albums') {
                    const albumsToAdd = await runAutoDjAlbumIds({
                        ...runnerDepsBase,
                        albumStrategy,
                        currentSong: seed as unknown as QueueSong,
                        // The hub queue carries album NAMES, not ids — best-effort
                        // (album dedupe relies on ids), so pass an empty set.
                        queueAlbumIdSet: new Set<string>(),
                    });

                    if (albumsToAdd.length > 0) {
                        await player.addToQueueByFetch(
                            serverId,
                            albumsToAdd,
                            LibraryItem.ALBUM,
                            Play.LAST,
                        );
                        eventEmitter.emit('AUTODJ_QUEUE_ADDED', { songCount: albumsToAdd.length });
                    }
                    return;
                }

                const queueSongIdSet = new Set(remoteQueue.map((track) => track.id));
                const songsToAdd = await runAutoDjSongs({
                    ...runnerDepsBase,
                    currentSong: seed as unknown as QueueSong,
                    queueSongIdSet,
                    songStrategy,
                });

                if (songsToAdd.length > 0) {
                    player.addToQueueByData(songsToAdd, Play.LAST);
                    eventEmitter.emit('AUTODJ_QUEUE_ADDED', { songCount: songsToAdd.length });
                }
            } catch (error) {
                logFn.error(logMsg[LogCategory.PLAYER].autoPlayFailed, {
                    category: LogCategory.PLAYER,
                    meta: { error: (error as Error).message, songId: nowId },
                });
            } finally {
                remoteRunningRef.current = false;
            }
        };

        // useHubStore has no subscribeWithSelector middleware, so dedupe by hand:
        // only act when the remote now-playing track or remaining count changes.
        let lastRemoteSig = '';
        const unsubscribeRemote = useHubStore.subscribe((state) => {
            const isRemote =
                state.connected &&
                state.activeDeviceId !== null &&
                state.myDeviceId !== null &&
                state.activeDeviceId !== state.myDeviceId;
            if (!isRemote) {
                lastRemoteSig = '';
                return;
            }

            const remaining = state.remoteQueue.length - state.remoteQueueIndex - 1;
            const nowId = state.remoteQueue[state.remoteQueueIndex]?.id;
            if (!nowId) {
                return;
            }

            const sig = `${nowId}:${remaining}`;
            if (sig === lastRemoteSig) {
                return;
            }
            lastRemoteSig = sig;

            if (!settings.enabled || remaining >= settings.timing) {
                return;
            }

            void runRemoteAutoDj(nowId);
        });

        return () => {
            unsubscribe();
            unsubscribeRemote();
        };
    }, [
        audioMuse,
        hasSimilarSongsMusicFolder,
        isFetching,
        player,
        queryClient,
        server,
        serverId,
        settings.autoplaySource,
        settings.enabled,
        settings.albumStrategy,
        settings.itemCount,
        settings.mode,
        settings.moodCharacter,
        settings.songStrategy,
        settings.timing,
    ]);
};

const AutoDJHookInner = () => {
    useAutoDJ();
    return null;
};

export const AutoDJHook = () => {
    const isAutoDJEnabled = useSettingsStore((state) => state.autoDJ.enabled);

    if (!isAutoDJEnabled) {
        return null;
    }

    return React.createElement(AutoDJHookInner);
};
