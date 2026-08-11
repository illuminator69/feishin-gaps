import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Fills started in this session, keyed by release-group id.
 *
 * A download outlives the sheet that started it by a long way — search, transfer,
 * placement and the Navidrome verify add up to minutes — so the watch cannot live
 * in the modal's own state. This is what keeps the artist page polling after the
 * sheet is closed, what puts a progress ring on the tile, and what tells the page
 * to re-read the discography once a fill lands.
 *
 * Persisted, because minutes is long enough to quit the app in. lb-bot's own
 * ledger is in memory, so a rehydrated fill may well find nothing on the other
 * end — but `unknown` is already the bounded-patience case in useLbBotFillStatus,
 * so that resolves itself in about ninety seconds instead of leaving the user
 * with an album that silently stopped being tracked. Anything older than the
 * watch window is dropped on load rather than re-polled.
 */

/** Fills older than this are dead to us — see WATCH_TIMEOUT_MS in use-lbbot. */
const FILL_MAX_AGE_MS = 20 * 60 * 1000;

export interface ActiveFill {
    /** The quality override the download was started with; '' = lb-bot's default. */
    quality: string;
    /** The release lb-bot resolved the group to — what the status poll is keyed on. */
    releaseMbid: string;
    rgid: string;
    /** Set once the fill reached a terminal state, so the page can stop polling. */
    settled: boolean;
    startedAt: number;
}

/** A gap fill in flight, keyed by lb-bot review group id. Same reasoning as
 *  ActiveFill: a per-track fill takes minutes, so the watch belongs to the page
 *  and to disk, not to the modal that started it. */
export interface ActiveGap {
    groupId: string;
    settled: boolean;
    startedAt: number;
}

interface ActiveFillsState {
    actions: {
        clear: () => void;
        setQuality: (quality: string) => void;
        settle: (rgid: string) => void;
        settleGap: (groupId: string) => void;
        start: (rgid: string, releaseMbid: string, quality?: string) => void;
        startGap: (groupId: string) => void;
    };
    fills: Record<string, ActiveFill>;
    gaps: Record<string, ActiveGap>;
    /** Last quality the user picked, reused as the default for the next download. */
    preferredQuality: string;
}

const prune = <T extends { settled: boolean; startedAt: number }>(
    entries: Record<string, T>,
): Record<string, T> => {
    const cutoff = Date.now() - FILL_MAX_AGE_MS;
    return Object.fromEntries(
        Object.entries(entries ?? {}).filter(
            ([, entry]) => !entry.settled && entry.startedAt > cutoff,
        ),
    );
};

export const useActiveFillsStore = create<ActiveFillsState>()(
    persist(
        (set) => ({
            actions: {
                clear: () => set({ fills: {}, gaps: {} }),
                setQuality: (quality) => set({ preferredQuality: quality }),
                settle: (rgid) =>
                    set((state) =>
                        state.fills[rgid]
                            ? {
                                  fills: {
                                      ...state.fills,
                                      [rgid]: { ...state.fills[rgid], settled: true },
                                  },
                              }
                            : state,
                    ),
                settleGap: (groupId) =>
                    set((state) =>
                        state.gaps[groupId]
                            ? {
                                  gaps: {
                                      ...state.gaps,
                                      [groupId]: { ...state.gaps[groupId], settled: true },
                                  },
                              }
                            : state,
                    ),
                start: (rgid, releaseMbid, quality = '') =>
                    set((state) => ({
                        fills: {
                            ...state.fills,
                            [rgid]: {
                                quality,
                                releaseMbid,
                                rgid,
                                settled: false,
                                startedAt: Date.now(),
                            },
                        },
                    })),
                startGap: (groupId) =>
                    set((state) => ({
                        gaps: {
                            ...state.gaps,
                            [groupId]: { groupId, settled: false, startedAt: Date.now() },
                        },
                    })),
            },
            fills: {},
            gaps: {},
            preferredQuality: '',
        }),
        {
            merge: (persisted, current) => {
                const saved = (persisted ?? {}) as Partial<ActiveFillsState>;
                return {
                    ...current,
                    fills: prune(saved.fills ?? {}),
                    gaps: prune(saved.gaps ?? {}),
                    preferredQuality: saved.preferredQuality ?? '',
                };
            },
            name: 'store_lbbot_fills',
            // Never the action closures, and never a fill that has already settled.
            partialize: (state) => ({
                fills: prune(state.fills),
                gaps: prune(state.gaps),
                preferredQuality: state.preferredQuality,
            }),
            version: 2,
        },
    ),
);

export const useActiveFill = (rgid: string): ActiveFill | undefined =>
    useActiveFillsStore((state) => state.fills[rgid]);

export const useActiveGap = (groupId: string): ActiveGap | undefined =>
    useActiveFillsStore((state) => state.gaps[groupId]);

export const useActiveFillsActions = () => useActiveFillsStore((state) => state.actions);

export const usePreferredQuality = (): string =>
    useActiveFillsStore((state) => state.preferredQuality);
