import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChipState, QueueEntry } from './station-chips.ts';
import type { StationBinding } from './station-logic.ts';

import {
    chipsFor,
    planChipTap,
    remoteEditActs,
    removableStationRows,
    REPLACE_COUNT,
    selectedChip,
} from './station-chips.ts';

/**
 * I-041:  node --test src/renderer/features/player/station/station-chips.harness.ts
 *
 * The queue's chip row: which chip is selected in each state, and what a tap does (the
 * preference, the signal, which rows it takes out or swaps, whether the top-up runs at once),
 * plus the acts that edit a REMOTE session: `remove` per row, highest index first, then one
 * `enqueue`, never a `setQueue`. The remote cases replay the acts on a model of the hub's own
 * `remove` (hub.py: pop the index, shift the playing index down when it was before it) and check
 * that the playing track and the next one are the same rows afterwards.
 */

const bound = (over: Partial<StationBinding> = {}): StationBinding => ({
    character: 'balanced',
    engine: 'tier2',
    exhausted: false,
    name: 'Cinnamon Girl radio',
    rev: 0,
    seed: { ids: ['seed'], kind: 'track' },
    seq: 20,
    stationId: 'st_1',
    stopped: false,
    ...over,
});

const state = (over: Partial<ChipState> = {}): ChipState => ({
    autoplay: true,
    bound: null,
    mode: 'stations',
    preferred: 'close',
    ...over,
});

/** A queue in play order: `s` rows are the station's, `u` the user's (or a seed). */
const queue = (pattern: string, order?: number[]): QueueEntry[] => {
    const rows = [...pattern].map((kind, queueIndex) => ({
        id: `${kind}${queueIndex}`,
        key: String(queueIndex),
        queueIndex,
        stationAdded: kind === 's',
    }));
    return order ? order.map((queueIndex) => rows[queueIndex]) : rows;
};

// --- Which chips, which one selected ------------------------------------------------------------

test('with the engine: Off, Close, Balanced, Explore; without it: Off and Auto DJ', () => {
    assert.deepEqual(chipsFor('stations'), ['off', 'close', 'balanced', 'explore']);
    assert.deepEqual(chipsFor('pending'), ['off', 'close', 'balanced', 'explore']);
    assert.deepEqual(chipsFor('fallback'), ['off', 'autoDj']);
});

test('a queue with a station shows the station: its character, or Off when it was stopped', () => {
    assert.equal(selectedChip(state({ bound: bound({ character: 'explore' }) })), 'explore');
    assert.equal(selectedChip(state({ bound: bound({ stopped: true }) })), 'off');
    // Shared state: this device's own preference does not override it either way.
    assert.equal(
        selectedChip(state({ autoplay: false, bound: bound({ character: 'close' }) })),
        'close',
    );
    assert.equal(selectedChip(state({ autoplay: true, bound: bound({ stopped: true }) })), 'off');
});

test('a queue with no station shows the preference: Off, or the preferred character', () => {
    assert.equal(selectedChip(state({ autoplay: false })), 'off');
    assert.equal(selectedChip(state({ autoplay: true, preferred: 'explore' })), 'explore');
});

test('without the engine: Auto DJ when on, else Off, whatever is bound', () => {
    assert.equal(selectedChip(state({ autoplay: true, mode: 'fallback' })), 'autoDj');
    assert.equal(selectedChip(state({ autoplay: false, bound: bound(), mode: 'fallback' })), 'off');
});

// --- Which rows a tap may touch -----------------------------------------------------------------

test('only station rows after the next one: never the playing track or the one after it', () => {
    // Playing row 1; row 2 is next. Rows 3.. are candidates, and the user's row 3 stays.
    const rows = removableStationRows(queue('ussusss'), 1);
    assert.deepEqual(
        rows.map((row) => row.queueIndex),
        [4, 5, 6],
    );
    // Playing the last-but-one: nothing after the next one.
    assert.deepEqual(removableStationRows(queue('ssss'), 2), []);
});

