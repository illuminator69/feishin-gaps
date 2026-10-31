import type { RefObject } from 'react';
import type ReactPlayer from 'react-player';

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';

import {
    afterFailedTrack,
    retryDecision,
} from '/@/renderer/features/player/audio-player/engine/retry-decision';
import { AudioPlayer, PlayerOnProgressProps } from '/@/renderer/features/player/audio-player/types';
import { convertToLogVolume } from '/@/renderer/features/player/audio-player/utils/player-utils';
import { logger } from '/@/renderer/utils/logger';
import { PlayerStatus } from '/@/shared/types/types';

export interface WebPlayerEngineHandle extends AudioPlayer {
    player1(): {
        ref: null | ReactPlayer;
        setVolume: (volume: number) => void;
    };
    player2(): {
        ref: null | ReactPlayer;
        setVolume: (volume: number) => void;
    };
}

interface WebPlayerEngineProps {
    isMuted: boolean;
    isTransitioning: boolean;
    loopPlayer1: boolean;
    loopPlayer2: boolean;
    onEndedPlayer1: () => void;
    onEndedPlayer2: () => void;
    onErrorPause: () => void;
    onProgressPlayer1: (e: PlayerOnProgressProps) => void;
    onProgressPlayer2: (e: PlayerOnProgressProps) => void;
    onStartedPlayer1: (player: ReactPlayer) => void;
    onStartedPlayer2: (player: ReactPlayer) => void;
    playerNum: number;
    playerRef: RefObject<null | WebPlayerEngineHandle>;
    playerStatus: PlayerStatus;
    preservesPitch: boolean;
    speed?: number;
    src1: string | undefined;
    src2: string | undefined;
    volume: number;
    /** B-138: the queue's next automatic track is the current one (repeat-one, or a one-track repeat-all). */
    wouldReplaySameTrack?: () => boolean;
}

const NETWORK_RETRY_DELAY_MS = 2000;

// Store volume is 0-100; clamp the normalized result so HTMLMediaElement.volume
// never receives a value outside [0, 1] (throws IndexSizeError in some engines)
const normalizeVolume = (volume: number) => {
    return Math.min(1, Math.max(0, volume / 100 || 0));
};

// Credits: https://gist.github.com/novwhisky/8a1a0168b94f3b6abfaa?permalink_comment_id=1551393#gistcomment-1551393
// This is used so that the player will always have an <audio> element. This means that
// player1Source and player2Source are connected BEFORE the user presses play for
// the first time. This workaround is important for Safari, which seems to require the
// source to be connected PRIOR to resuming audio context
const EMPTY_SOURCE =
    'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU2LjM2LjEwMAAAAAAAAAAAAAAA//OEAAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAEAAABIADAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV6urq6urq6urq6urq6urq6urq6urq6urq6v////////////////////////////////8AAAAATGF2YzU2LjQxAAAAAAAAAAAAAAAAJAAAAAAAAAAAASDs90hvAAAAAAAAAAAAAAAAAAAA//MUZAAAAAGkAAAAAAAAA0gAAAAATEFN//MUZAMAAAGkAAAAAAAAA0gAAAAARTMu//MUZAYAAAGkAAAAAAAAA0gAAAAAOTku//MUZAkAAAGkAAAAAAAAA0gAAAAANVVV';

