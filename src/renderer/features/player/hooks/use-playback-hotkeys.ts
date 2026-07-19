import isElectron from 'is-electron';
import { useMemo } from 'react';

import { HotkeyItem, useHotkeys } from '/@/renderer/hooks/use-hotkeys';
import { useHotkeySettings, useHubStore, usePlayerStore } from '/@/renderer/store';

const hub = isElectron() ? window.api.hub : null;

/**
 * When playback is live on another navi-connect device, transport hotkeys must
 * control the remote session, not the (paused) local player — otherwise e.g.
 * spacebar starts local audio on top of the remote playback.
 */
const sendRemote = (action: string, extra?: Record<string, unknown>): boolean => {
    const s = useHubStore.getState();
    const isRemoteActive =
        s.connected &&
        s.activeDeviceId !== null &&
        s.myDeviceId !== null &&
        s.activeDeviceId !== s.myDeviceId;
    if (!isRemoteActive || !hub) return false;
    hub.send({ action, t: 'act', ...extra });
    return true;
};

const remoteSeekBy = (offsetSec: number): boolean => {
    const s = useHubStore.getState();
    const elapsed = s.remoteIsPlaying ? Date.now() - s.remotePositionAt : 0;
    const positionMs = Math.max(0, s.remotePositionMs + elapsed + offsetSec * 1000);
    return sendRemote('seek', { positionMs: Math.round(positionMs) });
};

const cycleRemoteRepeat = (): boolean => {
    const current = useHubStore.getState().remoteRepeat;
    const next = current === 'none' ? 'all' : current === 'all' ? 'one' : 'none';
    return sendRemote('repeat', { mode: next });
};

export const usePlaybackHotkeys = () => {
    const { bindings } = useHotkeySettings();
    const player = usePlayerStore();

    const playbackHotkeysItems = useMemo(() => {
        const hotkeyItems: HotkeyItem[] = [];

        const bindingHandlers: Array<{
            binding: (typeof bindings)[keyof typeof bindings];
            handler: () => void;
        }> = [
            {
                binding: bindings.next,
                handler: () => {
                    if (!sendRemote('next')) player.mediaNext(false);
                },
            },
            {
                binding: bindings.nextAlbum,
                handler: () => player.mediaNext(true),
            },
            {
                binding: bindings.pause,
                handler: () => {
                    if (!sendRemote('pause')) player.mediaPause();
                },
            },
            {
                binding: bindings.play,
                handler: () => {
                    if (!sendRemote('play')) player.mediaPlay();
                },
            },
            {
                binding: bindings.playPause,
                handler: () => {
                    if (!sendRemote('playpause')) player.mediaTogglePlayPause();
                },
            },
            {
                binding: bindings.previous,
                handler: () => {
                    if (!sendRemote('previous')) player.mediaPrevious(false);
                },
            },
            {
                binding: bindings.previousAlbum,
                handler: () => player.mediaPrevious(true),
            },
            {
                binding: bindings.skipBackward,
                handler: () => {
                    if (!remoteSeekBy(-10)) player.mediaSkipBackward();
                },
            },
            {
                binding: bindings.skipForward,
                handler: () => {
                    if (!remoteSeekBy(10)) player.mediaSkipForward();
                },
            },
            {
                binding: bindings.stop,
                handler: () => {
                    if (!sendRemote('pause')) player.mediaStop();
                },
            },
            {
                binding: bindings.toggleRepeat,
                handler: () => {
                    if (!cycleRemoteRepeat()) player.toggleRepeat();
                },
            },
            {
                binding: bindings.toggleShuffle,
                handler: () => {
                    if (!sendRemote('shuffle', { on: !useHubStore.getState().remoteShuffle })) {
                        player.toggleShuffle();
                    }
                },
            },
        ];

        // Filter and map to hotkey items
        bindingHandlers.forEach(({ binding, handler }) => {
            if (!binding.isGlobal && binding.hotkey && binding.hotkey !== '') {
                hotkeyItems.push([binding.hotkey, handler]);
            }
        });

        return hotkeyItems;
    }, [bindings, player]);

    useHotkeys(playbackHotkeysItems);
};

export const PlaybackHotkeysHook = () => {
    usePlaybackHotkeys();
    return null;
};
