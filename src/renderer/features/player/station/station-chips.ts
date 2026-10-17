import type {
    StationBinding,
    StationMode,
} from '/@/renderer/features/player/station/station-logic';
import type { StationCharacterId } from '/@/shared/types/station-types';

// navi-connect (I-041): the queue's chip row (Off, Close, Balanced, Explore; or Off, Auto DJ
// without the hub's station engine), as pure decisions so they can be replayed in
// station-chips.harness.ts. The same spec is implemented in Navic.
//
// A chip is a choice about the queue that is playing, and it takes effect now: Off takes out
// what the station queued that has not played, a character replaces it with a batch in that
// character. Neither ever touches the playing track or the one after it, so the music does not
// stop for it, and neither reloads the player: a local queue is edited in place, a remote
// session through `remove` acts and one `enqueue`, never a `setQueue` (the playing device would
// reload it, a gap in the music).

export type ChipId = 'autoDj' | 'off' | StationCharacterId;

export const STATION_CHIPS: readonly ChipId[] = ['off', 'close', 'balanced', 'explore'];
export const FALLBACK_CHIPS: readonly ChipId[] = ['off', 'autoDj'];

/** Which chips there are: the four with the station engine, Off and Auto DJ without it. */
export const chipsFor = (mode: StationMode): readonly ChipId[] =>
    mode === 'fallback' ? FALLBACK_CHIPS : STATION_CHIPS;

export interface ChipState {
    /** This device's preference: `autoDJ.enabled`. */
    autoplay: boolean;
    bound: null | StationBinding;
    mode: StationMode;
    /** This device's preferred character, what a new station starts with. */
    preferred: StationCharacterId;
}

/**
 * The selected chip. A queue that belongs to a station shows that station's state, which every
 * device shares: Off when it was stopped, else its character. Any other queue shows this
 * device's preference.
 */
export const selectedChip = (state: ChipState): ChipId => {
    if (state.mode === 'fallback') return state.autoplay ? 'autoDj' : 'off';
    if (state.bound) return state.bound.stopped ? 'off' : state.bound.character;
    return state.autoplay ? state.preferred : 'off';
};

/** One queue row, in play order. `key` is how the edit finds it again. */
export interface QueueEntry {
    id: string;
    /** Local: the row's `_uniqueId`. Remote: its queue index, as a string. */
    key: string;
    /** The row's index in queue order (the hub's `remove` takes it). */
    queueIndex: number;
    /** The station put it there (not the user, not the seed). */
    stationAdded: boolean;
}

/**
 * The station's rows that a chip may take out: station-added, in play order AFTER the next one.
 * The playing track and the one after it (already decoding) are never touched.
 */
export const removableStationRows = (
    playOrder: readonly QueueEntry[],
    position: number,
): QueueEntry[] => playOrder.slice(Math.max(0, position + 2)).filter((row) => row.stationAdded);

export interface ChipTapPlan {
    /** The preference to store. */
    autoplay: boolean;
    character?: StationCharacterId;
    /** Fallback only: Auto DJ was switched on and should look at the queue at once. */
    kickAutoDj?: boolean;
    /** What the bound station becomes on screen at once (the chip moves on the tap). */
    optimistic?: Partial<StationBinding>;
    /** Swap `rows` for a batch of this many from the station, in its new character. */
    replaceCount?: number;
    /** Station rows to take out now (Off), or to swap for a new batch (a character). */
    rows: QueueEntry[];
    signal?: { kind: 'character'; value: StationCharacterId } | { kind: 'stop' };
    /** Run the top-up decision now, so a queue near its end gets its batch without waiting. */
    topUp: boolean;
}

/** How many tracks a character change asks for to replace what the station had queued. */
export const REPLACE_COUNT = 5;

export const planChipTap = (
    chip: ChipId,
    state: ChipState,
    queue: { playOrder: readonly QueueEntry[]; position: number },
): ChipTapPlan => {
    if (state.mode === 'fallback') {
        // Upstream's Auto DJ, on or off. A character chip cannot be tapped here.
        const on = chip === 'autoDj';
        return { autoplay: on, kickAutoDj: on && !state.autoplay, rows: [], topUp: false };
    }
    const bound = state.bound;
    if (chip === 'off' || chip === 'autoDj') {
        if (!bound) return { autoplay: false, rows: [], topUp: false };
        // Off stops the station for every device and takes out what it queued that has not
        // played; nothing more is added to this queue while it stays Off.
        return {
            autoplay: false,
            optimistic: { stopped: true },
            rows: removableStationRows(queue.playOrder, queue.position),
            ...(bound.stopped ? {} : { signal: { kind: 'stop' as const } }),
            topUp: false,
        };
    }
    const plan: ChipTapPlan = { autoplay: true, character: chip, rows: [], topUp: true };
    if (bound && (bound.stopped || bound.character !== chip)) {
        // The character also lifts a stop (and the hub clears exhaustion on the change).
        plan.signal = { kind: 'character', value: chip };
        plan.optimistic = { character: chip, exhausted: false, stopped: false };
        const rows = removableStationRows(queue.playOrder, queue.position);
        if (rows.length > 0) {
            plan.rows = rows;
            plan.replaceCount = REPLACE_COUNT;
        }
    }
    return plan;
};

export type RemoteEditAct =
    | { action: 'enqueue'; at: 'end'; count: number }
    | { action: 'remove'; index: number };

/**
 * The acts that edit a REMOTE session: one `remove` per row, highest queue index first (each
 * removal shifts only the indexes after it), then one `enqueue` at the end for what replaces
 * them. Never a `setQueue`: the playing device would reload the whole queue.
 */
export const remoteEditActs = (
    removeIndexes: readonly number[],
    addCount: number,
): RemoteEditAct[] => [
    ...[...new Set(removeIndexes)]
        .filter((index) => Number.isInteger(index) && index >= 0)
        .sort((a, b) => b - a)
        .map((index) => ({ action: 'remove' as const, index })),
    ...(addCount > 0 ? [{ action: 'enqueue' as const, at: 'end' as const, count: addCount }] : []),
];