export const WebPlayerEngine = (props: WebPlayerEngineProps) => {
    const {
        isMuted,
        isTransitioning,
        loopPlayer1,
        loopPlayer2,
        onEndedPlayer1,
        onEndedPlayer2,
        onErrorPause,
        onProgressPlayer1,
        onProgressPlayer2,
        onStartedPlayer1,
        onStartedPlayer2,
        playerNum,
        playerRef,
        playerStatus,
        preservesPitch,
        speed,
        src1,
        src2,
        volume,
        wouldReplaySameTrack,
    } = props;

    const player1Ref = useRef<null | ReactPlayer>(null);
    const player2Ref = useRef<null | ReactPlayer>(null);
    const networkRetryCount1 = useRef(0);
    const networkRetryCount2 = useRef(0);
    const failedInARow = useRef(0);
    const failedWhileNext = useRef<Partial<Record<1 | 2, { code?: number; src: string }>>>({});
    const [ReactPlayerComponent, setReactPlayerComponent] = useState<any>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;

        const loadReactPlayer = async () => {
            try {
                const module = await import('react-player');
                if (isMounted) {
                    setReactPlayerComponent(() => module.default);
                    setIsLoading(false);
                }
            } catch (error) {
                console.error('Failed to load react-player:', error);
                setIsLoading(false);
            }
        };

        loadReactPlayer();

        return () => {
            isMounted = false;
        };
    }, []);

    const [internalVolume1, setInternalVolume1] = useState(() => normalizeVolume(volume));
    const [internalVolume2, setInternalVolume2] = useState(() => normalizeVolume(volume));

    useImperativeHandle<WebPlayerEngineHandle, WebPlayerEngineHandle>(playerRef, () => ({
        decreaseVolume(by: number) {
            setInternalVolume1(Math.max(0, internalVolume1 - by / 100));
            setInternalVolume2(Math.max(0, internalVolume2 - by / 100));
        },
        increaseVolume(by: number) {
            setInternalVolume1(Math.min(1, internalVolume1 + by / 100));
            setInternalVolume2(Math.min(1, internalVolume2 + by / 100));
        },
        pause() {
            player1Ref.current?.getInternalPlayer()?.pause();
            player2Ref.current?.getInternalPlayer()?.pause();
        },
        play() {
            player1Ref.current?.getInternalPlayer()?.pause();
            player2Ref.current?.getInternalPlayer()?.pause();
            if (playerNum === 1) {
                player1Ref.current?.getInternalPlayer()?.play();
            } else {
                player2Ref.current?.getInternalPlayer()?.play();
            }
        },
        player1() {
            return {
                ref: player1Ref?.current,
                setVolume: (volume: number) => setInternalVolume1(normalizeVolume(volume)),
            };
        },
        player2() {
            return {
                ref: player2Ref?.current,
                setVolume: (volume: number) => setInternalVolume2(normalizeVolume(volume)),
            };
        },
        seekTo(seekTo: number) {
            let type: 'fraction' | 'seconds' | undefined = undefined;

            if (seekTo < 1) {
                type = 'seconds';
            }

            playerNum === 1
                ? player1Ref.current?.seekTo(seekTo, type)
                : player2Ref.current?.seekTo(seekTo, type);
        },
        setVolume(volume: number) {
            setInternalVolume1(normalizeVolume(volume));
            setInternalVolume2(normalizeVolume(volume));
        },
        setVolume1(volume: number) {
            setInternalVolume1(normalizeVolume(volume));
        },
        setVolume2(volume: number) {
            setInternalVolume2(normalizeVolume(volume));
        },
    }));

    const volume1 = convertToLogVolume(internalVolume1);
    const volume2 = convertToLogVolume(internalVolume2);

    const pauseBothPlayers = useCallback(() => {
        player1Ref.current?.getInternalPlayer()?.pause();
        player2Ref.current?.getInternalPlayer()?.pause();
    }, []);

    const mediaErrorLabel = (code: number | undefined) => {
        switch (code) {
            case MediaError.MEDIA_ERR_ABORTED:
                return 'ABORTED';
            case MediaError.MEDIA_ERR_DECODE:
                return 'DECODE';
            case MediaError.MEDIA_ERR_NETWORK:
                return 'NETWORK';
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                return 'SRC_NOT_SUPPORTED';
            default:
                return 'unknown';
        }
    };

    // What a media error does to the playing element (B-138): see retry-decision.ts.
    const actOnError = (
        audio: HTMLAudioElement,
        code: number | undefined,
        onEnded: () => void,
        networkRetryCountRef: React.RefObject<number>,
    ) => {
        const label = mediaErrorLabel(code);
        const position = audio.currentTime;
        const decision = retryDecision(code, networkRetryCountRef.current, position);

        if (decision.action === 'ignore') {
            return;
        }

        if (decision.action === 'retry') {
            networkRetryCountRef.current += 1;
            logger.warn('Playback error, retrying', {
                code,
                label,
                resumeAt: decision.resumeAt,
                retryCount: networkRetryCountRef.current,
            });
            const failedSrc = audio.src;
            setTimeout(() => {
                // The track changed during the wait: this retry is not for what is loaded now.
                if (audio.src !== failedSrc) return;
                pauseBothPlayers();
                if (decision.resumeAt > 0) {
                    audio.addEventListener(
                        'loadedmetadata',
                        () => {
                            // A listener left by a retry that failed again must not seek
                            // the next track loaded into this element.
                            if (
                                audio.src === failedSrc &&
                                Number.isFinite(audio.duration) &&
                                decision.resumeAt < audio.duration
                            ) {
                                audio.currentTime = decision.resumeAt;
                            }
                        },
                        { once: true },
                    );
                }
                audio.load();
                audio.play().catch(() => {
                    logger.error('Playback error, retries exhausted', {
                        code,
                        label,
                        retryCount: networkRetryCountRef.current,
                    });
                });
            }, NETWORK_RETRY_DELAY_MS);
            return;
        }

        pauseBothPlayers();

        if (decision.action === 'skip') {
            failedInARow.current += 1;
            const replaysSame = wouldReplaySameTrack?.() ?? false;
            const next = afterFailedTrack(failedInARow.current, replaysSame);
            if (next === 'skip') {
                logger.error('Playback error, skipping track', {
                    code,
                    failedInARow: failedInARow.current,
                    label,
                    position,
                });
                onEnded();
                return;
            }
            logger.error('Playback error, pausing instead of skipping', {
                code,
                failedInARow: failedInARow.current,
                label,
                position,
                replaysSameTrack: replaysSame,
            });
        } else {
            logger.error('Playback error, pausing', {
                code,
                label,
                retryCount: networkRetryCountRef.current,
            });
        }

        if (onErrorPause) {
            onErrorPause();
        }
    };

    const handleOnError = (
        which: 1 | 2,
        playerRef: React.RefObject<null | ReactPlayer>,
        onEnded: () => void,
        networkRetryCountRef: React.RefObject<number>,
    ) => {
        return ({ target }: ErrorEvent) => {
            const { current: player } = playerRef;

            if (!player || !(target instanceof Audio) || target.src === EMPTY_SOURCE) {
                return;
            }

            const code = target.error?.code;

            // The other element failed while loading the NEXT track. Acting now would stop or
            // skip the song that is playing, so the failure waits for that track's turn.
            if (which !== playerNum) {
                failedWhileNext.current[which] = { code, src: target.src };
                logger.warn('Next track failed to load, handled at its turn', {
                    code,
                    label: mediaErrorLabel(code),
                });
                return;
            }

            actOnError(target, code, onEnded, networkRetryCountRef);
        };
    };

    // The next track's element failed while it was loading (above): now that it is the playing
    // one, act on that failure, unless the element has since been given another track. Runs
    // after every render; a failure is only recorded for the element that is not playing, so
    // it is found here on the first render after that element's turn starts.
    useEffect(() => {
        const which = playerNum === 2 ? 2 : 1;
        const failure = failedWhileNext.current[which];
        if (!failure) return;
        failedWhileNext.current[which] = undefined;
        const audio = (which === 1 ? player1Ref : player2Ref).current?.getInternalPlayer();
        if (!(audio instanceof HTMLAudioElement) || audio.src !== failure.src) return;
        actOnError(
            audio,
            failure.code,
            which === 1 ? onEndedPlayer1 : onEndedPlayer2,
            which === 1 ? networkRetryCount1 : networkRetryCount2,
        );
    });

    // A track heard playing ends a run of failed tracks.
    const handleOnPlaying = useCallback(() => {
        failedInARow.current = 0;
    }, []);

    useEffect(() => {
        networkRetryCount1.current = 0;
        networkRetryCount2.current = 0;
    }, [src1, src2]);

    // When not playing, always pause both players — even during a transition
    useEffect(() => {
        if (playerStatus !== PlayerStatus.PLAYING) {
            pauseBothPlayers();
            return;
        }
        if (isTransitioning) {
            return;
        }
        if (playerNum === 1) {
            player2Ref.current?.getInternalPlayer()?.pause();
        } else {
            player1Ref.current?.getInternalPlayer()?.pause();
        }
    }, [isTransitioning, playerNum, playerStatus, pauseBothPlayers]);

    useEffect(() => {
        const player1 = player1Ref.current?.getInternalPlayer();
        if (player1 && player1 instanceof HTMLAudioElement) {
            player1.preservesPitch = preservesPitch;
        }
        const player2 = player2Ref.current?.getInternalPlayer();
        if (player2 && player2 instanceof HTMLAudioElement) {
            player2.preservesPitch = preservesPitch;
        }
    }, [preservesPitch]);

    const handleOnReadyPlayer1 = useCallback(
        (player: ReactPlayer) => {
            failedWhileNext.current[1] = undefined;
            const internal = player.getInternalPlayer();
            if (internal && internal instanceof HTMLAudioElement) {
                internal.preservesPitch = preservesPitch;
            }
            onStartedPlayer1(player);
        },
        [onStartedPlayer1, preservesPitch],
    );

    const handleOnReadyPlayer2 = useCallback(
        (player: ReactPlayer) => {
            failedWhileNext.current[2] = undefined;
            const internal = player.getInternalPlayer();
            if (internal && internal instanceof HTMLAudioElement) {
                internal.preservesPitch = preservesPitch;
            }
            onStartedPlayer2(player);
        },
        [onStartedPlayer2, preservesPitch],
    );

    if (isLoading || !ReactPlayerComponent) {
        return <div id="web-player-engine" style={{ display: 'none' }} />;
    }

    return (
        <div id="web-player-engine" style={{ display: 'none' }}>
            <ReactPlayerComponent
                config={{
                    file: { attributes: { crossOrigin: 'anonymous' }, forceAudio: true },
                }}
                controls={false}
                height={0}
                id="web-player-1"
                loop={loopPlayer1}
                muted={isMuted}
                onBufferEnd={handleOnPlaying}
                onEnded={src1 && !loopPlayer1 ? () => onEndedPlayer1() : undefined}
                onError={handleOnError(1, player1Ref, () => onEndedPlayer1(), networkRetryCount1)}
                onProgress={onProgressPlayer1}
                onReady={handleOnReadyPlayer1}
                playbackRate={speed || 1}
                playing={playerNum === 1 && playerStatus === PlayerStatus.PLAYING}
                progressInterval={isTransitioning ? 10 : 250}
                ref={player1Ref}
                url={src1 || EMPTY_SOURCE}
                volume={volume1}
                width={0}
            />
            <ReactPlayerComponent
                config={{
                    file: { attributes: { crossOrigin: 'anonymous' }, forceAudio: true },
                }}
                controls={false}
                height={0}
                id="web-player-2"
                loop={loopPlayer2}
                muted={isMuted}
                onBufferEnd={handleOnPlaying}
                onEnded={src2 && !loopPlayer2 ? () => onEndedPlayer2() : undefined}
                onError={handleOnError(2, player2Ref, () => onEndedPlayer2(), networkRetryCount2)}
                onProgress={onProgressPlayer2}
                onReady={handleOnReadyPlayer2}
                playbackRate={speed || 1}
                playing={playerNum === 2 && playerStatus === PlayerStatus.PLAYING}
                progressInterval={isTransitioning ? 10 : 250}
                ref={player2Ref}
                url={src2 || EMPTY_SOURCE}
                volume={volume2}
                width={0}
            />
        </div>
    );
};

WebPlayerEngine.displayName = 'WebPlayerEngine';
