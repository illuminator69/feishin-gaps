import isElectron from 'is-electron';
import { debounce } from 'lodash';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import { getItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { getRemoteAwareSnapshot } from '/@/renderer/features/hub/hooks/use-remote-aware';
import { usePlayerEvents } from '/@/renderer/features/player/audio-player/hooks/use-player-events';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import {
    useIsRadioActive,
    useRadioPlayer,
} from '/@/renderer/features/radio/hooks/use-radio-player';
import {
    subscribeCurrentTrack,
    subscribePlayerStatus,
    useHubStore,
    usePlaybackSettings,
    usePlayerStore,
    useSettingsStore,
    useSkipButtons,
    useTimestampStoreBase,
} from '/@/renderer/store';
import { LibraryItem, QueueSong } from '/@/shared/types/domain-types';
import { PlayerStatus, PlayerType } from '/@/shared/types/types';

const mediaSession = navigator.mediaSession;

export const useMediaSession = () => {
    const { mediaSession: mediaSessionEnabled } = usePlaybackSettings();
    const player = usePlayer();
    const skip = useSkipButtons();
    const playbackType = useSettingsStore((state) => state.playback.type);
    const isRadioActive = useIsRadioActive();
    const { isPlaying: isRadioPlaying, metadata: radioMetadata, stationName } = useRadioPlayer();

    // Keep refs to current values to avoid dependency changes triggering handler re-registration
    const playerRef = useRef(player);
    const skipRef = useRef(skip);
    const isRadioActiveRef = useRef(isRadioActive);
    const isRadioPlayingRef = useRef(isRadioPlaying);
    const radioMetadataRef = useRef(radioMetadata);
    const stationNameRef = useRef(stationName);
    const isMediaSessionEnabledRef = useRef(false);

    // Update refs whenever values change, but don't trigger effects
    useEffect(() => {
        playerRef.current = player;
    }, [player]);

    useEffect(() => {
        skipRef.current = skip;
    }, [skip]);

    useEffect(() => {
        isRadioActiveRef.current = isRadioActive;
    }, [isRadioActive]);

    useEffect(() => {
        isRadioPlayingRef.current = isRadioPlaying;
    }, [isRadioPlaying]);

    useEffect(() => {
        radioMetadataRef.current = radioMetadata;
    }, [radioMetadata]);

    useEffect(() => {
        stationNameRef.current = stationName;
    }, [stationName]);

    const isMediaSessionEnabled = useMemo(() => {
        // Always enable media session on web
        if (!isElectron()) {
            return true;
        }

        return Boolean(mediaSessionEnabled && playbackType === PlayerType.WEB);
    }, [mediaSessionEnabled, playbackType]);

    useEffect(() => {
        isMediaSessionEnabledRef.current = isMediaSessionEnabled;
    }, [isMediaSessionEnabled]);

    // Register/unregister handlers whenever isMediaSessionEnabled changes so that
    // enabling the setting after mount correctly registers handlers instead of
    // silently no-oping because the [] effect already ran.
    useEffect(() => {
        if (!isMediaSessionEnabled) {
            mediaSession.setActionHandler('nexttrack', null);
            mediaSession.setActionHandler('pause', null);
            mediaSession.setActionHandler('play', null);
            mediaSession.setActionHandler('previoustrack', null);
            mediaSession.setActionHandler('seekto', null);
            mediaSession.setActionHandler('stop', null);
            mediaSession.setActionHandler('seekbackward', null);
            mediaSession.setActionHandler('seekforward', null);

            return;
        }

        mediaSession.setActionHandler('nexttrack', () => {
            if (isRadioActiveRef.current && isRadioPlayingRef.current) {
                return;
            }

            playerRef.current.mediaNext(false);
        });

        mediaSession.setActionHandler('pause', () => {
            playerRef.current.mediaPause();
        });

        mediaSession.setActionHandler('play', () => {
            playerRef.current.mediaPlay();
        });

        mediaSession.setActionHandler('previoustrack', () => {
            if (isRadioActiveRef.current && isRadioPlayingRef.current) {
                return;
            }

            playerRef.current.mediaPrevious(false);
        });

        mediaSession.setActionHandler('seekto', (e) => {
            if (isRadioActiveRef.current && isRadioPlayingRef.current) {
                return;
            }

            if (e.seekTime) {
                playerRef.current.mediaSeekToTimestamp(e.seekTime);
            } else if (e.seekOffset) {
                const currentTimestamp = useTimestampStoreBase.getState().timestamp;
                playerRef.current.mediaSeekToTimestamp(currentTimestamp + e.seekOffset);
            }
        });

        mediaSession.setActionHandler('stop', () => {
            playerRef.current.mediaStop();
        });

        mediaSession.setActionHandler('seekbackward', (e) => {
            if (isRadioActiveRef.current && isRadioPlayingRef.current) {
                return;
            }

            const currentTimestamp = useTimestampStoreBase.getState().timestamp;
            playerRef.current.mediaSeekToTimestamp(
                currentTimestamp - (e.seekOffset || skipRef.current?.skipBackwardSeconds || 5),
            );
        });

        mediaSession.setActionHandler('seekforward', (e) => {
            if (isRadioActiveRef.current && isRadioPlayingRef.current) {
                return;
            }

            const currentTimestamp = useTimestampStoreBase.getState().timestamp;
            playerRef.current.mediaSeekToTimestamp(
                currentTimestamp + (e.seekOffset || skipRef.current?.skipForwardSeconds || 5),
            );
        });

        return () => {
            mediaSession.setActionHandler('nexttrack', null);
            mediaSession.setActionHandler('pause', null);
            mediaSession.setActionHandler('play', null);
            mediaSession.setActionHandler('previoustrack', null);
            mediaSession.setActionHandler('seekto', null);
            mediaSession.setActionHandler('stop', null);
            mediaSession.setActionHandler('seekbackward', null);
            mediaSession.setActionHandler('seekforward', null);
        };
    }, [isMediaSessionEnabled]);

    const updateMediaSessionMetadata = useCallback(
        (song: QueueSong | undefined) => {
            // No isMediaSessionEnabled gate here: that setting governs whether we register
            // ACTION HANDLERS (which is what conflicts with Electron's global media keys —
            // hence the two being mutually exclusive in settings). Metadata and playbackState
            // are display-only and steal nothing, and they're the only way the OS now-playing
            // overlay can show the track a remote device is playing. Callers that must respect
            // the setting check it themselves.

            // Handle radio metadata when radio is active and playing
            if (isRadioActiveRef.current && isRadioPlayingRef.current) {
                const title = radioMetadataRef.current?.title || stationNameRef.current || 'Radio';
                const artist = radioMetadataRef.current?.artist || stationNameRef.current || '';

                mediaSession.metadata = new MediaMetadata({
                    album: stationNameRef.current || '',
                    artist: artist,
                    artwork: [],
                    title: title,
                });
                return;
            }

            // Handle regular song metadata
            if (!song) {
                return;
            }

            const imageUrl = getItemImageUrl({
                id: song?.imageId || undefined,
                imageUrl: song?.imageUrl,
                itemType: LibraryItem.SONG,
                type: 'itemCard',
            });

            mediaSession.metadata = new MediaMetadata({
                album: song?.album ?? '',
                artist: song?.artistName ?? '',
                artwork: imageUrl ? [{ src: imageUrl, type: 'image/png' }] : [],
                title: song?.name ?? '',
            });
        },
        // All values are read from refs — stable callback, no stale closure risk
        [],
    );

    // Debounced version to handle rapid skipping — only the last skip in a burst commits
    // to the media session. Without this, rapid MediaMetadata assignments can tear the
    // browser's media session state and permanently drop the handlers.
    const debouncedUpdateMetadata = useRef(
        debounce((song: QueueSong | undefined) => {
            updateMediaSessionMetadata(song);
        }, 100),
    ).current;

    // Cancel any pending debounced update on unmount
    useEffect(() => {
        return () => {
            debouncedUpdateMetadata.cancel();
        };
    }, [debouncedUpdateMetadata]);

    // Update metadata when radio metadata changes
    useEffect(() => {
        if (!isMediaSessionEnabled) {
            return;
        }

        if (isRadioActiveRef.current && isRadioPlayingRef.current) {
            debouncedUpdateMetadata(undefined);
        }
    }, [radioMetadata, isRadioPlaying, isMediaSessionEnabled, debouncedUpdateMetadata]);

    // Subscribe directly to the player store instead of using usePlayerEvents.
    // usePlayerEvents receives inline handler objects that cause it to re-subscribe on every
    // render, which destroys and recreates the media session on play/pause and track changes.
    // subscribeCurrentTrack and subscribePlayerStatus are stable Zustand subscriptions with
    // proper equality checks — registered once on mount and never torn down mid-session.
    useEffect(() => {
        // navi-connect: the OS must be told about the SESSION, not this client's local
        // engine. While playback is on another device the local player sits paused on the
        // pre-transfer track — reporting that made Windows show a stale thumbnail and,
        // worse, believe we were paused, so the media hotkey sent `play` and unpaused the
        // remote session instead of pausing it.
        // The hub store also carries the ~1 Hz progress mirror, so publish only on an
        // actual change — reassigning MediaMetadata every second can tear the browser's
        // media session and permanently drop the action handlers.
        let lastSongId: string | undefined;
        let lastState: MediaSessionPlaybackState | undefined;

        const publish = () => {
            const { song, status } = getRemoteAwareSnapshot();
            const state = status === PlayerStatus.PLAYING ? 'playing' : 'paused';
            if (state !== lastState) {
                lastState = state;
                mediaSession.playbackState = state;
            }
            if (isRadioActiveRef.current && isRadioPlayingRef.current) return;
            if (song?.id === lastSongId) return;
            lastSongId = song?.id;
            debouncedUpdateMetadata(song);
        };

        const unsubscribeCurrentSong = subscribeCurrentTrack(() => publish());
        const unsubscribeStatus = subscribePlayerStatus(() => publish());
        // The remote session changes without any local player event at all.
        const unsubscribeHub = useHubStore.subscribe(publish);
        publish();

        return () => {
            unsubscribeCurrentSong();
            unsubscribeStatus();
            unsubscribeHub();
        };
    }, [debouncedUpdateMetadata]);

    // onPlayerRepeated fires via eventEmitter (not Zustand), so usePlayerEvents is safe here —
    // the event emitter uses stable function references for on/off and does not re-subscribe
    // on render. The inline object is fine because deps is [] and the effect only runs once.
    usePlayerEvents(
        {
            onPlayerRepeated: () => {
                if (!isMediaSessionEnabledRef.current) {
                    return;
                }

                if (isRadioActiveRef.current && isRadioPlayingRef.current) {
                    return;
                }

                const currentSong = usePlayerStore.getState().getCurrentSong();
                debouncedUpdateMetadata(currentSong);
            },
        },
        [],
    );
};

const MediaSessionHookInner = () => {
    useMediaSession();
    return null;
};

export const MediaSessionHook = () => {
    // Always render the hook — let the internal guard logic decide whether to act.
    // Conditional rendering here causes unmount/remount cycles that destroy handlers mid-session.
    return React.createElement(MediaSessionHookInner);
};
