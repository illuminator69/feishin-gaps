import assert from 'node:assert/strict';
import test from 'node:test';

import type { PlayheadRun } from './playhead-run.ts';

import { isPlayheadRolling, notePlayerStatus, notePlayheadStep } from './playhead-run.ts';

/**
 * B-053, Q-051:  node --test src/renderer/features/hub/utils/playhead-run.harness.ts
 *
 * Each case replays what the timestamp store reports to use-hub's onPlayerProgress
 * (prev -> next, at a wall-clock ms) and asks the question the watchdogs ask. A write is an
 * engine tick unless tagged 'seek' (timestamp.store's isTimestampSeek()).
 */

type Tick = [atMs: number, sec: number, kind?: 'seek'];

/** A write that moves the playhead (slider, lyric line, hub do:seek, a restored position). */
const seek = (atMs: number, sec: number): Tick => [atMs, sec, 'seek'];

/** Feed a timeline of timestamp-store values through the run tracker. */
const replay = (startSec: number, ticks: Tick[]): null | PlayheadRun => {
    let run: null | PlayheadRun = null;
    let prev = startSec;
    for (const [at, sec, kind] of ticks) {
        if (sec === prev) continue; // the store's equalityFn: no event for an unchanged value
        run = notePlayheadStep(run, prev, sec, at, kind === 'seek');
        prev = sec;
    }
    return run;
};

/**
 * use-hub's last-net watchdog, `!playing.current && rolling` -> hardPause('store paused,
 * progress watchdog'), evaluated on every progress event of a player whose store reads
 * PAUSED throughout. Returns the ms of the first event it fires on, or null.
 */
const pausedWatchdogFiresAt = (startSec: number, ticks: Tick[]): null | number => {
    let run: null | PlayheadRun = null;
    let prev = startSec;
    for (const [at, sec, kind] of ticks) {
        if (sec === prev) continue;
        run = notePlayheadStep(run, prev, sec, at, kind === 'seek');
        prev = sec;
        if (isPlayheadRolling(run, at)) return at;
    }
    return null;
};

/** The player store's status changing (use-hub's onPlayerStatus). */
type Status = [atMs: number, status: 'paused' | 'playing'];

const isStatus = (event: Status | Tick): event is Status => typeof event[1] === 'string';

/**
 * use-hub's two handlers over a timeline of timestamp writes and store status changes. Every
 * progress event of a store that does not read PLAYING asks the last-net watchdog; when it
 * fires, hardPause acts at most once per 2 s, and against a paused store it flips the status
 * PLAYING -> PAUSED, which the status handler sees too. Returns the ms hardPause acted at.
 */
const simulate = (startSec: number, playingAtStart: boolean, events: Array<Status | Tick>) => {
    let run: null | PlayheadRun = null;
    let prev = startSec;
    let isPlaying = playingAtStart;
    let lastHardPauseAt = -Infinity;
    const hardPauses: number[] = [];
    for (const event of events) {
        if (isStatus(event)) {
            const next = event[1] === 'playing';
            if (next !== isPlaying) run = notePlayerStatus(run, isPlaying, next);
            isPlaying = next;
            continue;
        }
        const [at, sec, kind] = event;
        if (sec === prev) continue;
        run = notePlayheadStep(run, prev, sec, at, kind === 'seek');
        prev = sec;
        if (!isPlaying && isPlayheadRolling(run, at) && at - lastHardPauseAt >= 2000) {
            lastHardPauseAt = at;
            hardPauses.push(at);
            run = notePlayerStatus(run, false, true); // mediaPlay()
            run = notePlayerStatus(run, true, false); // mediaPause()
        }
    }
    return hardPauses;
};

/** Real playback: the engine reports every `everyMs`, advancing `speed`× wall time. */
const playing = (fromSec: number, startAt: number, untilAt: number, everyMs: number, speed = 1) => {
    const ticks: Tick[] = [];
    for (let at = startAt + everyMs; at <= untilAt; at += everyMs) {
        ticks.push([at, fromSec + ((at - startAt) / 1000) * speed]);
    }
    return ticks;
};

