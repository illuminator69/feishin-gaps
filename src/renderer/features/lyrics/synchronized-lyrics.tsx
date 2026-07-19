import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import styles from './synchronized-lyrics.module.css';

import '/@/renderer/features/lyrics/styles/synchronized-lyrics-animation.css';
import {
    findOverlayLineByTime,
    getLyricLineStartMs,
    getLyricLineText,
    normalizeLyrics,
} from '/@/renderer/features/lyrics/api/lyrics-utils';
import { LyricsScrollContent } from '/@/renderer/features/lyrics/components/lyrics-scroll-content';
import { useLyricsAnimationEngine } from '/@/renderer/features/lyrics/hooks/use-lyrics-animation-engine';
import {
    LYRICS_SCROLL_CONTAINER_ID,
    useSynchronizedLyricsBase,
} from '/@/renderer/features/lyrics/hooks/use-synchronized-lyrics-base';
import { LyricLine } from '/@/renderer/features/lyrics/lyric-line';
import {
    subscribePlayerStatus,
    useHubIsRemoteActive,
    useHubStore,
    usePlayerStoreBase,
} from '/@/renderer/store';
import { subscribePlayerProgress, useTimestampStoreBase } from '/@/renderer/store/timestamp.store';
import {
    FullLyricsMetadata,
    SynchronizedLyrics as SynchronizedLyricsData,
} from '/@/shared/types/domain-types';
import { PlayerStatus } from '/@/shared/types/types';

export interface SynchronizedLyricsProps extends Omit<FullLyricsMetadata, 'lyrics'> {
    extraOverlayLyrics?: SynchronizedLyricsData[];
    lyrics: SynchronizedLyricsData;
    offsetMs?: number;
    pronunciationLyrics?: null | SynchronizedLyricsData;
    romajiLyrics?: null | SynchronizedLyricsData;
    settingsKey?: string;
    style?: React.CSSProperties;
    translatedLyrics?: null | string;
    translationLyrics?: null | SynchronizedLyricsData;
}

const SEEK_DETECT_THRESHOLD_MS = 500;

