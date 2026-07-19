import { useEffect, useRef, useState } from 'react';

import {
    audioMuseConfigured,
    fetchTrackMood,
    TrackMood,
} from '/@/renderer/features/player/auto-dj/audio-muse-source';
import { useAudioMuseSettings, usePlayerSong } from '/@/renderer/store';

const DEBOUNCE_MS = 400;

/**
 * Fetches the current track's AudioMuse sonic analysis (mood/energy) for the
 * visualizer. Cached per song id (null cached too, so unanalyzed/unconfigured
 * tracks aren't refetched), debounced, and fully fail-soft — returns null when
 * AudioMuse isn't configured, not in the desktop build, or the track is unanalyzed.
 */
export const useTrackMood = (): null | TrackMood => {
    const settings = useAudioMuseSettings();
    const song = usePlayerSong();
    const [mood, setMood] = useState<null | TrackMood>(null);
    const cacheRef = useRef<Map<string, null | TrackMood>>(new Map());

    const songId = song?.id;
    const { token, url } = settings;

    useEffect(() => {
        setMood(null);

        const config = { token, url };
        if (!songId || !audioMuseConfigured(config)) return undefined;

        const cached = cacheRef.current.get(songId);
        if (cached !== undefined) {
            setMood(cached);
            return undefined;
        }

        let cancelled = false;
        const timer = setTimeout(async () => {
            const result = await fetchTrackMood(config, songId);
            if (cancelled) return;
            cacheRef.current.set(songId, result);
            setMood(result);
        }, DEBOUNCE_MS);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [songId, token, url]);

    return mood;
};
