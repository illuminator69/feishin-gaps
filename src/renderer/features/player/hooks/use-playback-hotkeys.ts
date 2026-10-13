import { useMemo } from 'react';

import { notePauseRequest, notePlayRequest } from '/@/renderer/features/hub/utils/play-request';
import {
    remoteAct,
    remotePositionMsShown,
    remoteTogglePlayPause,
} from '/@/renderer/features/hub/utils/remote-queue';
import { HotkeyItem, useHotkeys } from '/@/renderer/hooks/use-hotkeys';
import { useHotkeySettings, useHubStore, usePlayerStore } from '/@/renderer/store';
import { PlayerStatus } from '/@/shared/types/types';

// When playback is live on another navi-connect device, transport hotkeys must
// control the remote session, not the (paused) local player - otherwise e.g.
// spacebar starts local audio on top of the remote playback. They go through
// remoteAct like the playerbar's controls: it returns false when no other device
// is playing, and the handler then drives the local player.

/** Seek the remote session relative to the position the bar shows (the player context's remoteSeekBy). */
const remoteSeekBy = (offsetSec: number): boolean => {
    const positionMs = Math.max(0, remotePositionMsShown() + offsetSec * 1000);
    return remoteAct('seek', { positionMs: Math.round(positionMs) });
};

const cycleRemoteRepeat = (): boolean => {
    const current = useHubStore.getState().remoteRepeat;
    const next = current === 'none' ? 'all' : current === 'all' ? 'one' : 'none';
    return remoteAct('repeat', { mode: next });
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
                    if (!remoteAct('next')) player.mediaNext(false);
                },
            },
            {
                binding: bindings.nextAlbum,
                handler: () => player.mediaNext(true),
            },
            {
                binding: bindings.pause,
                handler: () => {
                    if (remoteAct('pause')) return;
                    notePauseRequest(); // navi-connect (B-058): the store direct - mark it here
                    player.mediaPause();
                },
            },
            {
                binding: bindings.play,
                handler: () => {
                    if (remoteAct('play')) return;
                    notePlayRequest(); // navi-connect (B-058): the store direct - mark it here
                    player.mediaPlay();
                },
            },
            {
                binding: bindings.playPause,
                handler: () => {
                    if (remoteTogglePlayPause()) return;
                    // navi-connect (B-058): the store direct (space, by default) - mark a play here.
                    if (usePlayerStore.getState().player.status !== PlayerStatus.PLAYING) {
                        notePlayRequest();
                    } else {
                        notePauseRequest();
                    }
                    player.mediaTogglePlayPause();
                },
            },
            {
                binding: bindings.previous,
                handler: () => {
                    if (!remoteAct('previous')) player.mediaPrevious(false);
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
                    if (remoteAct('pause')) return;
                    notePauseRequest(); // navi-connect (B-058): the store direct - mark it here
                    player.mediaStop();
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
                    if (!remoteAct('shuffle', { on: !useHubStore.getState().remoteShuffle })) {
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
