import { useHubIsRemoteActive, useHubStore, usePlayerSong } from '/@/renderer/store';

/** The playing row's id in the side queue: `remote:<index>` while another device plays. */
export const usePlayingRowId = (): string | undefined => {
    const isRemote = useHubIsRemoteActive();
    const remoteIndex = useHubStore((s) => s.remoteQueueIndex);
    const localId = usePlayerSong()?._uniqueId;
    return isRemote ? `remote:${remoteIndex}` : localId;
};
