import isElectron from 'is-electron';
import React, { useEffect, useRef, useState } from 'react';

import { useSendScrobble } from '/@/renderer/features/player/mutations/scrobble-mutation';
import {
    useAppStore,
    useCurrentServerId,
    useHubStore,
    usePlaybackSettings,
    useSettingsStore,
} from '/@/renderer/store';
import { LogCategory, logFn } from '/@/renderer/utils/logger';

/**
 * Scrobbling for playback on a Chromecast.
 *
 * Nothing else scrobbles it, and that is structural rather than an oversight:
 * in this protocol the *receiver* holds the Navidrome credentials and reports
 * its own plays, and a Chromecast is a receiver that holds no credentials and
 * cannot be taught to. Every controller watching the session is just a mirror.
 * So an evening cast to a speaker recorded nothing at all — no play counts, no
 * recently-played, no ListenBrainz.
 *
 * **Exactly one client may do this.** Scrobbling from "any controller watching a
 * cast session" would double-count as soon as a phone was left open on the same
 * session. The bridging client is the one honest answer: ownership of a speaker
 * is already arbitrated to a single client (PROTOCOL §12.2 — one bridge per
 * speaker, the hub closing the loser with `4003 superseded`), so "am I the
 * bridge for the active device" designates one client and no other. A cast
 * driven by some *other* client is that client's to report.
 *
 * The measurement mirrors `use-scrobble`: accumulated listening time, not
 * playhead position, so a seek doesn't buy credit for time not spent. It reads
 * the hub's ~1 Hz progress mirror instead of an audio element, which is the only
 * difference that matters.
 */

const castApi = isElectron() ? window.api.cast : null;

/** How often to sample the hub's position mirror. Matches the frame rate the
 *  hub publishes at; sampling faster would only interpolate our own guesses. */
const SAMPLE_MS = 1000;

/** Longest gap between samples still counted as continuous listening. Anything
 *  larger is a seek, a stall or a tab that was asleep — none of which is time
 *  spent listening. */
const MAX_LISTEN_DELTA_SEC = 5;

/** Below this the playhead is at the top of the track, which is how a restart is
 *  told apart from an ordinary rewind. */
const TRACK_BEGIN_SEC = 5;

const remotePositionSec = (): number => {
    const state = useHubStore.getState();
    const elapsed = state.remoteIsPlaying ? Date.now() - state.remotePositionAt : 0;
    return Math.max(0, (state.remotePositionMs + elapsed) / 1000);
};

const CastScrobbleInner = () => {
    const scrobbleSettings = usePlaybackSettings().scrobble;
    const sendScrobble = useSendScrobble();
    const serverId = useCurrentServerId();
    const activeDeviceId = useHubStore((state) => state.activeDeviceId);
    const connected = useHubStore((state) => state.connected);
    const [bridged, setBridged] = useState<string[]>([]);

    // Re-asked whenever the active device changes rather than polled: the answer
    // only matters at the moment something starts playing somewhere, and the
    // bridge set changes when speakers appear, not by the second.
    useEffect(() => {
        if (!castApi || !connected) {
            setBridged([]);
            return undefined;
        }
        let cancelled = false;
        void castApi.bridgedDevices().then((ids) => {
            if (!cancelled) setBridged(ids);
        });
        return () => {
            cancelled = true;
        };
    }, [connected, activeDeviceId]);

    const ours = !!activeDeviceId && bridged.includes(activeDeviceId);

    const listenedMsRef = useRef(0);
    const lastSampleRef = useRef<null | number>(null);
    const submittedRef = useRef(false);
    const trackKeyRef = useRef('');

    useEffect(() => {
        if (!ours || !serverId) return undefined;

        const timer = window.setInterval(() => {
            const state = useHubStore.getState();
            const track = state.remoteQueue[state.remoteQueueIndex];
            if (!track?.id) return;

            // Index and id together: a queue that repeats one track would
            // otherwise look like the same play forever, and scrobble once.
            const key = `${state.remoteQueueIndex}:${track.id}`;
            if (key !== trackKeyRef.current) {
                trackKeyRef.current = key;
                listenedMsRef.current = 0;
                lastSampleRef.current = null;
                submittedRef.current = false;
                // Now-playing, so the server shows the speaker's track as live
                // rather than silently accruing a play count at the end.
                if (state.remoteIsPlaying) {
                    sendScrobble.mutate({
                        apiClientProps: { serverId },
                        query: {
                            event: 'start',
                            id: track.id,
                            mediaType: 'song',
                            // A cast speaker plays at ordinary speed; this
                            // client's local rate says nothing about it.
                            playbackRate: 1,
                            position: 0,
                            submission: false,
                        },
                    });
                }
                return;
            }

            if (!state.remoteIsPlaying) {
                lastSampleRef.current = null;
                return;
            }

            const position = remotePositionSec();
            const last = lastSampleRef.current;
            lastSampleRef.current = position;

            if (last !== null) {
                const delta = position - last;
                if (position < last && position < TRACK_BEGIN_SEC && last >= TRACK_BEGIN_SEC) {
                    // Restarted from the top: a fresh play-through, and eligible
                    // to scrobble again.
                    listenedMsRef.current = 0;
                    submittedRef.current = false;
                } else if (delta > 0 && delta <= MAX_LISTEN_DELTA_SEC) {
                    listenedMsRef.current += delta * 1000;
                }
            }

            if (submittedRef.current) return;

            const durationMs = track.durationMs ?? 0;
            const percentage = durationMs ? (listenedMsRef.current / durationMs) * 100 : 0;
            // A zero duration threshold is "no duration rule", not "scrobble at
            // once" — the accumulator starts at zero and would clear a `>= 0`
            // test on the first sample of every track.
            const atDurationMs = (scrobbleSettings?.scrobbleAtDuration ?? 0) * 1000;
            const eligible =
                percentage >= (scrobbleSettings?.scrobbleAtPercentage ?? 75) ||
                (atDurationMs > 0 && listenedMsRef.current >= atDurationMs);

            if (!eligible) return;

            submittedRef.current = true;
            sendScrobble.mutate(
                {
                    apiClientProps: { serverId },
                    query: {
                        id: track.id,
                        mediaType: 'song',
                        playbackRate: 1,
                        position: durationMs,
                        submission: true,
                    },
                },
                {
                    onSuccess: () => {
                        logFn.debug('scrobbled a cast play', {
                            category: LogCategory.SCROBBLE,
                            meta: { id: track.id, reason: 'cast bridge' },
                        });
                    },
                },
            );
        }, SAMPLE_MS);

        return () => window.clearInterval(timer);
    }, [
        ours,
        serverId,
        sendScrobble,
        scrobbleSettings?.scrobbleAtDuration,
        scrobbleSettings?.scrobbleAtPercentage,
    ]);

    return null;
};

/** Mounted beside `ScrobbleHook`, and off under exactly the same conditions. */
export const CastScrobbleHook = () => {
    const isScrobbleEnabled = useSettingsStore((state) => state.playback.scrobble.enabled);
    const privateMode = useAppStore((state) => state.privateMode);

    if (!isScrobbleEnabled || privateMode || !castApi) {
        return null;
    }

    return React.createElement(CastScrobbleInner);
};
