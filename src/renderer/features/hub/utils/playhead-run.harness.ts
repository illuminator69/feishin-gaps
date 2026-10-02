import assert from 'node:assert/strict';
import test from 'node:test';

import type { PlayheadRun } from './playhead-run.ts';

import { isPlayheadRolling, notePlayheadStep } from './playhead-run.ts';

/**
 * B-053:  node --test src/renderer/features/hub/utils/playhead-run.harness.ts
 *
 * Each case replays what the timestamp store reports to use-hub's onPlayerProgress
 * (prev -> next, at a wall-clock ms) and asks the question the watchdogs ask.
 */

type Tick = [atMs: number, sec: number];

/** Feed a timeline of timestamp-store values through the run tracker. */
const replay = (startSec: number, ticks: Tick[]): null | PlayheadRun => {
    let run: null | PlayheadRun = null;
    let prev = startSec;
    for (const [at, sec] of ticks) {
        if (sec === prev) continue; // the store's equalityFn: no event for an unchanged value
        run = notePlayheadStep(run, prev, sec, at);
        prev = sec;
    }
    return run;
};

/** Real playback: the engine reports every `everyMs`, advancing `speed`× wall time. */
const playing = (fromSec: number, startAt: number, untilAt: number, everyMs: number, speed = 1) => {
    const ticks: Tick[] = [];
    for (let at = startAt + everyMs; at <= untilAt; at += everyMs) {
        ticks.push([at, fromSec + ((at - startAt) / 1000) * speed]);
    }
    return ticks;
};

// --- The incident (2026-10-02 20:22:31Z) -------------------------------------------------

test('B-053: the adopt seek to the hub cursor (ms-rounded UP) is not playback', () => {
    // The previous run paused at 168129.676 ms; the timestamp store persisted 168.129676 s,
    // but the hub holds Math.round() of it - 168130 ms. Adopting seeks to 168.13 s: a
    // +0.324 ms "step". Nothing ticks afterwards (the engine is paused), and the armed-seek
    // re-check runs 150 + 1200 ms after the song change, i.e. ~1250 ms after the step.
    const run = replay(0, [
        [0, 168.129676], // timestamp store rehydrates (×1000 = 168129.67599999998): a jump, no run
        [900, 168.13], // QUEUE_RESTORED (+100 ms after setQueue at 800) -> setTimestamp(168.13)
        [950, 168.13], // pendingSeek's mediaSeekToTimestamp(168.13): unchanged, no event
    ]);
    assert.equal(isPlayheadRolling(run, 800 + 400), false, 'adopt 400 ms re-check');
    assert.equal(isPlayheadRolling(run, 800 + 150 + 1200), false, 'armed-seek 1200 ms re-check');
    // ...and it must stay false however late a busy renderer runs that timer.
    assert.equal(isPlayheadRolling(run, 900 + 5000), false, 'late timer');
});

test('B-053: ms-rounded DOWN is a step back - no run at all (why it is ~50/50 per restart)', () => {
    const run = replay(0, [
        [0, 68.9014],
        [900, 68.901],
    ]);
    assert.equal(run, null);
});

test('two sub-ms restore seeks a second apart are still not playback', () => {
    const run = replay(0, [
        [0, 168.1296],
        [900, 168.12967],
        [1900, 168.13],
    ]);
    assert.equal(isPlayheadRolling(run, 2000), false);
});

test('a run whose engine went quiet (paused) stops counting', () => {
    const run = replay(100, playing(100, 0, 5000, 250));
    assert.equal(isPlayheadRolling(run, 5000), true, 'while ticking');
    assert.equal(isPlayheadRolling(run, 6500), false, '1.5 s after the last tick');
});

test('a stale seek step does not head a later run of real ticks', () => {
    // Restore seek at 0, user presses play at 5000: the run is the playback's own.
    const run = replay(168.1296, [[0, 168.13], ...playing(168.13, 5000, 5750, 250)]);
    assert.equal(isPlayheadRolling(run, 5750), false, 'only 500 ms of real ticks');
    const later = replay(168.1296, [[0, 168.13], ...playing(168.13, 5000, 6250, 250)]);
    assert.equal(isPlayheadRolling(later, 6250), true, 'a full second of real ticks');
});

// --- Load acknowledgement (awaitLoadOutcome, 600 ms proof) -------------------------------

test('load ack: a lone forward seek is not proof that the engine started', () => {
    const run = replay(100, [[0, 101.5]]);
    assert.equal(isPlayheadRolling(run, 650, 600), false);
});

test('load ack: real playback proves itself within 600 ms of ticking', () => {
    const run = replay(42, playing(42, 0, 750, 250));
    assert.equal(isPlayheadRolling(run, 850, 600), true);
});

// --- Real playback must still read as rolling (no regression for the watchdogs) ----------

test('web engine (250 ms progress) is rolling after 1 s, checked at a tick', () => {
    const run = replay(10, playing(10, 0, 1250, 250));
    assert.equal(isPlayheadRolling(run, 1250), true);
});

test('mpv (500 ms poll) is rolling after 1 s, checked at a tick', () => {
    const run = replay(10, playing(10, 0, 1500, 500));
    assert.equal(isPlayheadRolling(run, 1500), true);
});

test('a timer check between ticks of real playback still reads rolling', () => {
    const run = replay(10, playing(10, 0, 1500, 500));
    assert.equal(isPlayheadRolling(run, 1500 + 450), true);
});

test('half-speed playback (the slowest setting) still reads rolling', () => {
    const run = replay(10, playing(10, 0, 1250, 250, 0.5));
    assert.equal(isPlayheadRolling(run, 1250), true);
});

test('under 1 s of real playback is not yet rolling', () => {
    const run = replay(10, playing(10, 0, 750, 250));
    assert.equal(isPlayheadRolling(run, 750), false);
});

test('a seek (jump of 2 s or more) breaks the run', () => {
    const run = replay(10, [...playing(10, 0, 2000, 250), [2100, 60]]);
    assert.equal(run, null);
});

test('a step back (track change to 0) breaks the run', () => {
    const run = replay(10, [...playing(10, 0, 2000, 250), [2100, 0]]);
    assert.equal(run, null);
});

test('playback resumed after a break needs its own full second', () => {
    const run = replay(10, [
        ...playing(10, 0, 2000, 250),
        [2100, 0],
        ...playing(0, 2100, 2850, 250),
    ]);
    assert.equal(isPlayheadRolling(run, 2850), false);
    const later = replay(10, [
        ...playing(10, 0, 2000, 250),
        [2100, 0],
        ...playing(0, 2100, 3350, 250),
    ]);
    assert.equal(isPlayheadRolling(later, 3350), true);
});
