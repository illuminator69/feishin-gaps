import assert from 'node:assert/strict';
import test from 'node:test';

import type { LevelReport } from './level-report.ts';

import { LEVEL_REPORT_MIN_MS, levelReportStep, NO_LEVEL_REPORT, toLevel } from './level-report.ts';

/**
 * I-033:  node --test src/shared/utils/level-report.harness.ts
 *
 * A device's volume over time, replayed as its sender sees it (use-hub for this machine, the
 * cast bridge for a speaker). `change` is the level moving; the sender asks levelReportStep,
 * sends or sets one timer, and asks again with the level as it is when that timer fires. A
 * change marked `told` is a `do:setVolume` being applied. `sent` lists what reached the hub
 * and when.
 */

interface Sender {
    last: LevelReport;
    level: number;
    sent: Array<{ at: number; level: number }>;
    /** Wall-clock ms the hub last told this device a level; null if it has not. */
    toldAt: null | number;
    /** Wall-clock ms the one pending timer fires; null without one. */
    wakeAt: null | number;
}

const sender = (level: number): Sender => ({
    last: NO_LEVEL_REPORT,
    level,
    sent: [],
    toldAt: null,
    wakeAt: null,
});

/** The sender's whole routine: on `welcome`, on a change, and when its timer fires. */
const ask = (s: Sender, now: number) => {
    s.wakeAt = null;
    const step = levelReportStep(s.last, s.level, now, s.toldAt);
    if (step === 'send') {
        s.last = { at: now, level: s.level };
        s.sent.push({ at: now, level: s.level });
    } else if (step !== null) {
        s.wakeAt = now + step;
    }
};

/** Play `changes` in order, firing the timer whenever it comes due first; then let it run out. */
const replay = (s: Sender, changes: Array<{ at: number; level: number; told?: boolean }>) => {
    for (const change of changes) {
        while (s.wakeAt !== null && s.wakeAt < change.at) ask(s, s.wakeAt);
        if (change.told) s.toldAt = change.at;
        s.level = change.level;
        ask(s, change.at);
    }
    while (s.wakeAt !== null) ask(s, s.wakeAt);
    return s.sent;
};

test('the level is sent on connect, whatever it is', () => {
    const s = sender(30);
    ask(s, 1000);
    assert.deepEqual(s.sent, [{ at: 1000, level: 30 }]);
    // ...and again after a reconnect, though it has not changed: the hub may have been told
    // another level meanwhile, or restarted from an older state file.
    s.last = NO_LEVEL_REPORT;
    ask(s, 5000);
    assert.deepEqual(s.sent[1], { at: 5000, level: 30 });
});

test('a change is sent at once when the last report is old enough', () => {
    const s = sender(30);
    ask(s, 0);
    assert.deepEqual(replay(s, [{ at: 4000, level: 45 }]).at(-1), { at: 4000, level: 45 });
});

test('a dragged slider sends at most four a second and always the level it ends on', () => {
    // 30 -> 60, one step every 20 ms for 600 ms, as the local slider writes the store.
    const s = sender(30);
    ask(s, 0);
    const drag = Array.from({ length: 30 }, (_, n) => ({ at: 20 * (n + 1), level: 31 + n }));
    const sent = replay(s, drag);
    assert.deepEqual(sent, [
        { at: 0, level: 30 },
        { at: 250, level: 42 },
        { at: 500, level: 55 },
        { at: 750, level: 60 },
    ]);
    for (let n = 1; n < sent.length; n += 1) {
        assert.ok(sent[n].at - sent[n - 1].at >= LEVEL_REPORT_MIN_MS);
    }
});

test('a level that went back to the one last sent is not sent again', () => {
    const s = sender(30);
    ask(s, 0);
    const sent = replay(s, [
        { at: 100, level: 35 },
        { at: 180, level: 30 },
    ]);
    assert.deepEqual(sent, [{ at: 0, level: 30 }], 'the hub already holds 30');
    assert.equal(s.wakeAt, null, 'and nothing is left waiting');
});

test('a level the device was told is reported, once the telling has stopped', () => {
    // The hub told this device 37; a phone with 15 steps lands on 36 and says so.
    const s = sender(80);
    ask(s, 0);
    const sent = replay(s, [{ at: 3000, level: 36, told: true }]);
    assert.deepEqual(sent.at(-1), { at: 3000 + LEVEL_REPORT_MIN_MS, level: 36 });
});

test('a slider dragged on another device ends in one report, of the level it stopped on', () => {
    // The bar's slider elsewhere sends a level every 100 ms: 40, 45, 50. Sent at once, the
    // report of 40 would reach the hub after it had told 50, and the hub would put the row back
    // to 40 for every picker until the report of 50 arrived.
    const s = sender(30);
    ask(s, 0);
    const sent = replay(s, [
        { at: 600, level: 40, told: true },
        { at: 700, level: 45, told: true },
        { at: 800, level: 50, told: true },
    ]);
    assert.deepEqual(sent, [
        { at: 0, level: 30 },
        { at: 800 + LEVEL_REPORT_MIN_MS, level: 50 },
    ]);
});

test('told the level it is already at, a device has nothing to report', () => {
    const s = sender(30);
    ask(s, 0);
    assert.deepEqual(replay(s, [{ at: 600, level: 30, told: true }]), [{ at: 0, level: 30 }]);
    assert.equal(s.wakeAt, null);
});

test('a change made at the device itself does not wait for a telling long past', () => {
    const s = sender(30);
    ask(s, 0);
    const sent = replay(s, [
        { at: 600, level: 40, told: true },
        { at: 5000, level: 55 },
    ]);
    assert.deepEqual(sent.slice(1), [
        { at: 600 + LEVEL_REPORT_MIN_MS, level: 40 },
        { at: 5000, level: 55 },
    ]);
});

test('a clock set back does not hold a report', () => {
    const last: LevelReport = { at: 10_000, level: 30 };
    assert.equal(levelReportStep(last, 40, 9000), 'send');
    assert.equal(levelReportStep(last, 40, 10_100), 150);
    assert.equal(levelReportStep(last, 40, 10_250), 'send');
    assert.equal(levelReportStep(last, 30, 99_000), null);
    assert.equal(levelReportStep(last, 40, 20_000, 20_500), 'send', 'told "in the future"');
    assert.equal(levelReportStep(last, 40, 20_000, 19_900), 150);
});

test('a level on the wire is an integer 0..100', () => {
    assert.equal(toLevel(36.5), 37);
    assert.equal(toLevel(-3), 0);
    assert.equal(toLevel(140), 100);
    assert.equal(toLevel(Number.NaN), 0);
    assert.equal(toLevel(undefined), 0);
    assert.equal(toLevel('40'), 0, 'not a number: nothing is guessed');
});
