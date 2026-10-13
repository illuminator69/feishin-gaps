// navi-connect (I-033): when a device tells the hub its own volume. Pure, and shared by the two
// parties that report one - the renderer for this machine (use-hub) and the cast bridge for a
// speaker - so the rule is tested once (level-report.harness.ts).
//
// A row in every picker shows a device's volume, and the hub knew only the level it had last
// TOLD the device (default 100): a level changed at the device itself never reached it. So a
// device says `{t:'deviceState', volume}` after `welcome` and whenever its level changes. The
// hub does not throttle that frame and a dragged slider changes many times a second, so the
// sender keeps to at most one every 250 ms, and the level it ends on is always sent: a change
// that comes too soon is asked about again when its wait is over, and sent then if it still
// differs from the last one sent.

/** The least time between two volume reports. */
export const LEVEL_REPORT_MIN_MS = 250;

/** The last volume report sent on the current hub connection. */
export interface LevelReport {
    /** Wall-clock ms it was sent. */
    at: number;
    /** Null: none yet on this connection, so the first level is sent whatever it is. */
    level: null | number;
}

/** A new hub connection (`welcome`): the hub's row is whatever it was last told or kept. */
export const NO_LEVEL_REPORT: LevelReport = { at: 0, level: null };

/**
 * What to do about the device being at `level` now: `'send'` it, ask again in that many ms, or
 * nothing (null) because it is the level last sent.
 */
export function levelReportStep(
    last: LevelReport,
    level: number,
    now: number,
): 'send' | null | number {
    if (level === last.level) return null;
    if (last.level === null) return 'send';
    const since = now - last.at;
    // `since < 0`: a clock set back must not hold the report for as long as that takes.
    if (since < 0 || since >= LEVEL_REPORT_MIN_MS) return 'send';
    return LEVEL_REPORT_MIN_MS - since;
}

/** A volume as the wire carries it: an integer 0..100. Anything that is not a number is 0. */
export function toLevel(volume: unknown): number {
    if (typeof volume !== 'number' || !Number.isFinite(volume)) return 0;
    return Math.min(100, Math.max(0, Math.round(volume)));
}
