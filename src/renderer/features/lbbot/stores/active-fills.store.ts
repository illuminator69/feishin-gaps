import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * The fill ledger: every download this client has asked lb-bot for, in flight and
 * finished, keyed by release-group id (or review-group id for a gap).
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
 * with an album that silently stopped being tracked.
 *
 * Settled rows used to be *deleted*, which made settling and never-having-happened
 * the same thing: a fill that failed while the modal was closed left no trace and
 * no way to ask why. They are now kept with their outcome for a week, which is
 * what the downloads view lists and what a retry re-issues from.
 */

/** How long a *running* fill is watched before we stop believing in it — see
 *  WATCH_TIMEOUT_MS in use-lbbot. A finished one is history and outlives this. */
const FILL_MAX_AGE_MS = 20 * 60 * 1000;

/** How long a finished row stays readable, and how many are kept at all. */
const LEDGER_RETAIN_MS = 7 * 24 * 60 * 60 * 1000;
const LEDGER_MAX = 50;

export interface ActiveFill {
    /** Display fields, captured at the tap. The downloads view may be opened days
     *  later, on a page with no artist behind it, and by then lb-bot may have
     *  forgotten the fill entirely — its own record of these is in memory. */
    album?: string;
    artist?: string;
    finishedAt?: number;
    /** The search rejected mp3s and would have found something with them. */
    mp3WouldHelp?: boolean;
    outcome?: FillOutcome;
    /** The quality override the download was started with; '' = lb-bot's default. */
    quality: string;
    /** lb-bot's own sentence for a failure. Shown verbatim — it names the cause. */
    reason?: string;
    /** The release lb-bot resolved the group to — what the status poll is keyed on. */
    releaseMbid: string;
    rgid: string;
    /** Set once the fill reached a terminal state, so the page can stop polling. */
    settled: boolean;
    /** The peer the user picked, if any, so a retry re-issues the same request. */
    sourceFolder?: string;
    sourcePeer?: string;
    startedAt: number;
    /** Last state lb-bot reported, kept so a settled row can explain itself. */
    state?: string;
}

/** A gap fill, keyed by lb-bot review group id. Same reasoning as ActiveFill: a
 *  per-track fill takes minutes, so the watch belongs to the page and to disk,
 *  not to the modal that started it. */
export interface ActiveGap {
    album?: string;
    artist?: string;
    finishedAt?: number;
    groupId: string;
    mp3WouldHelp?: boolean;
    outcome?: FillOutcome;
    reason?: string;
    settled: boolean;
    startedAt: number;
    state?: string;
}

/**
 * How a fill ended. `needsPick` is the gap picker holding candidates and waiting on
 * the user, and `gaveUp` is "nothing ever acted on this" — lb-bot never wrote a
 * ledger row, or was restarted and forgot it. Neither is a failure, and neither
 * should be worded as one.
 */
export type FillOutcome = 'cancelled' | 'done' | 'failed' | 'gaveUp' | 'needsPick' | 'running';

/** What settling a row records. Everything is optional because a cancel knows the
 *  outcome and nothing else, while a poll knows the state and the reason too. */
export interface SettleInfo {
    mp3WouldHelp?: boolean;
    outcome: FillOutcome;
    reason?: string;
    state?: string;
}

interface ActiveFillsState {
    actions: {
        clear: () => void;
        describe: (key: string, info: Partial<ActiveFill & ActiveGap>) => void;
        dismiss: (key: string) => void;
        reopen: (rgid: string, releaseMbid: string) => void;
        setQuality: (quality: string) => void;
        settle: (rgid: string, info?: SettleInfo) => void;
        settleGap: (groupId: string, info?: SettleInfo) => void;
        start: (
            rgid: string,
            releaseMbid: string,
            quality?: string,
            meta?: Partial<ActiveFill>,
        ) => void;
        startGap: (groupId: string, meta?: Partial<ActiveGap>) => void;
    };
    fills: Record<string, ActiveFill>;
    gaps: Record<string, ActiveGap>;
    /** Last quality the user picked, reused as the default for the next download. */
    preferredQuality: string;
}

