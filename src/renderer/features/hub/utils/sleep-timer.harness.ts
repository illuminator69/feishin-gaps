import assert from 'node:assert/strict';
import test from 'node:test';

import type { SessionSleepTimer, SleepTimerSession } from './sleep-timer.ts';

import {
    SLEEP_GUARD_GRACE_MS,
    SLEEP_MINUTES_MAX,
    sleepActMinutes,
    sleepGuardStep,
    sleepRemainingMs,
    sleepTimerFromFrame,
    sleepTimerOnDisconnect,
    sleepTimerSetElsewhere,
} from './sleep-timer.ts';

/**
 * I-034:  node --test src/renderer/features/hub/utils/sleep-timer.harness.ts
 *
 * The session's sleep timer on one client, replayed as the frames it receives (ms on this
 * client's clock). A `frame` is a `session` or `welcome.session` arriving with the timer as the
 * hub built it; `drop` is the hub link going. `held` is what the hub store keeps, which the
 * sleep-timer control shows and the guard in use-hub acts on.
 */

const ME = 'desk';
const PHONE = 'phone';
const MIN = 60_000;

interface Client {
    held: null | SessionSleepTimer;
    session: SleepTimerSession;
}

const client = (activeDeviceId: null | string = ME): Client => ({
    held: null,
    session: { activeDeviceId, myDeviceId: ME },
});

/** A frame stating the session: who it is on, and its timer (null: none). */
const frame = (
    c: Client,
    now: number,
    timer: null | { minutes?: number; remainingMs: number; setBy?: string },
    activeDeviceId: null | string = c.session.activeDeviceId,
) => {
    c.session = { ...c.session, activeDeviceId };
    c.held = sleepTimerFromFrame(timer, c.session, c.held, now);
    return c.held;
};

const drop = (c: Client) => {
    c.session = { ...c.session, activeDeviceId: null };
    c.held = sleepTimerOnDisconnect(c.held);
    return c.held;
};

// --- The deadline from a frame -----------------------------------------------------------------

test('a frame gives the end on this clock: when it arrived plus what was left', () => {
    const c = client();
    const timer = frame(c, 1_000_000, { minutes: 30, remainingMs: 30 * MIN, setBy: ME });
    assert.deepEqual(timer, {
        endsAt: 1_000_000 + 30 * MIN,
        guarded: true,
        minutes: 30,
        setBy: ME,
    });
});

test('a welcome in the middle of a timer picks it up where it is', () => {
    // Set to 30 min on the phone 12 minutes before this client connected.
    const c = client(PHONE);
    const timer = frame(c, 5000, { minutes: 30, remainingMs: 18 * MIN, setBy: PHONE });
    assert.equal(timer?.endsAt, 5000 + 18 * MIN);
    assert.equal(timer?.minutes, 30);
    assert.equal(sleepRemainingMs(timer!, 5000 + 3 * MIN), 15 * MIN);
});

test('no timer: null, absent from an older hub, or not readable', () => {
    const c = client();
    frame(c, 0, { minutes: 30, remainingMs: 30 * MIN });
    assert.equal(frame(c, 1000, null), null, 'the hub cleared it');
    const s = c.session;
    assert.equal(sleepTimerFromFrame(undefined, s, null, 0), null, 'an older hub has no such key');
    assert.equal(sleepTimerFromFrame('30', s, null, 0), null);
    assert.equal(sleepTimerFromFrame({ minutes: 30 }, s, null, 0), null, 'nothing to count from');
    assert.equal(sleepTimerFromFrame({ remainingMs: Number.NaN }, s, null, 0), null);
});

test('missing fields are filled with what can be said', () => {
    const timer = sleepTimerFromFrame({ remainingMs: 90_500 }, client().session, null, 0);
    assert.deepEqual(timer, { endsAt: 90_500, guarded: true, minutes: 2, setBy: null });
    const past = sleepTimerFromFrame({ remainingMs: -40 }, client().session, null, 700);
    assert.equal(past?.endsAt, 700, 'never an end before the frame');
});

// --- The remaining time shown ------------------------------------------------------------------

