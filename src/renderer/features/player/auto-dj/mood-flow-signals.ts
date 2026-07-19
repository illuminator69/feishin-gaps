// navi-connect Tier 2: Mood Flow (Adaptive) feedback signals.
//
// Mirrors Navic's RadioManager mood logic: as the user plays, each outgoing
// track is classified by how much of it played before the next track started —
// a play-through is an ADD signal, an early skip is a SUBTRACT signal. Those two
// recency-bounded sets seed AudioMuse `/api/alchemy` (ADD/SUBTRACT items) so the
// Adaptive queue drifts toward what's being listened to and away from skips.
//
// Module-level state (one local player), recency-capped, deduped across sets —
// the same shape as Navic's `moodAddIds` / `moodSubtractIds` ArrayDeques.

// Play fraction at/above which the outgoing track counts as a play-through (ADD).
const MOOD_PLAYTHROUGH = 0.85;
// Play fraction at/below which the outgoing track counts as an early skip (SUBTRACT).
const MOOD_SKIP = 0.2;
// Max ids kept per set (oldest evicted) — keeps the centroid responsive to recent taste.
const MOOD_MAX = 12;

let addIds: string[] = [];
let subtractIds: string[] = [];

// Move `id` to the most-recent end of `into`, remove it from `from` (a track
// can't be both an ADD and a SUBTRACT), and trim the oldest beyond MOOD_MAX.
const record = (id: string, into: string[], from: string[]): { from: string[]; into: string[] } => {
    const nextFrom = from.filter((existing) => existing !== id);
    const nextInto = into.filter((existing) => existing !== id);
    nextInto.push(id);
    if (nextInto.length > MOOD_MAX) {
        nextInto.splice(0, nextInto.length - MOOD_MAX);
    }
    return { from: nextFrom, into: nextInto };
};

/**
 * Classify an outgoing track by its final play fraction (0–1) and record the
 * resulting signal. Fractions in the neutral middle band are ignored.
 */
export const recordMoodSignal = (songId: string, fraction: number): void => {
    if (!songId || !Number.isFinite(fraction)) return;

    if (fraction >= MOOD_PLAYTHROUGH) {
        const next = record(songId, addIds, subtractIds);
        addIds = next.into;
        subtractIds = next.from;
    } else if (fraction <= MOOD_SKIP) {
        const next = record(songId, subtractIds, addIds);
        subtractIds = next.into;
        addIds = next.from;
    }
};

export const getMoodFlowSignals = (): { addIds: string[]; subtractIds: string[] } => ({
    addIds: [...addIds],
    subtractIds: [...subtractIds],
});

export const resetMoodFlowSignals = (): void => {
    addIds = [];
    subtractIds = [];
};
