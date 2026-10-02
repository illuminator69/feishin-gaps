// navi-connect (B-053): "is local audio ACTUALLY rolling?", asked of the engine's clock (the
// timestamp store) rather than of the player store - see use-hub's audioIsRolling and
// awaitLoadOutcome. Pure so it can be tested without React (playhead-run.harness.ts).
//
// The rule used to be "one small forward step, at least 1 s ago". Two things satisfy that
// without a sound being made, and together they blipped the restored track at app start
// whenever the hub's cursor was our own last report rounded UP to the millisecond:
//   - a SEEK is a step too. The hub stores `Math.round(timestamp * 1000)` ms, the timestamp
//     store keeps the unrounded seconds, so adopting the session at launch seeks 168.129676 s
//     to 168.130 s: a +0.3 ms "advance";
//   - a paused engine reports nothing, so nothing ever ended that run: 1 s later it read as
//     rolling, and hardPause's PLAYING -> PAUSED store flip (meant for a runaway) started the
//     silent engine for the length of its fade-out.
// So a run counts only while the engine is still ticking, over more than one step, at a pace
// a real playhead keeps. "Still ticking" is measured against the run's OWN cadence: the
// engines report at very different rates (see PlayheadRun.steps), and one fixed silence
// limit either missed the whole-second engines entirely or let a paused web run linger.

export interface PlayheadRun {
    /** Wall-clock ms of the newest forward step. */
    lastAt: number;
    /** Playhead (s) after the newest step. */
    lastPos: number;
    /** Wall-clock ms of the step that began the run. */
    startedAt: number;
    /** Playhead (s) before the step that began the run. */
    startPos: number;
    /**
     * Forward steps in the run. A seek is one. The engines' cadence: web every 250 ms, mpv
     * every 500 ms; DLNA (500 ms poll) and jukebox (1 s poll) report whole seconds, so the
     * store moves about once a second.
     */
    steps: number;
}

/** A bigger forward step is a seek, not a tick. */
const MAX_STEP_SEC = 2;
/** The shortest silence any run survives - three web ticks. */
const MIN_GAP_MS = 750;
/** The longest - a whole-second engine's tick plus half of one more. */
const MAX_GAP_MS = 1500;
/** Half the slowest playback speed (0.5x): a run must cover real ground, not a rounding error. */
const MIN_PACE = 0.25;

/**
 * How long this run may go quiet and still count as ticking: twice its own average cadence,
 * kept between MIN_GAP_MS and MAX_GAP_MS. A lone step has no cadence yet and gets the most,
 * so a whole-second engine's second tick can join it.
 */
const allowedGapMs = (run: PlayheadRun): number => {
    if (run.steps < 2) return MAX_GAP_MS;
    const cadenceMs = (run.lastAt - run.startedAt) / (run.steps - 1);
    return Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, 2 * cadenceMs));
};

/** Has the playhead kept moving forward, tick after tick, for `minRunMs` - and is it still? */
export function isPlayheadRolling(run: null | PlayheadRun, now: number, minRunMs = 1000): boolean {
    if (!run || run.steps < 2) return false;
    if (now - run.lastAt > allowedGapMs(run)) return false;
    const elapsedMs = now - run.startedAt;
    if (elapsedMs < minRunMs) return false;
    return (run.lastPos - run.startPos) * 1000 >= elapsedMs * MIN_PACE;
}

/** Fold one timestamp-store change (prevSec -> sec, at wall-clock `now`) into the run. */
export function notePlayheadStep(
    run: null | PlayheadRun,
    prevSec: number,
    sec: number,
    now: number,
): null | PlayheadRun {
    const delta = sec - prevSec;
    // A jump (seek) or a step back (track change, rewind) ends the run.
    if (!(delta > 0 && delta < MAX_STEP_SEC)) return null;
    // So does a silence: a step long after the last one starts a run of its own.
    if (!run || now - run.lastAt > allowedGapMs(run)) {
        return { lastAt: now, lastPos: sec, startedAt: now, startPos: prevSec, steps: 1 };
    }
    return { ...run, lastAt: now, lastPos: sec, steps: run.steps + 1 };
}