test('the control counts down on its own clock and stops at zero', () => {
    const c = client(PHONE);
    const timer = frame(c, 0, { minutes: 5, remainingMs: 5 * MIN, setBy: PHONE })!;
    assert.equal(sleepRemainingMs(timer, 0), 5 * MIN);
    assert.equal(sleepRemainingMs(timer, 61_000), 5 * MIN - 61_000);
    assert.equal(sleepRemainingMs(timer, 5 * MIN), 0);
    assert.equal(
        sleepRemainingMs(timer, 5 * MIN + 9000),
        0,
        'not negative while the frame is late',
    );
});

test('the same timer stated again does not move the countdown back up', () => {
    // Every skip and queue edit broadcasts `session`. The second frame took 400 ms on the wire
    // where the first took 100, so its end comes out 300 ms later for the same timer.
    const c = client();
    const first = frame(c, 100, { minutes: 30, remainingMs: 30 * MIN, setBy: ME });
    const second = frame(c, 60_400, { minutes: 30, remainingMs: 29 * MIN, setBy: ME });
    assert.equal(second, first, 'the same object: nothing to re-render or re-arm');
    assert.equal(second?.endsAt, 100 + 30 * MIN);
});

test('...and a frame that travelled faster moves the end earlier', () => {
    const c = client();
    frame(c, 400, { minutes: 30, remainingMs: 30 * MIN, setBy: ME });
    const second = frame(c, 60_100, { minutes: 30, remainingMs: 29 * MIN, setBy: ME });
    assert.equal(second?.endsAt, 100 + 30 * MIN);
});

test('a timer set again replaces the one held', () => {
    const c = client();
    frame(c, 0, { minutes: 30, remainingMs: 30 * MIN, setBy: ME });
    // Ten minutes in, the phone sets 30 again: the same minutes, a new end.
    const again = frame(c, 10 * MIN, { minutes: 30, remainingMs: 30 * MIN, setBy: PHONE });
    assert.equal(again?.endsAt, 40 * MIN);
    assert.equal(again?.setBy, PHONE);
    const shorter = frame(c, 11 * MIN, { minutes: 5, remainingMs: 5 * MIN, setBy: PHONE });
    assert.equal(shorter?.endsAt, 16 * MIN);
});

test('who set it: this device, another one, or not said', () => {
    const c = client();
    const mine = frame(c, 0, { minutes: 30, remainingMs: 30 * MIN, setBy: ME })!;
    assert.equal(sleepTimerSetElsewhere(mine, ME), false);
    const theirs = frame(c, 5 * MIN, { minutes: 60, remainingMs: 60 * MIN, setBy: PHONE })!;
    assert.equal(sleepTimerSetElsewhere(theirs, ME), true);
    const unsaid = sleepTimerFromFrame({ remainingMs: MIN }, c.session, null, 0)!;
    assert.equal(sleepTimerSetElsewhere(unsaid, ME), false, 'nothing is claimed');
});

// --- The guard ---------------------------------------------------------------------------------

test('the playing device waits until 5 s after the end, then pauses if still playing', () => {
    const c = client(ME);
    const timer = frame(c, 0, { minutes: 1, remainingMs: MIN, setBy: PHONE });
    assert.equal(sleepGuardStep(timer, 0, true), MIN + SLEEP_GUARD_GRACE_MS);
    assert.equal(sleepGuardStep(timer, MIN, true), SLEEP_GUARD_GRACE_MS, 'the hub is given 5 s');
    assert.equal(sleepGuardStep(timer, MIN + SLEEP_GUARD_GRACE_MS - 1, true), 1);
    assert.equal(sleepGuardStep(timer, MIN + SLEEP_GUARD_GRACE_MS, true), 'pause');
    // A machine that slept through the end wakes long after it: the same answer.
    assert.equal(sleepGuardStep(timer, 3 * 60 * MIN, true), 'pause');
});

test('with the link up the hub gets there first and the guard finds nothing', () => {
    const c = client(ME);
    frame(c, 0, { minutes: 1, remainingMs: MIN, setBy: ME });
    // At the end the hub sends do:pause, then a session frame without the timer.
    const cleared = frame(c, MIN + 120, null);
    assert.equal(sleepGuardStep(cleared, MIN + SLEEP_GUARD_GRACE_MS, false), null);
});

