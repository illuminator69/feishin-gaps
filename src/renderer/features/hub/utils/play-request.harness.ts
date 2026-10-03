import assert from 'node:assert/strict';
import test from 'node:test';

import type { PlayRequest } from './play-request.ts';
import type { PlayheadRun } from './playhead-run.ts';

import {
    isGuardOpen,
    isRunaway,
    lastPlayRequest,
    notePlayRequest,
    resetPlayRequests,
} from './play-request.ts';
import { isPlayheadRolling, notePlayheadStep } from './playhead-run.ts';

/**
 * B-058:  node --test src/renderer/features/hub/utils/play-request.harness.ts
 *
 * use-hub's three guards against a runaway, replayed over a timeline (ms from the load/adopt):
 *   - the armed-seek re-check: a paused load's pendingSeek fires at the song change + 150 ms, and
 *     re-checks 1200 ms later -> `hardPause('armed seek, 1200 ms re-check')`. Armed at
 *     `pendingSeek.armedAt`, i.e. the load (the adopt's `load` path arms one too);
 *   - the adopt's 400 ms re-check -> `hardPause('adopt, 400 ms re-check')`;
 *   - the adopt window: every progress event for 3 s -> `hardPause('adopt guard, progress watchdog')`.
 * "Rolling" is use-hub's audioIsRolling(): the store reads PLAYING, or the engine's own ticks
 * (web engine, every 250 ms) make a playhead run (playhead-run.ts, the real thing).
 */

interface Timeline {
    /** An orphaned-session adopt (the `load` path) armed its guards at this ms. */
    adoptAt?: number;
    /** The engine starts advancing at this ms. */
    audioFrom?: number;
    /** A paused hub load (do:load play=false) armed its seek at this ms; the song changes then. */
    pausedLoadAt?: number;
    /** Plays somebody asked for, marked at their source. */
    requests?: PlayRequest[];
    /**
     * What the player store reads while the engine advances: PLAYING for a requested play and for
     * mpv's own `resumed` echo (a startup auto-resume); PAUSED for a load whose play() beat its pause.
     */
    store: 'paused' | 'playing';
}

const TICK_MS = 250;
const END_MS = 6000;
const ADOPT_GUARD_MS = 3000;

/** The first hardPause the three guards make over the timeline, or null. */
const firstGuardPause = (tl: Timeline): null | { at: number; why: string } => {
    const requests = [...(tl.requests ?? [])].sort((a, b) => a.at - b.at);
    const requestAsOf = (t: number) => requests.filter((r) => r.at <= t).at(-1) ?? null;

    const ticks: number[] = [];
    if (tl.audioFrom !== undefined) {
        for (let at = tl.audioFrom + TICK_MS; at <= END_MS; at += TICK_MS) ticks.push(at);
    }
    const rollingAt = (t: number) => {
        const storePlaying =
            tl.store === 'playing' && tl.audioFrom !== undefined && t >= tl.audioFrom;
        let run: null | PlayheadRun = null;
        let prev = 30;
        for (const at of ticks) {
            if (at > t) break;
            const sec = 30 + (at - tl.audioFrom!) / 1000;
            run = notePlayheadStep(run, prev, sec, at);
            prev = sec;
        }
        return storePlaying || isPlayheadRolling(run, t);
    };

    type Check = { at: number; run: (t: number) => null | string };
    const checks: Check[] = [];
    const armedSeek = (armedAt: number) =>
        checks.push({
            at: armedAt + 150 + 1200,
            run: (t) =>
                isRunaway(rollingAt(t), armedAt, requestAsOf(t))
                    ? 'armed seek, 1200 ms re-check'
                    : null,
        });
    if (tl.pausedLoadAt !== undefined) armedSeek(tl.pausedLoadAt);
    if (tl.adoptAt !== undefined) {
        const guard = { armedAt: tl.adoptAt, until: tl.adoptAt + ADOPT_GUARD_MS };
        checks.push({
            at: tl.adoptAt + 400,
            run: (t) =>
                isRunaway(rollingAt(t), guard.armedAt, requestAsOf(t))
                    ? 'adopt, 400 ms re-check'
                    : null,
        });
        armedSeek(tl.adoptAt);
        for (const at of ticks) {
            checks.push({
                at,
                run: (t) =>
                    isGuardOpen(guard, t, requestAsOf(t)) && rollingAt(t)
                        ? 'adopt guard, progress watchdog'
                        : null,
            });
        }
    }
    checks.sort((a, b) => a.at - b.at);
    for (const check of checks) {
        const why = check.run(check.at);
        if (why) return { at: check.at, why };
    }
    return null;
};

const user = (at: number): PlayRequest => ({ at, source: 'user' });
const hub = (at: number): PlayRequest => ({ at, source: 'hub' });

// --- The incident (2026-10-03 17:46:19Z, transfer t3 -> Feishin @ index 43, 35707 ms) -----

test('B-058: a play pressed ~0.16 s after a paused transfer is not paused by the re-check', () => {
    // Song change at 17:46:20.357 (= the hardPause at 21.707 - 1350 ms). The play's unpause
    // scrobble at 20.514 (+157 ms); the run the hardPause logged began 937 ms before it (+413).
    const tl: Timeline = {
        audioFrom: 413,
        pausedLoadAt: 0,
        requests: [user(157)],
        store: 'playing',
    };
    assert.equal(firstGuardPause(tl), null);
});

test('B-058: a play pressed anywhere inside the 1.35 s re-check window is not paused', () => {
    for (const at of [1, 300, 600, 900, 1200, 1340]) {
        const tl: Timeline = {
            audioFrom: at + 40,
            pausedLoadAt: 0,
            requests: [user(at)],
            store: 'playing',
        };
        assert.equal(firstGuardPause(tl), null, `play pressed at +${at} ms`);
    }
});

