import { shallow } from 'zustand/shallow';
import { createWithEqualityFn } from 'zustand/traditional';

/**
 * Live navi-connect state for the UI (device picker + remote playerbar). Fed by
 * use-hub.tsx from the hub's `welcome`/`session`/`devices`/`progress` frames.
 * Not persisted — it's a mirror of transient hub state.
 */
export interface HubDevice {
    /** Cast bridges only: is the receiver app currently up on the speaker? */
    appRunning?: boolean | null;
    /** For a virtual device (a Chromecast), the hub id of the client bridging it. */
    bridgedBy?: null | string;
    caps: string[];
    id: string;
    isActive: boolean;
    name: string;
    /**
     * A WebSocket claiming this id is attached. For a bridged Chromecast that is the
     * BRIDGE's socket — it says nothing about the speaker. See `reachable`.
     */
    online: boolean;
    platform: string;
    /**
     * The bridge's verdict on the hardware (PROTOCOL §3.2): `true` reached recently,
     * `false` connected-but-not-answering, `null`/absent unknown or not applicable —
     * which is every ordinary client, since a client IS its own hardware.
     */
    reachable?: boolean | null;
    volume?: number;
}

/** Can the session be handed to this device right now? Unknown reachability is permissive. */
export const isHubDeviceTransferable = (device: HubDevice): boolean =>
    device.online && device.reachable !== false;

export interface HubTrack {
    album?: string;
    /** Navidrome album id. Additive on the wire and absent from any publisher that
     *  doesn't send it — without it the receiving client's playerbar has only the
     *  album *name*, so the album title cannot be a link until getSongDetail lands. */
    albumId?: string;
    artist?: string;
    /** Per-artist ids, for the same reason as `albumId`. Track artists, so they link
     *  to the artist route rather than the album-artist one. */
    artists?: { id: string; name: string }[];
    durationMs?: number;
    favorite?: boolean;
    id: string;
    imageUrl?: null | string;
    rating?: null | number;
    title?: string;
}

interface HubSlice extends HubState {
    actions: {
        /**
         * Apply a local rating/favorite edit to the mirrored remote queue.
         *
         * **Why this exists.** While playback is on another device every
         * user-visible field of the playing song is read off `remoteQueue` /
         * `remoteNowPlaying` here, not off `player.store`. The rating and
         * favorite mutations publish their optimistic update as a `USER_RATING`
         * / `USER_FAVORITE` event, and the only listener for those calls
         * `updateQueueRatings` on the **player** store — which nothing is
         * reading while remote is active. So the write succeeded, the server
         * took it, and the stars did not move until the remote device happened
         * to republish its queue. That delay is the whole of "the rating does
         * show up eventually".
         *
         * The hub is still the authority: the next `session` frame overwrites
         * this wholesale, exactly as an optimistic cache update is meant to be
         * overwritten by the real answer.
         */
        patchRemoteTracks: (
            ids: string[],
            patch: Partial<Pick<HubTrack, 'favorite' | 'rating'>>,
        ) => void;
        reset: () => void;
        setStore: (data: Partial<HubState>) => void;
    };
}

interface HubState {
    activeDeviceId: null | string;
    connected: boolean;
    devices: HubDevice[];
    myDeviceId: null | string;
    /** Whether the remote session is currently playing. */
    remoteIsPlaying: boolean;
    /** Position of the remote session at `remotePositionAt` (wall clock ms). */
    remotePositionAt: number;
    remotePositionMs: number;
    /** Lightweight mirror of the hub session queue (for now-playing display). */
    remoteQueue: HubTrack[];
    /** Current queue index of the remote session. */
    remoteQueueIndex: number;
    remoteRepeat: 'all' | 'none' | 'one';
    remoteShuffle: boolean;
    /** Saved-queue history id of the CURRENT session — the "Now Playing" record. */
    savedQueueId: null | string;
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
    savedQueueId: null,
};

export const useHubStore = createWithEqualityFn<HubSlice>()((set) => ({
    actions: {
        patchRemoteTracks: (ids, patch) =>
            set((state) => {
                const wanted = new Set(ids);
                // Returning the same object when nothing matched keeps this from
                // re-rendering every remote-aware subscriber on an edit to a
                // song that is not in this queue at all.
                if (!state.remoteQueue.some((track) => wanted.has(track.id))) return state;
                return {
                    ...state,
                    remoteQueue: state.remoteQueue.map((track) =>
                        wanted.has(track.id) ? { ...track, ...patch } : track,
                    ),
                };
            }),
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

/** The saved-queue history id of the current session (the "Now Playing" record), or null. */
export const useHubSavedQueueId = () => useHubStore((s) => s.savedQueueId);