test('the link dropped: the timer is kept, counts on, and the device pauses itself', () => {
    const c = client(ME);
    frame(c, 0, { minutes: 30, remainingMs: 30 * MIN, setBy: ME });
    const kept = drop(c);
    assert.equal(kept?.endsAt, 30 * MIN, 'still held, for the control and for the guard');
    assert.equal(sleepRemainingMs(kept!, 20 * MIN), 10 * MIN);
    assert.equal(sleepGuardStep(kept, 30 * MIN + SLEEP_GUARD_GRACE_MS, true), 'pause');
});

test('nothing is paused that is not playing: the timer is just over', () => {
    const c = client(ME);
    const timer = frame(c, 0, { minutes: 1, remainingMs: MIN, setBy: ME });
    assert.equal(sleepGuardStep(timer, MIN + SLEEP_GUARD_GRACE_MS, false), 'drop');
});

test('a device that is not playing guards nothing, and forgets the timer with the link', () => {
    const c = client(PHONE);
    const timer = frame(c, 0, { minutes: 1, remainingMs: MIN, setBy: PHONE });
    assert.equal(timer?.guarded, false);
    assert.equal(sleepGuardStep(timer, MIN + SLEEP_GUARD_GRACE_MS, true), null);
    assert.equal(drop(c), null, 'it can no longer see that session');
});

test('a replaced timer is guarded at its own end, a cleared one not at all', () => {
    const c = client(ME);
    frame(c, 0, { minutes: 1, remainingMs: MIN, setBy: ME });
    const longer = frame(c, 30_000, { minutes: 10, remainingMs: 10 * MIN, setBy: PHONE });
    assert.equal(
        sleepGuardStep(longer, MIN + SLEEP_GUARD_GRACE_MS, true),
        30_000 + 10 * MIN - MIN,
        'the first end passes with nothing done',
    );
    assert.equal(sleepGuardStep(frame(c, 40_000, null), 11 * MIN, true), null);
});

test('the session moving to another device hands the guard over', () => {
    // A transfer broadcasts `session`: the new device arms from that frame, this one stands down.
    const c = client(ME);
    frame(c, 0, { minutes: 30, remainingMs: 30 * MIN, setBy: ME });
    const moved = frame(c, MIN, { minutes: 30, remainingMs: 29 * MIN, setBy: ME }, PHONE);
    assert.equal(moved?.guarded, false);
    assert.equal(moved?.endsAt, 30 * MIN, 'still shown, with the same end');
    const back = frame(c, 2 * MIN, { minutes: 30, remainingMs: 28 * MIN, setBy: ME }, ME);
    assert.equal(back?.guarded, true);
});

test('back from a dropped link, still playing: the guard holds until the session is claimed', () => {
    const c = client(ME);
    frame(c, 0, { minutes: 30, remainingMs: 30 * MIN, setBy: ME });
    drop(c);
    // The hub let go of the slot when the socket went, so `welcome` names no active device.
    const welcome = frame(c, 5 * MIN, { minutes: 30, remainingMs: 25 * MIN, setBy: ME }, null);
    assert.equal(welcome?.guarded, true);
    // A device that was only ever watching gets no guard out of the same frame.
    const watcher = client(PHONE);
    drop(watcher);
    const seen = frame(watcher, 5 * MIN, { minutes: 30, remainingMs: 25 * MIN, setBy: ME }, null);
    assert.equal(seen?.guarded, false);
});

// --- What is asked of the hub ------------------------------------------------------------------

test('the custom entry asks for whole minutes, from one up to the most the hub takes', () => {
    assert.equal(sleepActMinutes(20 * 60), 20);
    assert.equal(sleepActMinutes(90), 2, 'to the nearest minute');
    assert.equal(sleepActMinutes(20), 1, 'never none for a duration that was entered');
    assert.equal(sleepActMinutes(0), null);
    assert.equal(sleepActMinutes(-60), null);
    assert.equal(sleepActMinutes(Number.NaN), null);
    assert.equal(sleepActMinutes(30 * 3600), SLEEP_MINUTES_MAX);
});