test('shuffle: after the next one in PLAY order, whatever the queue order', () => {
    // Queue order u0 s1 s2 s3 s4 s5, played in the order 3,0,5,1,4,2. Playing queue row 0
    // (play position 1); next is row 5. After it in play order: rows 1, 4, 2.
    const playOrder = queue('usssss', [3, 0, 5, 1, 4, 2]);
    const rows = removableStationRows(playOrder, 1);
    assert.deepEqual(
        rows.map((row) => row.queueIndex),
        [1, 4, 2],
    );
    // Row 3 was played before; row 5 is the next one: neither is touched.
    assert.equal(
        rows.some((row) => row.queueIndex === 3 || row.queueIndex === 5),
        false,
    );
});

// --- Tap Off -----------------------------------------------------------------------------------

test('Off on a station queue: autoplay off, stop the station, take out its unplayed rows', () => {
    const plan = planChipTap('off', state({ bound: bound() }), {
        playOrder: queue('usssss'),
        position: 1,
    });
    assert.equal(plan.autoplay, false);
    assert.deepEqual(plan.signal, { kind: 'stop' });
    assert.deepEqual(plan.optimistic, { stopped: true });
    assert.deepEqual(
        plan.rows.map((row) => row.queueIndex),
        [3, 4, 5],
    );
    assert.equal(plan.topUp, false);
    assert.equal(plan.replaceCount, undefined);
});

test('Off on a station already stopped: no second stop, still takes out what is left', () => {
    const plan = planChipTap('off', state({ bound: bound({ stopped: true }) }), {
        playOrder: queue('ussss'),
        position: 0,
    });
    assert.equal(plan.signal, undefined);
    assert.deepEqual(
        plan.rows.map((row) => row.queueIndex),
        [2, 3, 4],
    );
});

test('Off on a queue with no station: only the preference; nothing to stop or take out', () => {
    const plan = planChipTap('off', state(), { playOrder: queue('uuuu'), position: 0 });
    assert.deepEqual(plan, { autoplay: false, rows: [], topUp: false });
});

// --- Tap a character -----------------------------------------------------------------------------

test('a new character on a station: steer it, swap its unplayed rows for 5 new, top up now', () => {
    const plan = planChipTap('explore', state({ bound: bound({ character: 'balanced' }) }), {
        playOrder: queue('ussss'),
        position: 0,
    });
    assert.equal(plan.autoplay, true);
    assert.equal(plan.character, 'explore');
    assert.deepEqual(plan.signal, { kind: 'character', value: 'explore' });
    assert.deepEqual(plan.optimistic, { character: 'explore', exhausted: false, stopped: false });
    assert.deepEqual(
        plan.rows.map((row) => row.queueIndex),
        [2, 3, 4],
    );
    assert.equal(plan.replaceCount, REPLACE_COUNT);
    assert.equal(plan.topUp, true);
});

test('a character on a stopped station lifts the stop, even the same character', () => {
    const plan = planChipTap('balanced', state({ bound: bound({ stopped: true }) }), {
        playOrder: queue('us'),
        position: 0,
    });
    assert.deepEqual(plan.signal, { kind: 'character', value: 'balanced' });
    assert.equal(plan.optimistic?.stopped, false);
    // Nothing after the next one to swap: just the top-up, which asks now.
    assert.equal(plan.replaceCount, undefined);
    assert.equal(plan.topUp, true);
});

test('the character the station already has: no signal, no swap, only the top-up', () => {
    const plan = planChipTap('balanced', state({ autoplay: false, bound: bound() }), {
        playOrder: queue('ussss'),
        position: 0,
    });
    assert.equal(plan.signal, undefined);
    assert.deepEqual(plan.rows, []);
    assert.equal(plan.autoplay, true);
    assert.equal(plan.topUp, true);
});

test('a character on a queue with no station: preference on, top-up now (it may continue it)', () => {
    const plan = planChipTap('close', state({ autoplay: false }), {
        playOrder: queue('uuu'),
        position: 1,
    });
    assert.deepEqual(plan, { autoplay: true, character: 'close', rows: [], topUp: true });
});

test('a character with only user rows after the next one: steered, nothing swapped', () => {
    const plan = planChipTap('explore', state({ bound: bound() }), {
        playOrder: queue('ssuuu'),
        position: 0,
    });
    assert.deepEqual(plan.signal, { kind: 'character', value: 'explore' });
    assert.deepEqual(plan.rows, []);
    assert.equal(plan.replaceCount, undefined);
});

