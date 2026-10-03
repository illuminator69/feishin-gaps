import { del, get, set } from 'idb-keyval';
import { useEffect, useState } from 'react';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { createWithEqualityFn } from 'zustand/traditional';

const PLAYER_TIMESTAMP_POLL_INTERVAL_MS = 500;

interface TimestampState {
    setTimestamp: (timestamp: number) => void;
    timestamp: number;
}

const timestampStorage = {
    getItem: async (name: string) => {
        const value = await get(name);
        if (value === undefined) {
            return null;
        }
        return { state: { timestamp: value }, version: 1 } as const;
    },
    removeItem: async (name: string) => {
        await del(name);
    },
    setItem: async (name: string, value: { state: { timestamp: number }; version?: number }) => {
        await set(name, value.state.timestamp);
    },
};

export const useTimestampStoreBase = createWithEqualityFn<TimestampState>()(
    persist(
        subscribeWithSelector((set) => ({
            setTimestamp: (timestamp: number) => {
                set({ timestamp });
            },
            timestamp: 0,
        })),
        {
            name: 'player-timestamp',
            storage: timestampStorage,
            version: 1,
        },
    ),
);

export const subscribePlayerProgress = (
    onChange: (properties: { timestamp: number }, prev: { timestamp: number }) => void,
) => {
    return useTimestampStoreBase.subscribe(
        (state) => state.timestamp,
        (timestamp, prevTimestamp) => {
            onChange({ timestamp }, { timestamp: prevTimestamp });
        },
        {
            equalityFn: (a, b) => {
                return a === b;
            },
        },
    );
};

export const usePlayerProgress = () => {
    return useTimestampStoreBase((state) => state.timestamp);
};

export const usePlayerTimestamp = () => {
    const [timestamp, setLocalTimestamp] = useState(
        () => useTimestampStoreBase.getState().timestamp,
    );

    useEffect(() => {
        // navi-connect (B-030): call setState only when the value moved. A setState that
        // resolves to the current state still queues an update on the hook (React's eager
        // bail-out) that is only drained by the component's next render — never, while
        // paused — so the old "return prev" updater leaked one update per tick.
        let lastTimestamp: number | undefined;
        const syncTimestamp = () => {
            const nextTimestamp = useTimestampStoreBase.getState().timestamp;
            if (nextTimestamp === lastTimestamp) return;
            lastTimestamp = nextTimestamp;
            setLocalTimestamp(nextTimestamp);
        };

        syncTimestamp();
        const interval = setInterval(syncTimestamp, PLAYER_TIMESTAMP_POLL_INTERVAL_MS);

        return () => clearInterval(interval);
    }, []);

    return timestamp;
};

// navi-connect (Q-051): the engines report where the playhead IS through this same store, so
// a write that MOVES it (a seek, a skip, a restored queue's position) passes `{ seek: true }`.
// Subscribers run synchronously inside set(), so one handling the change can tell which kind
// it is with isTimestampSeek() - use-hub's playhead run must never count a seek as playback.
// A counter, not a flag, so a seek nested in another seek's subscriber can't clear it early.
let seekWritesInFlight = 0;

export const isTimestampSeek = () => seekWritesInFlight > 0;

export const setTimestamp = (timestamp: number, options?: { seek?: boolean }) => {
    if (options?.seek) seekWritesInFlight += 1; // navi-connect (Q-051)
    try {
        useTimestampStoreBase.getState().setTimestamp(timestamp);
    } finally {
        if (options?.seek) seekWritesInFlight -= 1; // navi-connect (Q-051)
    }
};
