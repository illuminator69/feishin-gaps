import { useEffect, useRef } from 'react';

import { useSaveQueue } from '/@/renderer/features/player/hooks/use-queue-restore';
import { useCurrentServer, useHubStore, usePlayerSong, useSettingsStore } from '/@/renderer/store';
import { ServerType } from '/@/shared/types/domain-types';

export const useAutosave = () => {
    const server = useCurrentServer();
    const currentSong = usePlayerSong();
    const priorSongId = useRef<string | undefined>(undefined);
    const songCount = useRef(0);
    const { count, enabled } = useSettingsStore((state) => state.general.autoSave);
    const { mutate: savePlayQueue } = useSaveQueue();

    useEffect(() => {
        // While the hub is connected IT owns the Navidrome savePlayQueue mirror (it
        // writes the whole session, including remote playback this client can't see).
        // Two writers race and the loser persists a stale queue/position.
        if (useHubStore.getState().connected) return;
        if (enabled && server?.type && server.type !== ServerType.JELLYFIN) {
            if (currentSong?._uniqueId !== priorSongId.current) {
                if (songCount.current === count) {
                    savePlayQueue();
                    songCount.current = 1;
                } else {
                    songCount.current += 1;
                }

                priorSongId.current = currentSong?._uniqueId;
            }
        }
    }, [enabled, count, currentSong?._uniqueId, savePlayQueue, server?.type]);
};

export const AutosaveHook = () => {
    useAutosave();
    return null;
};