export const SynchronizedLyrics = ({
    artist,
    lyrics,
    name,
    offsetMs,
    pronunciationLyrics,
    romajiLyrics,
    settingsKey = 'default',
    source,
    style,
    translatedLyrics,
    translationLyrics,
}: SynchronizedLyricsProps) => {
    const {
        containerRef,
        containerStyle,
        delayMsRef,
        followRef,
        followScrollAlignmentRef,
        handleLineClick,
        hideScrollbar,
        lineLeadTimeMsRef,
        lyricRef,
        resumeAutoscroll,
        scrollAnimStateRef,
        settings,
        showScrollbar,
    } = useSynchronizedLyricsBase(settingsKey, offsetMs);

    const normalizedLyrics = useMemo(() => normalizeLyrics(lyrics), [lyrics]);
    const rafRef = useRef<null | number>(null);
    const lastSyncedTimeRef = useRef(0);

    // navi-connect: when playback is live on another device, the lyrics view
    // follows the REMOTE session's position/status (and click-to-seek, wired in
    // use-synchronized-lyrics-base, drives it) instead of the frozen local player.
    const isRemoteActive = useHubIsRemoteActive();
    const isRemoteActiveRef = useRef(isRemoteActive);
    useEffect(() => {
        isRemoteActiveRef.current = isRemoteActive;
    }, [isRemoteActive]);

    const getTimestampSec = useCallback(() => {
        if (isRemoteActiveRef.current) {
            const s = useHubStore.getState();
            const elapsed = s.remoteIsPlaying ? Date.now() - s.remotePositionAt : 0;
            return Math.max(0, (s.remotePositionMs + elapsed) / 1000);
        }
        return useTimestampStoreBase.getState().timestamp;
    }, []);

    const getStatus = useCallback((): PlayerStatus => {
        if (isRemoteActiveRef.current) {
            return useHubStore.getState().remoteIsPlaying
                ? PlayerStatus.PLAYING
                : PlayerStatus.PAUSED;
        }
        return usePlayerStoreBase.getState().player.status;
    }, []);

    const statusRef = useRef(getStatus());

    const {
        rebuildLyricsData,
        reset,
        resumeAutoscroll: resumeEngineAutoscroll,
        tick,
    } = useLyricsAnimationEngine({
        animStateRef: scrollAnimStateRef,
        containerRef,
        followRef,
        followScrollAlignmentRef,
        fontSize: settings.fontSize,
        gap: settings.gap,
        lineIdPrefix: 'lyric',
        lineLeadTimeMsRef,
        lyrics: normalizedLyrics,
        paddingLeft: settings.paddingLeft,
        paddingRight: settings.paddingRight,
        scrollContainerId: LYRICS_SCROLL_CONTAINER_ID,
    });

    const syncAtTime = useCallback(
        (timeInMs: number, isPlaying: boolean, forceReset = false) => {
            if (forceReset) {
                reset();
                rebuildLyricsData();
            }

            tick(timeInMs, isPlaying);
            lastSyncedTimeRef.current = timeInMs;
        },
        [rebuildLyricsData, reset, tick],
    );

    const stopRaf = useCallback(() => {
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
    }, []);

    const startRaf = useCallback(() => {
        stopRaf();

        const runTick = () => {
            if (statusRef.current !== PlayerStatus.PLAYING) {
                stopRaf();
                return;
            }

            const timeInMs = getTimestampSec() * 1000 + delayMsRef.current;

            if (Math.abs(timeInMs - lastSyncedTimeRef.current) > SEEK_DETECT_THRESHOLD_MS) {
                resumeAutoscroll();
                resumeEngineAutoscroll();
                syncAtTime(timeInMs, true, true);
            } else {
                syncAtTime(timeInMs, true);
            }

            rafRef.current = requestAnimationFrame(runTick);
        };

        rafRef.current = requestAnimationFrame(runTick);
    }, [delayMsRef, getTimestampSec, resumeAutoscroll, resumeEngineAutoscroll, stopRaf, syncAtTime]);

    const syncFromCurrentTimestamp = useCallback(() => {
        const isPlaying = getStatus() === PlayerStatus.PLAYING;
        syncAtTime(getTimestampSec() * 1000 + delayMsRef.current, isPlaying, true);
    }, [delayMsRef, getStatus, getTimestampSec, syncAtTime]);

    useEffect(() => {
        lyricRef.current = normalizedLyrics;
        lastSyncedTimeRef.current = 0;

        const frame = requestAnimationFrame(() => {
            rebuildLyricsData();

            if (statusRef.current === PlayerStatus.PLAYING) {
                startRaf();
            } else {
                syncFromCurrentTimestamp();
            }
        });

        return () => {
            cancelAnimationFrame(frame);
            stopRaf();
            reset();
        };
    }, [
        lyricRef,
        normalizedLyrics,
        rebuildLyricsData,
        reset,
        startRaf,
        stopRaf,
        syncFromCurrentTimestamp,
    ]);

    useEffect(() => {
        syncFromCurrentTimestamp();
    }, [offsetMs, syncFromCurrentTimestamp]);

    useEffect(() => {
        const applyStatus = (status: PlayerStatus) => {
            statusRef.current = status;

            if (status !== PlayerStatus.PLAYING) {
                stopRaf();
                syncFromCurrentTimestamp();
                return;
            }

            startRaf();
        };

        applyStatus(getStatus());

        const unsubLocalStatus = subscribePlayerStatus(({ status }) => {
            // In a remote session the remote device drives play/pause.
            if (isRemoteActiveRef.current) return;
            applyStatus(status);
        });

        // Mirror the remote session's play/pause and ~1 Hz progress frames.
        let lastRemotePlaying = useHubStore.getState().remoteIsPlaying;
        let lastRemotePositionAt = useHubStore.getState().remotePositionAt;
        const unsubHub = useHubStore.subscribe((s) => {
            if (!isRemoteActiveRef.current) return;

            if (s.remoteIsPlaying !== lastRemotePlaying) {
                lastRemotePlaying = s.remoteIsPlaying;
                applyStatus(s.remoteIsPlaying ? PlayerStatus.PLAYING : PlayerStatus.PAUSED);
            }

            // A fresh progress frame while paused (seek / track change) → resync.
            if (s.remotePositionAt !== lastRemotePositionAt) {
                lastRemotePositionAt = s.remotePositionAt;
                if (!s.remoteIsPlaying) syncFromCurrentTimestamp();
            }
        });

        return () => {
            unsubLocalStatus();
            unsubHub();
        };
    }, [getStatus, isRemoteActive, startRaf, stopRaf, syncFromCurrentTimestamp]);

    useEffect(() => {
        const unsubscribe = subscribePlayerProgress(({ timestamp }) => {
            // Remote progress is handled via the hub-store subscription above.
            if (isRemoteActiveRef.current) return;

            const timeInMs = timestamp * 1000 + delayMsRef.current;
            const isPlaying = statusRef.current === PlayerStatus.PLAYING;

            if (!isPlaying) {
                syncAtTime(timeInMs, false, true);
                return;
            }

            if (Math.abs(timeInMs - lastSyncedTimeRef.current) > SEEK_DETECT_THRESHOLD_MS) {
                resumeAutoscroll();
                resumeEngineAutoscroll();
                syncAtTime(timeInMs, true, true);
            }
        });

        return unsubscribe;
    }, [delayMsRef, resumeAutoscroll, resumeEngineAutoscroll, syncAtTime]);

    const handleContainerClick = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            resumeAutoscroll();
            resumeEngineAutoscroll();
            handleLineClick(event);
        },
        [handleLineClick, resumeAutoscroll, resumeEngineAutoscroll],
    );

    const getOverlayText = (
        overlayLyrics: null | SynchronizedLyricsData | undefined,
        startMs: number,
        lineIndex: number,
        fallback?: null | string,
    ) => {
        if (overlayLyrics) {
            return findOverlayLineByTime(overlayLyrics, startMs, lineIndex);
        }

        return fallback;
    };

    return (
        <div
            className={clsx(styles.container, 'synchronized-lyrics overlay-scrollbar')}
            id={LYRICS_SCROLL_CONTAINER_ID}
            onClick={handleContainerClick}
            onMouseEnter={showScrollbar}
            onMouseLeave={hideScrollbar}
            ref={containerRef}
            style={{ ...containerStyle, ...style }}
        >
            <LyricsScrollContent
                gap={settings.gap}
                paddingLeft={settings.paddingLeft}
                paddingRight={settings.paddingRight}
            >
                {settings.showProvider && source && (
                    <LyricLine
                        alignment={settings.alignment}
                        className="lyric-credit"
                        fontSize={settings.fontSize}
                        text={`${source}`}
                    />
                )}
                {settings.showMatch && (
                    <LyricLine
                        alignment={settings.alignment}
                        className="lyric-credit"
                        fontSize={settings.fontSize}
                        text={`${name} — ${artist}`}
                    />
                )}
                {normalizedLyrics.map((rawLine, idx) => {
                    const lineStartMs = getLyricLineStartMs(rawLine);
                    const lineText = getLyricLineText(rawLine);
                    const pronunciationText = getOverlayText(
                        pronunciationLyrics,
                        lineStartMs,
                        idx,
                        romajiLyrics?.[idx] ? getLyricLineText(romajiLyrics[idx]) : undefined,
                    );
                    const translationText = getOverlayText(
                        translationLyrics,
                        lineStartMs,
                        idx,
                        translatedLyrics?.split('\n')[idx],
                    );

                    return (
                        <LyricLine
                            alignment={settings.alignment}
                            className="lyric-line synchronized"
                            data-lyric-time={lineStartMs}
                            fontSize={settings.fontSize}
                            id={`lyric-${idx}`}
                            key={idx}
                            romajiText={pronunciationText}
                            text={lineText}
                            translatedText={translationText}
                        />
                    );
                })}
            </LyricsScrollContent>
        </div>
    );
};