/**
 * A whole-second engine: polled every `pollMs`, the reply lands `latencyMs` later and is
 * floored to whole seconds (DLNA: 500 ms poll + Math.floor; jukebox: 1000 ms poll).
 */
const wholeSeconds = (
    fromSec: number,
    untilAt: number,
    pollMs: number,
    latencyMs: number,
    startAt = 0,
) => {
    const ticks: Tick[] = [];
    for (let at = startAt + pollMs; at <= untilAt; at += pollMs) {
        ticks.push([at + latencyMs, Math.floor(fromSec + (at - startAt) / 1000)]);
    }
    return ticks;
};

/** awaitLoadOutcome's loop: the first 100 ms poll at which the run proves playback, or null. */
const firstRollingAt = (startSec: number, ticks: Tick[], minRunMs: number, untilMs: number) => {
    let run: null | PlayheadRun = null;
    let prev = startSec;
    let i = 0;
    for (let now = 0; now <= untilMs; now += 100) {
        while (i < ticks.length && ticks[i][0] <= now) {
            const [at, sec, kind] = ticks[i++];
            if (sec !== prev) {
                run = notePlayheadStep(run, prev, sec, at, kind === 'seek');
                prev = sec;
            }
        }
        if (isPlayheadRolling(run, now, minRunMs)) return now;
    }
    return null;
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

test("a trailing tick just after a pause counts at that tick (the caller's problem), then lapses", () => {
    // The clock cannot tell a last in-flight poll from a live tick; it only stops counting once
    // the ticks stop. (So use-hub also ends the run when the store leaves PLAYING - Q-051.)
    const run = replay(10, [...playing(10, 0, 5000, 250), [5100, 15.1]]);
    assert.equal(isPlayheadRolling(run, 5100), true, 'at the trailing tick');
    assert.equal(isPlayheadRolling(run, 5100 + 800), false, 'a web cadence later');
});

test('pausing, then nudging the playhead a second forward, is not playback', () => {
    // Paused at 5000 after real playback; a +1 s seek at 6000 must start its own run.
    const run = replay(10, [...playing(10, 0, 5000, 250), [6000, 16]]);
    assert.equal(isPlayheadRolling(run, 6000), false);
});

// --- Whole-second engines (DLNA, jukebox): the store moves about once a second ------------

test('DLNA (500 ms poll, floored) acks a load well inside the budget', () => {
    const at = firstRollingAt(42, wholeSeconds(42, 9000, 500, 40), 600, 8500);
    assert.notEqual(at, null, 'never acked: the hub would roll the transfer back');
    assert.ok(at! <= 2500, `acked at ${at} ms`);
});

test('DLNA reads rolling for the watchdog, at a tick and between ticks', () => {
    const ticks = wholeSeconds(42, 3000, 500, 40);
    const run = replay(42, ticks);
    const lastAt = ticks[ticks.length - 1][0];
    assert.equal(isPlayheadRolling(run, lastAt), true, 'at a tick');
    assert.equal(isPlayheadRolling(run, lastAt + 900), true, 'between ticks');
});

test('jukebox (1 s poll, whole seconds) acks a load and reads rolling for the watchdog', () => {
    const ticks = wholeSeconds(42, 9000, 1000, 60);
    const at = firstRollingAt(42, ticks, 600, 8500);
    assert.notEqual(at, null, 'never acked: the hub would roll the transfer back');
    assert.ok(at! <= 2500, `acked at ${at} ms`);
    const run = replay(42, wholeSeconds(42, 3000, 1000, 60));
    assert.equal(isPlayheadRolling(run, 3060), true, 'at a tick');
    assert.equal(isPlayheadRolling(run, 3060 + 900), true, 'between ticks');
});

test('mpv: a poll that lands late (busy renderer) does not break the run', () => {
    // 500 ms polls, then one 400 ms late: a 900 ms gap.
    const run = replay(10, [...playing(10, 0, 2000, 500), [2900, 12.9]]);
    assert.equal(isPlayheadRolling(run, 2900), true);
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

// --- Q-051: a seek is never a tick --------------------------------------------------------
//
// Only the engine's own position reports are ticks. The seek writers (the store's
// mediaSeekToTimestamp / mediaSkipBackward / mediaSkipForward, and the restored queue's
// position) mark their write, so a seek is never a step: it ends the run, and only the
// ticks after it can build the next one.

test('Q-051: two forward nudges on a paused player, 1.0-1.5 s apart, are not playback', () => {
    // ArrowRight on the focused seek bar (+1 s each, playerbar-seek-slider onChangeEnd),
    // or a click on the bar / waveform / a lyric line < 2 s ahead.
    for (const [gapMs, stepSec] of [
        [1000, 1],
        [1250, 1],
        [1500, 1],
        [1200, 0.4],
        [1200, 1.9],
    ]) {
        const ticks = [seek(0, 30 + stepSec), seek(gapMs, 30 + 2 * stepSec)];
        const label = `+${stepSec} s twice, ${gapMs} ms apart`;
        assert.equal(isPlayheadRolling(replay(30, ticks), gapMs), false, label);
        assert.equal(pausedWatchdogFiresAt(30, ticks), null, `watchdog: ${label}`);
    }
});

test('Q-051: ArrowRight on the focused seek bar while paused - tapped or held - is not playback', () => {
    const tapped = Array.from({ length: 6 }, (_, n) => seek(n * 1000, 31 + n));
    assert.equal(pausedWatchdogFiresAt(30, tapped), null, 'tapped about once a second');
    // Held: one seek on the press, then the OS key repeat (500 ms delay, ~30 Hz).
    const held = [seek(0, 31), ...Array.from({ length: 60 }, (_, n) => seek(500 + n * 33, 32 + n))];
    assert.equal(pausedWatchdogFiresAt(30, held), null, 'held');
});

test('Q-051: a seek during playback ends the run; the ticks after it read rolling a second later', () => {
    // Web engine playing; at 3100 a lyric line 1.1 s ahead is clicked.
    const ticks = [
        ...playing(10, 0, 3000, 250),
        seek(3100, 14.1),
        ...playing(14.1, 3100, 4600, 250),
    ];
    const upTo = (atMs: number) =>
        replay(
            10,
            ticks.filter(([at]) => at <= atMs),
        );
    assert.equal(isPlayheadRolling(upTo(3000), 3000), true, 'before the seek');
    assert.equal(upTo(3100), null, 'the seek ends the run');
    assert.equal(isPlayheadRolling(upTo(3350), 3350), false, 'one tick after it');
    assert.equal(isPlayheadRolling(upTo(4100), 4100), false, '750 ms of ticks after it');
    assert.equal(isPlayheadRolling(upTo(4350), 4350), true, 'a full second of ticks after it');
});

test('Q-051: an mpv poll in flight across a seek cannot head the new run', () => {
    // Playing at 52 s; the user seeks 1 s forward, then a poll issued before the seek lands
    // with the old position (a step back), then the polls from the new position.
    const ticks = [
        ...playing(50, 0, 2000, 500),
        seek(2100, 53),
        [2150, 52.15] as Tick,
        ...playing(53, 2100, 3600, 500),
    ];
    const upTo = (atMs: number) =>
        replay(
            50,
            ticks.filter(([at]) => at <= atMs),
        );
    assert.equal(isPlayheadRolling(upTo(2150), 2150), false, 'the stale poll');
    assert.equal(isPlayheadRolling(upTo(3100), 3100), false, '500 ms of new polls');
    assert.equal(isPlayheadRolling(upTo(3600), 3600), true, 'a second of new polls');
});

test('Q-051 + B-053: the restored position is a seek - the incident never even starts a run', () => {
    const run = replay(0, [
        [0, 168.129676], // the timestamp store rehydrates: not an engine tick, but a jump
        seek(900, 168.13), // QUEUE_RESTORED -> use-queue-restore's setTimestamp(..., seek)
        seek(950, 168.13), // pendingSeek's mediaSeekToTimestamp(168.13): unchanged, no event
    ]);
    assert.equal(run, null);
    assert.equal(isPlayheadRolling(run, 800 + 150 + 1200), false, 'armed-seek 1200 ms re-check');
});

test('Q-051: a hub do:load positions with a seek, and the ticks after it ack the load promptly', () => {
    // The load's position lands as a seek 100 ms in (QUEUE_RESTORED; or mediaSeekToTimestamp
    // on the same-queue path, sub-ms ahead of where a paused player sat), then the engine
    // ticks from there. The ack (awaitLoadOutcome, 600 ms proof) must not wait on the seek.
    const target = 42.456;
    const engines: Array<[name: string, ticks: Tick[], withinMs: number]> = [
        ['web', playing(target, 100, 9000, 250), 1000],
        ['mpv', playing(target, 100, 9000, 500), 1600],
        ['DLNA', wholeSeconds(target, 9000, 500, 40, 100), 2600],
        ['jukebox', wholeSeconds(target, 9000, 1000, 60, 100), 2600],
    ];
    for (const fromSec of [200, target - 0.0004]) {
        for (const [name, ticks, withinMs] of engines) {
            const at = firstRollingAt(fromSec, [seek(100, target), ...ticks], 600, 8500);
            const label = `${name}, from ${fromSec} s`;
            assert.notEqual(at, null, `${label}: never acked - the hub would roll back`);
            assert.ok(at! - 100 <= withinMs, `${label}: acked ${at! - 100} ms after the seek`);
        }
    }
});

// --- Q-051: a run never outlives the store leaving PLAYING ---------------------------------
//
// A tick already on its way when the user pauses (an mpv or jukebox poll in flight, a DLNA
// renderer that obeys the pause a few hundred ms later) used to extend the run, and the
// paused store then read as a runaway. use-hub now ends the run on PLAYING -> anything else.

test('Q-051: an mpv poll in flight when the user pauses does not extend the run', () => {
    // Polls every 500 ms while PLAYING; the one issued at 5000 resolves after the pause.
    const events = [
        ...playing(10, 0, 4500, 500),
        [5020, 'paused'] as Status,
        [5060, 15.06] as Tick,
    ];
    assert.deepEqual(simulate(10, true, events), []);
});

test('Q-051: DLNA - positions that land just after a pause do not extend the run', () => {
    // The renderer obeys the pause ~600 ms late: the poll crossing the next whole second lands.
    const ticks = wholeSeconds(42, 9000, 500, 40); // events at 1040, 2040, 3040, ...
    const events = [
        ...ticks.filter(([at]) => at < 3500),
        [3500, 'paused'] as Status,
        [4040, 46] as Tick,
        seek(4600, 47), // and a forward nudge within 1.5 s of the pause (a seek: ends it too)
    ];
    assert.deepEqual(simulate(42, true, events), []);
});

test('Q-051: a DLNA runaway under a paused store is still caught after the reset, within ~2 s', () => {
    // The store left PLAYING but the renderer never stopped. DLNA writes positions whatever the
    // store says, so the run rebuilds from its next two ticks - and hardPause's own flip (which
    // leaves PLAYING too) does not hide a renderer that ignores it: it is caught again 2 s on.
    const ticks = wholeSeconds(42, 12000, 500, 40);
    for (const pausedAt of [3041, 3500, 4000]) {
        const events = [
            ...ticks.filter(([at]) => at < pausedAt),
            [pausedAt, 'paused'] as Status,
            ...ticks.filter(([at]) => at >= pausedAt),
        ];
        const hardPauses = simulate(42, true, events);
        assert.ok(hardPauses.length >= 2, `paused at ${pausedAt}: ${hardPauses}`);
        assert.ok(hardPauses[0] - pausedAt <= 2000, `caught ${hardPauses[0] - pausedAt} ms late`);
        assert.ok(
            hardPauses[1] - hardPauses[0] <= 2100,
            `re-caught after ${hardPauses[1] - hardPauses[0]} ms`,
        );
    }
});
