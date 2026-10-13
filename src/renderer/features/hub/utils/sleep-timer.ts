// navi-connect (I-034, B-113): the session's one sleep timer, as this client holds it. Pure, so
// the arithmetic can be tested without React, the hub store or a clock (sleep-timer.harness.ts).
//
// A sleep timer used to belong to the app it was set in, and counted down only while that app's
// own player was playing: set on the desktop while the phone played, it never ran, and no other
// device showed it. A hub that lists `sleepTimer` in `welcome.features` holds one timer for the
// session: `act:sleepTimer {minutes}` sets it (0 clears it), the hub pauses the session when it
// runs out, and every `session` frame (and `welcome.session`) states it as
// `sleepTimer: null | { remainingMs, minutes, setBy }`.
//
// Nothing is broadcast while it counts down. `remainingMs` is what was left when the hub BUILT
// the frame, so this client turns it into an end on its own clock when the frame arrives and
// counts down from that (sleepTimerFromFrame, sleepRemainingMs). That end is late by the
// frame's time on the wire, so of two frames stating the same timer the earlier end is kept.
//
// The device that is playing also guards the timer itself (sleepGuardStep): the hub's pause
// cannot reach a device whose link has dropped, and that device would play all night. While it
// is the session's device it pauses its own player 5 s after the end, if it is still playing
// and no frame has cleared or replaced the timer by then. With the link up the hub's pause and
// the frame that clears the timer both arrive inside those 5 s, and the guard finds nothing
// left to do.

/** How long after the timer's end the playing device waits for the hub before pausing itself. */
export const SLEEP_GUARD_GRACE_MS = 5000;

/** The longest timer the hub takes (PROTOCOL: 1..1440 minutes). */
export const SLEEP_MINUTES_MAX = 1440;

/** Two frames whose ends differ by less than this state the same timer, not a new one. */
const SAME_TIMER_MS = 2000;

/** The session's sleep timer as the hub last stated it, on this client's clock. */
export interface SessionSleepTimer {
    /** Wall-clock ms, here, at which the hub pauses the session. */
    endsAt: number;
    /**
     * This device was the session's device when the timer was last stated, so it pauses itself
     * if the hub's pause does not come - see sleepGuardStep.
     */
    guarded: boolean;
    /** What it was set to. */
    minutes: number;
    /** The id of the device it was set on; null when the hub did not say. */
    setBy: null | string;
}

/** Who the session is on and who this is, at the frame that states the timer. */
export interface SleepTimerSession {
    activeDeviceId: null | string;
    myDeviceId: null | string;
}

/**
 * The minutes to ask the hub for, from a duration in seconds (the custom entry): to the nearest
 * minute, never less than one, never more than the hub takes. Null for no duration at all.
 */
export function sleepActMinutes(totalSeconds: number): null | number {
    if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return null;
    return Math.min(SLEEP_MINUTES_MAX, Math.max(1, Math.round(totalSeconds / 60)));
}

/**
 * What the guard does about `timer` at `now`: nothing (null - there is no timer, or it is not
 * this device's to guard), wait that many ms and ask again, `'pause'` (its end is 5 s past, no
 * frame has cleared or replaced it and this device is still playing), or `'drop'` (the same,
 * but nothing is playing here: the timer is over and there is nothing to stop).
 */
export function sleepGuardStep(
    timer: null | SessionSleepTimer,
    now: number,
    isPlaying: boolean,
): 'drop' | 'pause' | null | number {
    if (timer === null || !timer.guarded) return null;
    const wait = timer.endsAt + SLEEP_GUARD_GRACE_MS - now;
    if (wait > 0) return wait;
    return isPlaying ? 'pause' : 'drop';
}

/** Ms left on the timer at `now`, counted on this client's clock; 0 once its end has passed. */
export function sleepRemainingMs(timer: SessionSleepTimer, now: number): number {
    return Math.max(0, timer.endsAt - now);
}

/**
 * The timer after a frame that states the session (`session`, `welcome.session`), which arrived
 * at `now`. `raw` is the frame's `sleepTimer`; null, absent (an older hub) or unreadable means
 * there is none. `previous` is what was held before the frame.
 *
 * Guarded when the frame puts the session on this device. When it puts it on NO device, a guard
 * already held stays: the hub lets go of the slot when the playing device's link drops, so that
 * is what this device is told when it comes back, still playing, and before it has claimed the
 * session again. On another device the guard is that device's.
 */
export function sleepTimerFromFrame(
    raw: unknown,
    session: SleepTimerSession,
    previous: null | SessionSleepTimer,
    now: number,
): null | SessionSleepTimer {
    if (typeof raw !== 'object' || raw === null) return null;
    const frame = raw as { minutes?: unknown; remainingMs?: unknown; setBy?: unknown };
    if (typeof frame.remainingMs !== 'number' || !Number.isFinite(frame.remainingMs)) return null;
    const remainingMs = Math.max(0, frame.remainingMs);
    const minutes =
        typeof frame.minutes === 'number' && Number.isFinite(frame.minutes)
            ? frame.minutes
            : Math.ceil(remainingMs / 60_000);
    const setBy = typeof frame.setBy === 'string' ? frame.setBy : null;
    const mine = session.myDeviceId !== null && session.activeDeviceId === session.myDeviceId;
    const guarded = mine || (session.activeDeviceId === null && previous?.guarded === true);

    let endsAt = now + remainingMs;
    if (
        previous !== null &&
        previous.minutes === minutes &&
        previous.setBy === setBy &&
        Math.abs(previous.endsAt - endsAt) < SAME_TIMER_MS
    ) {
        // The same timer, stated again. Each frame's end is late by its own time on the wire,
        // so the earlier of the two is the better one, and the countdown never steps back up.
        endsAt = Math.min(previous.endsAt, endsAt);
        if (endsAt === previous.endsAt && guarded === previous.guarded) return previous;
    }
    return { endsAt, guarded, minutes, setBy };
}

/**
 * The timer once the hub link is lost. A guarded one stays, and goes on counting: this device
 * was playing, will pause itself at the end, and its control must keep saying so. Any other is
 * about a session this client can no longer see.
 */
export function sleepTimerOnDisconnect(
    previous: null | SessionSleepTimer,
): null | SessionSleepTimer {
    return previous !== null && previous.guarded ? previous : null;
}

/** Was the timer set on a device other than this one, as far as the hub said? */
export function sleepTimerSetElsewhere(
    timer: SessionSleepTimer,
    myDeviceId: null | string,
): boolean {
    return timer.setBy !== null && timer.setBy !== myDeviceId;
}