// --- Without the engine ---------------------------------------------------------------------------

test('fallback: Auto DJ switches upstream Auto DJ on and has it look at once; Off switches it off', () => {
    const on = planChipTap('autoDj', state({ autoplay: false, mode: 'fallback' }), {
        playOrder: queue('uu'),
        position: 0,
    });
    assert.deepEqual(on, { autoplay: true, kickAutoDj: true, rows: [], topUp: false });
    const off = planChipTap('off', state({ autoplay: true, bound: bound(), mode: 'fallback' }), {
        playOrder: queue('uss'),
        position: 0,
    });
    // No station is reachable to stop, and Auto DJ's rows are not a station's.
    assert.deepEqual(off, { autoplay: false, kickAutoDj: false, rows: [], topUp: false });
});

// --- The remote edit: remove acts, highest first, then one enqueue ---------------------------------

/** hub.py's `remove`: pop the index; the playing index moves down when the row was before it. */
const applyHubRemove = (hub: { index: number; queue: string[] }, index: number) => {
    hub.queue.splice(index, 1);
    if (index < hub.index) hub.index -= 1;
};

test('the remote acts: one remove per row, highest index first, then one enqueue', () => {
    const acts = remoteEditActs([3, 7, 5, 7], 5);
    assert.deepEqual(acts, [
        { action: 'remove', index: 7 },
        { action: 'remove', index: 5 },
        { action: 'remove', index: 3 },
        { action: 'enqueue', at: 'end', count: 5 },
    ]);
    assert.equal(
        acts.some((act) => (act.action as string) === 'setQueue'),
        false,
    );
});

test('Off on a remote session: removes only, no enqueue, no setQueue', () => {
    const acts = remoteEditActs([4, 2], 0);
    assert.deepEqual(acts, [
        { action: 'remove', index: 4 },
        { action: 'remove', index: 2 },
    ]);
    assert.deepEqual(remoteEditActs([], 0), []);
    assert.deepEqual(remoteEditActs([-1, 1.5], 0), []);
});

test('shuffled remote session: the acts leave the playing and next rows the same tracks', () => {
    // Queue order u0 s1 s2 s3 s4 s5 s6, played 6,0,3,1,5,2,4. Playing row 0 (position 1),
    // next row 3. The station rows after it in play order: 1, 5, 2, 4.
    const ids = ['u0', 's1', 's2', 's3', 's4', 's5', 's6'];
    const playOrder = queue('ussssss', [6, 0, 3, 1, 5, 2, 4]);
    const rows = removableStationRows(playOrder, 1);
    const acts = remoteEditActs(
        rows.map((row) => row.queueIndex),
        5,
    );
    const hub = { index: 0, queue: [...ids] };
    const playing = hub.queue[hub.index];
    const next = 's3';
    for (const act of acts) if (act.action === 'remove') applyHubRemove(hub, act.index);
    assert.equal(hub.queue[hub.index], playing);
    assert.ok(hub.queue.includes(next));
    assert.deepEqual(hub.queue, ['u0', 's3', 's6']);
    assert.deepEqual(acts.at(-1), { action: 'enqueue', at: 'end', count: 5 });
});

test('the playing row after the removed ones keeps its place too (its index moves down)', () => {
    // Queue order s0 s1 u2 s3 s4, played in the order 2,0,1,3,4. Playing row 1 (position 2);
    // next row 3; after it row 4, the only one taken out.
    const playOrder = queue('ssuss', [2, 0, 1, 3, 4]);
    const rows = removableStationRows(playOrder, 2);
    assert.deepEqual(
        rows.map((row) => row.queueIndex),
        [4],
    );
    // And a removal BEFORE the playing row, in queue order, shifts the playing index down.
    const hub = { index: 3, queue: ['a', 'b', 'c', 'd', 'e'] };
    for (const act of remoteEditActs([1, 4], 0)) {
        if (act.action === 'remove') applyHubRemove(hub, act.index);
    }
    assert.equal(hub.queue[hub.index], 'd');
});
