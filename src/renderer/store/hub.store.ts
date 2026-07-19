import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

/**
 * Live navi-connect state for the UI (device picker + remote playerbar). Fed by
 * use-hub.tsx from the hub's `welcome`/`session`/`devices`/`progress` frames.
 * Not persisted — it's a mirror of transient hub state.
 */
export interface HubDevice {
    caps: string[];
    id: string;
    isActive: boolean;
    name: string;
    online: boolean;
    platform: string;
    volume?: number;
}

export interface HubTrack {
    album?: string;
    artist?: string;
    durationMs?: number;
    favorite?: boolean;
    id: string;
    imageUrl?: null | string;
    rating?: null | number;
    title?: string;
}

interface HubState {
    activeDeviceId: null | string;
    connected: boolean;
    devices: HubDevice[];
    myDeviceId: null | string;
    /** Whether the remote session is currently playing. */
    remoteIsPlaying: boolean;
    /** Current queue index of the remote session. */
    remoteQueueIndex: number;
    /** Position of the remote session at `remotePositionAt` (wall clock ms). */
    remotePositionAt: number;
    remotePositionMs: number;
    /** Lightweight mirror of the hub session queue (for now-playing display). */
    remoteQueue: HubTrack[];
    remoteRepeat: 'all' | 'none' | 'one';
    remoteShuffle: boolean;
}

interface HubSlice extends HubState {
    actions: {
        reset: () => void;
        setStore: (data: Partial<HubState>) => void;
    };
}

const initialState: HubState = {
    activeDeviceId: null,
    connected: false,
    devices: [],
    myDeviceId: null,
    remoteIsPlaying: false,
    remotePositionAt: 0,
    remotePositionMs: 0,
    remoteQueue: [],
    remoteQueueIndex: 0,
    remoteRepeat: 'none',
    remoteShuffle: false,
};

export const useHubStore = createWithEqualityFn<HubSlice>()((set) => ({
    actions: {
        reset: () => set({ ...initialState }),
        setStore: (data) => set((state) => ({ ...state, ...data })),
    },
    ...initialState,
}));

export const useHubDevices = () => useHubStore((s) => s.devices, shallow);
export const useHubActiveDeviceId = () => useHubStore((s) => s.activeDeviceId);
export const useHubMyDeviceId = () => useHubStore((s) => s.myDeviceId);
export const useHubConnected = () => useHubStore((s) => s.connected);
export const useHubActions = () => useHubStore((s) => s.actions);

/** True when playback is live on ANOTHER device — i.e. show the remote view. */
export const useHubIsRemoteActive = () =>
    useHubStore(
        (s) =>
            s.connected &&
            s.activeDeviceId !== null &&
            s.myDeviceId !== null &&
            s.activeDeviceId !== s.myDeviceId,
    );

export const useHubRemoteNowPlaying = () =>
    useHubStore((s) => s.remoteQueue[s.remoteQueueIndex] ?? null, shallow);

export const useHubRemoteIsPlaying = () => useHubStore((s) => s.remoteIsPlaying);

export const useHubActiveDeviceName = () =>
    useHubStore((s) => s.devices.find((d) => d.id === s.activeDeviceId)?.name ?? 'remote device');

export const useHubActiveDeviceVolume = () =>
    useHubStore((s) => s.devices.find((d) => d.id === s.activeDeviceId)?.volume ?? 100);

export const useHubRemoteRepeat = () => useHubStore((s) => s.remoteRepeat);
export const useHubRemoteShuffle = () => useHubStore((s) => s.remoteShuffle);
