import assert from 'node:assert/strict';
import test from 'node:test';

import type { PollAnswer } from './album-override.ts';

import {
    APPLY_SPEC,
    forgetFinishedJobs,
    GIVE_UP_MS,
    POLL_INTERVAL_MS,
    REMOVE_SPEC,
    runJob,
    wasFinished,
} from './album-override.ts';

/**
 * The poll loop as a plain runner, with a fake clock and a scripted server: the
 * seed from the POST's own state (X1), the silence clock across real ticks (X2),
 * and what is remembered once a job ended at rest (X3).
 *
 *     node --test src/renderer/features/lbbot/utils/job-runner.harness.ts
 */

const row = (state: string, extra: object = {}) => ({
    done: 0,
    failures: [],
    id: 'ov',
    setAt: 7,
    state,
    total: 10,
    ...extra,
});
type Row = ReturnType<typeof row>;
const ok = (r: Row): PollAnswer<Row> => ({ ok: true, row: r });

/** A virtual clock: `wait` advances it, `read` pops the script (the last answer repeats). */
const harness = (script: PollAnswer<Row>[]) => {
    let clock = 0;
    let reads = 0;
    const seen: string[] = [];
    return {
        get clock() {
            return clock;
        },
        ended: [] as string[],
        input: {
            now: () => clock,
            onState: (s: { phase: string }) => seen.push(s.phase),
            read: async () => {
                const answer = script[Math.min(reads, script.length - 1)];
                reads += 1;
                return answer;
            },
            wait: async (ms: number) => {
                clock += ms;
            },
        },
        get reads() {
            return reads;
        },
        seen,
    };
};

test('X1: a remove already failed at the first tick ends at once, with its reasons', async () => {
    forgetFinishedJobs();
    const h = harness([ok(row('failed', { failures: [{ reason: 'moved', title: 'T' }] }))]);
    const end = await runJob({
        ...h.input,
        id: 'ov',
        isCurrent: () => true,
        seedState: 'removing',
        spec: REMOVE_SPEC,
    });
    assert.equal(end.phase, 'failed');
    assert.equal(end.row?.failures.length, 1);
    assert.equal(h.reads, 1);
    assert.equal(h.clock, POLL_INTERVAL_MS);
});

test('X1: without the seed the same script polls until the clock gives up (the bug the seed fixes)', async () => {
    forgetFinishedJobs();
    const h = harness([ok(row('failed'))]);
    const end = await runJob({
        ...h.input,
        id: 'ov',
        isCurrent: () => true,
        spec: REMOVE_SPEC,
    });
    assert.equal(end.phase, 'timeout');
    assert.ok(h.reads >= GIVE_UP_MS / POLL_INTERVAL_MS - 1);
});

test('X1: resuming a running row seeds from the row state', async () => {
    forgetFinishedJobs();
    const h = harness([ok(row('failed'))]);
    const end = await runJob({
        ...h.input,
        id: 'ov',
        isCurrent: () => true,
        seedState: row('removing').state,
        spec: REMOVE_SPEC,
    });
    assert.equal(end.phase, 'failed');
});

test('X2: a long job that keeps moving outlasts three minutes', async () => {
    forgetFinishedJobs();
    const script: PollAnswer<Row>[] = [];
    for (let done = 1; done <= 120; done += 1)
        script.push(ok(row('applying', { done, total: 120 })));
    script.push(ok(row('applied', { done: 120, total: 120 })));
    const h = harness(script);
    const end = await runJob({
        ...h.input,
        id: 'ov',
        isCurrent: () => true,
        spec: APPLY_SPEC,
    });
    assert.equal(end.phase, 'settled');
    assert.ok(h.clock > GIVE_UP_MS);
});

test('X2: a job that freezes gives up three minutes after it froze', async () => {
    forgetFinishedJobs();
    const h = harness([
        ok(row('applying', { done: 1 })),
        ok(row('applying', { done: 2 })),
        ok(row('applying', { done: 2 })),
    ]);
    const end = await runJob({ ...h.input, id: 'ov', isCurrent: () => true, spec: APPLY_SPEC });
    assert.equal(end.phase, 'timeout');
    // froze at the second tick (4 s), so it gives up three minutes after that
    assert.ok(h.clock >= 4000 + GIVE_UP_MS && h.clock <= 4000 + GIVE_UP_MS + POLL_INTERVAL_MS);
});

test('a superseded runner stops quietly and reports nothing more', async () => {
    forgetFinishedJobs();
    const h = harness([ok(row('applying'))]);
    let current = true;
    const end = runJob({
        ...h.input,
        id: 'ov',
        isCurrent: () => current,
        onEnd: () => h.ended.push('end'),
        spec: APPLY_SPEC,
        wait: async (ms) => {
            await h.input.wait(ms);
            current = false;
        },
    });
    await end;
    assert.deepEqual(h.ended, []);
    assert.equal(h.reads, 0);
});

test('X3: a job that ended at rest is remembered as id@setAt and never followed again', async () => {
    forgetFinishedJobs();
    const h = harness([ok(row('applied', { done: 10 }))]);
    const end = await runJob({ ...h.input, id: 'ov', isCurrent: () => true, spec: APPLY_SPEC });
    assert.equal(end.phase, 'settled');
    assert.equal(wasFinished({ id: 'ov', setAt: 7 }, APPLY_SPEC), true);
    // a different set of the same id is a different job
    assert.equal(wasFinished({ id: 'ov', setAt: 8 }, APPLY_SPEC), false);
});

test('X3: a failed end is at rest too; a timeout is not remembered (it may be picked up again)', async () => {
    forgetFinishedJobs();
    const failed = harness([ok(row('failed', { id: 'a', setAt: 1 }))]);
    await runJob({ ...failed.input, id: 'a', isCurrent: () => true, spec: APPLY_SPEC });
    assert.equal(wasFinished({ id: 'a', setAt: 1 }, APPLY_SPEC), true);

    const frozen = harness([ok(row('applying', { id: 'b', setAt: 2 }))]);
    const end = await runJob({ ...frozen.input, id: 'b', isCurrent: () => true, spec: APPLY_SPEC });
    assert.equal(end.phase, 'timeout');
    assert.equal(wasFinished({ id: 'b', setAt: 2 }, APPLY_SPEC), false);
});

test('onEnd runs once, with the final state', async () => {
    forgetFinishedJobs();
    const h = harness([ok(row('applying', { done: 3 })), ok(row('applied', { done: 10 }))]);
    const phases: string[] = [];
    await runJob({
        ...h.input,
        id: 'ov',
        isCurrent: () => true,
        onEnd: (s) => phases.push(s.phase),
        spec: APPLY_SPEC,
    });
    assert.deepEqual(phases, ['settled']);
});

test('an apply marked finished does not hide a running remove of the same row', async () => {
    forgetFinishedJobs();
    const h = harness([ok(row('applied', { done: 10 }))]);
    await runJob({ ...h.input, id: 'ov', isCurrent: () => true, spec: APPLY_SPEC });
    assert.equal(wasFinished({ id: 'ov', setAt: 7 }, APPLY_SPEC), true);
    // the undo keeps the row's id and setAt: a different job
    assert.equal(wasFinished({ id: 'ov', setAt: 7 }, REMOVE_SPEC), false);
});
