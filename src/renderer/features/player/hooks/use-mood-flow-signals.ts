import React, { useCallback, useEffect, useRef } from 'react';

import { usePlayerEvents } from '/@/renderer/features/player/audio-player/hooks/use-player-events';
import { audioMuseConfigured } from '/@/renderer/features/player/auto-dj/audio-muse-source';
import {
    recordMoodSignal,
    resetMoodFlowSignals,
} from '/@/renderer/features/player/auto-dj/mood-flow-signals';
import { useAudioMuseSettings, useSettingsStore } from '/@/renderer/store';
import { QueueSong } from '/@/shared/types/domain-types';

// Positions before this time (seconds) count as the start of the track — used to
// keep the outgoing track's true last position when song-change fires after the
// new track has already reported a ~0 timestamp (same race scrobble handles).
const TRACK_BEGIN_SEC = 5;

/**
 * Captures Mood Flow (Adaptive) feedback signals from LOCAL playback: as each
 * track gives way to the next, classify how far it played (play-through = ADD,
 * early skip = SUBTRACT). The signals seed the AudioMuse alchemy top-up in
 * use-auto-dj. Capture is local-only — remote playback produces no web-player
 * progress, so the remote Mood Flow path falls back to a current-song seed.
 */
export const useMoodFlowSignals = () => {
    const previousSongRef = useRef<QueueSong | undefined>(undefined);
    const stopPositionRef = useRef<number>(0);

    const handleProgress = useCallback(
        (properties: { timestamp: number }, prev: { timestamp: number }) => {
            // Preserve last position when the playhead resets to the start (song
            // change can fire after progress already reports ~0 for the new track).
            if (properties.timestamp < TRACK_BEGIN_SEC && prev.timestamp >= TRACK_BEGIN_SEC) {
                stopPositionRef.current = prev.timestamp;
            } else {
                stopPositionRef.current = properties.timestamp;
            }
        },
        [],
    );

    const handleSongChange = useCallback(
        (properties: { index: number; song: QueueSong | undefined }) => {
            const previousSong = previousSongRef.current;
            const stopSec = stopPositionRef.current;

            // duration is in milliseconds; progress timestamps are in seconds.
            if (previousSong?.id && previousSong.duration && previousSong.duration > 0) {
                const fraction = stopSec / (previousSong.duration / 1000);
                recordMoodSignal(previousSong.id, fraction);
            }

            previousSongRef.current = properties.song;
            stopPositionRef.current = 0;
        },
        [],
    );

    usePlayerEvents(
        {
            onCurrentSongChange: handleSongChange,
            onPlayerProgress: handleProgress,
        },
        [handleSongChange, handleProgress],
    );
};

const MoodFlowSignalsHookInner = () => {
    useMoodFlowSignals();

    // Clear accumulated signals when Mood Flow stops being the active source.
    useEffect(() => resetMoodFlowSignals, []);

    return null;
};

export const MoodFlowSignalsHook = () => {
    const isEnabled = useSettingsStore((state) => state.autoDJ.enabled);
    const autoplaySource = useSettingsStore((state) => state.autoDJ.autoplaySource);
    const audioMuse = useAudioMuseSettings();

    if (!isEnabled || autoplaySource !== 'moodFlow' || !audioMuseConfigured(audioMuse)) {
        return null;
    }

    return React.createElement(MoodFlowSignalsHookInner);
};