/**
 * Two retention rules, because a running row and a finished one answer different
 * questions. Running rows still expire at the twenty-minute watch window; finished
 * ones are history, kept a week and capped so a heavy week can't grow the store
 * without bound.
 */
const prune = <T extends { finishedAt?: number; settled: boolean; startedAt: number }>(
    entries: Record<string, T>,
): Record<string, T> => {
    const now = Date.now();
    const kept = Object.entries(entries ?? {}).filter(([, entry]) =>
        entry.settled
            ? now - (entry.finishedAt ?? entry.startedAt) < LEDGER_RETAIN_MS
            : now - entry.startedAt < FILL_MAX_AGE_MS,
    );
    if (kept.length <= LEDGER_MAX) return Object.fromEntries(kept);
    return Object.fromEntries(
        kept
            .sort(
                (a, b) => (b[1].finishedAt ?? b[1].startedAt) - (a[1].finishedAt ?? a[1].startedAt),
            )
            .slice(0, LEDGER_MAX),
    );
};

export const useActiveFillsStore = create<ActiveFillsState>()(
    persist(
        (set) => ({
            actions: {
                clear: () => set({ fills: {}, gaps: {} }),
                /** Fold in whatever the latest poll learned — title, artist, last state.
                 *  Never blanks a field it has no answer for: a poll that returns
                 *  `unknown` still knows less than the tap that started the fill.
                 *
                 *  Returns the state *untouched* when it would change nothing. This is
                 *  load-bearing, not an optimisation: the watchers call this every tick
                 *  from an effect that depends on the very row it writes, so replacing an
                 *  identical row with a fresh object re-runs that effect immediately and
                 *  React stops the app at "Maximum update depth exceeded". A poll that
                 *  learns nothing new must be a no-op all the way down. */
                describe: (key, info) =>
                    set((state) => {
                        const target = state.fills[key] ? 'fills' : state.gaps[key] ? 'gaps' : null;
                        if (!target) return state;
                        // Via `unknown`: neither ActiveFill nor ActiveGap has an index
                        // signature, so TS refuses the direct conversion.
                        const current = state[target][key] as unknown as Record<string, unknown>;
                        const clean = Object.entries(info).filter(
                            ([k, v]) => v !== undefined && v !== '' && v !== current[k],
                        );
                        if (clean.length === 0) return state;
                        return {
                            [target]: {
                                ...state[target],
                                [key]: { ...current, ...Object.fromEntries(clean) },
                            },
                        } as Partial<ActiveFillsState>;
                    }),
                /** Forget one finished row. Only ever offered on a settled fill. */
                dismiss: (key) =>
                    set((state) => {
                        const { [key]: droppedFill, ...fills } = state.fills;
                        const { [key]: droppedGap, ...gaps } = state.gaps;
                        return droppedFill || droppedGap ? { fills, gaps } : state;
                    }),
                /** Re-open a settled row for another attempt, keeping its display fields
                 *  so the history stays one line per album rather than one per attempt. */
                reopen: (rgid, releaseMbid) =>
                    set((state) =>
                        state.fills[rgid]
                            ? {
                                  fills: {
                                      ...state.fills,
                                      [rgid]: {
                                          ...state.fills[rgid],
                                          finishedAt: undefined,
                                          outcome: 'running',
                                          reason: undefined,
                                          releaseMbid: releaseMbid || state.fills[rgid].releaseMbid,
                                          settled: false,
                                          startedAt: Date.now(),
                                          state: undefined,
                                      },
                                  },
                              }
                            : state,
                    ),
                setQuality: (quality) => set({ preferredQuality: quality }),
                settle: (rgid, info) =>
                    set((state) =>
                        state.fills[rgid] && !state.fills[rgid].settled
                            ? {
                                  fills: {
                                      ...state.fills,
                                      [rgid]: {
                                          ...state.fills[rgid],
                                          ...info,
                                          finishedAt: Date.now(),
                                          outcome: info?.outcome ?? 'gaveUp',
                                          settled: true,
                                      },
                                  },
                              }
                            : state,
                    ),
                settleGap: (groupId, info) =>
                    set((state) =>
                        state.gaps[groupId] && !state.gaps[groupId].settled
                            ? {
                                  gaps: {
                                      ...state.gaps,
                                      [groupId]: {
                                          ...state.gaps[groupId],
                                          ...info,
                                          finishedAt: Date.now(),
                                          outcome: info?.outcome ?? 'gaveUp',
                                          settled: true,
                                      },
                                  },
                              }
                            : state,
                    ),
                start: (rgid, releaseMbid, quality = '', meta) =>
                    set((state) => ({
                        fills: {
                            ...state.fills,
                            [rgid]: {
                                // Whatever the previous attempt knew survives a retap:
                                // a second tap must not blank the album title the row
                                // is displayed under.
                                ...state.fills[rgid],
                                ...meta,
                                finishedAt: undefined,
                                outcome: 'running',
                                quality,
                                reason: undefined,
                                releaseMbid,
                                rgid,
                                settled: false,
                                startedAt: Date.now(),
                            },
                        },
                    })),
                startGap: (groupId, meta) =>
                    set((state) => ({
                        gaps: {
                            ...state.gaps,
                            [groupId]: {
                                ...state.gaps[groupId],
                                ...meta,
                                finishedAt: undefined,
                                groupId,
                                outcome: 'running',
                                reason: undefined,
                                settled: false,
                                startedAt: Date.now(),
                            },
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
            // Every field added in v3 is optional and every old row was, by
            // definition, unsettled — so v2 data is readable as-is. Without an explicit
            // migrate zustand discards mismatched state outright, which would silently
            // drop a download in flight across the update.
            migrate: (persisted) => persisted as ActiveFillsState,
            name: 'store_lbbot_fills',
            // Never the action closures. Settled rows now DO persist — they are the
            // history the downloads view lists; `prune` is what bounds them.
            partialize: (state) => ({
                fills: prune(state.fills),
                gaps: prune(state.gaps),
                preferredQuality: state.preferredQuality,
            }),
            version: 3,
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

/** One row of the downloads view — an album fill and a gap fill flattened into the
 *  same shape, since the view renders them side by side and only the retry differs. */
export interface LedgerRow {
    album: string;
    artist: string;
    isGap: boolean;
    key: string;
    mp3WouldHelp: boolean;
    outcome: FillOutcome;
    reason: string;
    rgid: string;
    settled: boolean;
    sortAt: number;
    state: string;
}

const toRow = (entry: ActiveFill | ActiveGap, isGap: boolean): LedgerRow => ({
    album: entry.album ?? '',
    artist: entry.artist ?? '',
    isGap,
    key: isGap ? (entry as ActiveGap).groupId : (entry as ActiveFill).rgid,
    mp3WouldHelp: entry.mp3WouldHelp ?? false,
    outcome: entry.outcome ?? (entry.settled ? 'gaveUp' : 'running'),
    reason: entry.reason ?? '',
    rgid: isGap ? '' : (entry as ActiveFill).rgid,
    settled: entry.settled,
    sortAt: entry.finishedAt ?? entry.startedAt,
    state: entry.state ?? '',
});

/**
 * The whole ledger, in flight first then most recent — which is what someone opening
 * the downloads view came to see. Empty whenever lb-bot is unconfigured, because
 * nothing can then ever have been started; that is also how the view stays hidden.
 */
export const useFillLedger = (): LedgerRow[] => {
    // Two stable selections and a memo, NOT one selector building the array: a
    // selector that returns a fresh array every call re-renders on every store read
    // and trips zustand's infinite-loop guard. `state.fills` is referentially stable
    // between the updates that actually change it.
    const fills = useActiveFillsStore((state) => state.fills);
    const gaps = useActiveFillsStore((state) => state.gaps);
    return useMemo(
        () =>
            [
                ...Object.values(fills).map((fill) => toRow(fill, false)),
                ...Object.values(gaps).map((gap) => toRow(gap, true)),
            ].sort((a, b) => Number(a.settled) - Number(b.settled) || b.sortAt - a.sortAt),
        [fills, gaps],
    );
};