test("B-058: the hub's do:play inside hubDrivenUntil plays (a controller elsewhere asked)", () => {
    // The re-check runs inside hubDrivenUntil by construction (the song change re-arms it for
    // 2 s and the re-check fires at +1350), so that window cannot protect a do:play - the mark can.
    const tl: Timeline = {
        audioFrom: 740,
        pausedLoadAt: 0,
        requests: [hub(700)],
        store: 'playing',
    };
    assert.equal(firstGuardPause(tl), null);
});

test("B-058: a newer do:load that plays is not paused by the older paused load's re-check", () => {
    const tl: Timeline = {
        audioFrom: 850,
        pausedLoadAt: 0,
        requests: [hub(800)],
        store: 'playing',
    };
    assert.equal(firstGuardPause(tl), null);
});

// --- The runaways the re-check is for: still caught -----------------------------------------

test('a paused load whose play() lands after its pause is still paused by the re-check', () => {
    // Store PAUSED (setQueue's PLAYING, then the pause), engine advancing anyway.
    const tl: Timeline = { audioFrom: 50, pausedLoadAt: 0, store: 'paused' };
    assert.deepEqual(firstGuardPause(tl), { at: 1350, why: 'armed seek, 1200 ms re-check' });
});

test("mpv's resumed echo after a paused load (store PLAYING, nobody asked) is still paused", () => {
    const tl: Timeline = { audioFrom: 300, pausedLoadAt: 0, store: 'playing' };
    assert.deepEqual(firstGuardPause(tl), { at: 1350, why: 'armed seek, 1200 ms re-check' });
});

test('a play requested BEFORE the paused load does not excuse audio after it (the load is newer)', () => {
    // Pressed play, then the hub's paused transfer arrived; the old play's engine start lands late.
    const tl: Timeline = {
        audioFrom: 50,
        pausedLoadAt: 0,
        requests: [user(-500)],
        store: 'paused',
    };
    assert.deepEqual(firstGuardPause(tl), { at: 1350, why: 'armed seek, 1200 ms re-check' });
});

// --- The adopt guard (Q-051's leftover) ------------------------------------------------------

test('B-058: a play pressed within 3 s of an adopt is not paused', () => {
    for (const at of [50, 200, 390, 1000, 1500, 2500, 2990]) {
        const tl: Timeline = {
            adoptAt: 0,
            audioFrom: at + 40,
            requests: [user(at)],
            store: 'playing',
        };
        assert.equal(firstGuardPause(tl), null, `play pressed at +${at} ms`);
    }
});

test('a startup auto-resume after an adopt (mpv echo, store PLAYING, nobody asked) is still paused', () => {
    // Its first progress event at +350 trips the window; one that starts later meets the re-check.
    const early: Timeline = { adoptAt: 0, audioFrom: 100, store: 'playing' };
    assert.deepEqual(firstGuardPause(early), { at: 350, why: 'adopt guard, progress watchdog' });
    const later: Timeline = { adoptAt: 0, audioFrom: 200, store: 'playing' };
    assert.deepEqual(firstGuardPause(later), { at: 400, why: 'adopt, 400 ms re-check' });
});

test('an auto-resume landing late in the adopt window is still caught by the watchdog', () => {
    const tl: Timeline = { adoptAt: 0, audioFrom: 1800, store: 'playing' };
    assert.deepEqual(firstGuardPause(tl), { at: 2050, why: 'adopt guard, progress watchdog' });
});

test('a runaway under a paused store after an adopt is still caught inside the window', () => {
    const tl: Timeline = { adoptAt: 0, audioFrom: 500, store: 'paused' };
    const pause = firstGuardPause(tl);
    assert.ok(pause && pause.at < ADOPT_GUARD_MS, JSON.stringify(pause));
});

test('a play requested before the adopt does not excuse a runaway after it', () => {
    const tl: Timeline = { adoptAt: 0, audioFrom: 200, requests: [user(-300)], store: 'playing' };
    assert.deepEqual(firstGuardPause(tl), { at: 400, why: 'adopt, 400 ms re-check' });
});

// --- The decision itself -----------------------------------------------------------------------

test('a guard stands down only for a play requested strictly after it was armed', () => {
    assert.equal(isRunaway(true, 1000, null), true, 'nobody asked');
    assert.equal(isRunaway(true, 1000, user(999)), true, 'asked before the guard');
    assert.equal(isRunaway(true, 1000, user(1000)), true, 'same ms: the guard wins');
    assert.equal(isRunaway(true, 1000, user(1001)), false, 'asked after');
    assert.equal(isRunaway(true, 1000, hub(1001)), false, 'the hub asked after');
    assert.equal(isRunaway(false, 1000, null), false, 'nothing rolling');
});

test('a guard window lapses at its end, or closes early for a play requested inside it', () => {
    const guard = { armedAt: 1000, until: 4000 };
    assert.equal(isGuardOpen(guard, 2000, null), true);
    assert.equal(isGuardOpen(guard, 4000, null), false, 'lapsed');
    assert.equal(isGuardOpen(guard, 2000, user(500)), true, 'asked before it opened');
    assert.equal(isGuardOpen(guard, 2000, user(1500)), false, 'asked inside it');
});

test('the mark keeps the newest request', () => {
    resetPlayRequests();
    assert.equal(lastPlayRequest(), null);
    notePlayRequest('hub', 10);
    notePlayRequest('user', 20);
    assert.deepEqual(lastPlayRequest(), { at: 20, source: 'user' });
    resetPlayRequests();
});
