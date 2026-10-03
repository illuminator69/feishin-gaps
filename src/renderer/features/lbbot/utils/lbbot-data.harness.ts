import assert from 'node:assert/strict';
import test from 'node:test';

import { hasMetaFields } from '../../../../shared/utils/lbbot-wire.ts';
import {
    classifyRefresh,
    describeListeningStatus,
    describeToCheck,
    normalizeOverridesData,
    sortOverrides,
    syncReport,
} from './lbbot-data.ts';

/**
 * I-020 / I-021: the "lb-bot data" panel's wording and its "Sync now" watcher.
 *
 *     node --test src/renderer/features/lbbot/utils/lbbot-data.harness.ts
 */

const listen = (over: Record<string, unknown> = {}) => ({
    count: 100,
    error: '',
    lastSyncAt: 1000,
    newest: 2_000_000,
    oldest: 1_000_000,
    state: 'ready' as const,
    total: 100,
    ...over,
});

test('describeToCheck says what was measured, never that it is a mistake', () => {
    assert.equal(
        describeToCheck({ albums: 7, kind: 'unmatched' }),
        'lb-bot guessed a MusicBrainz artist that matches none of your 7 albums',
    );
    assert.equal(
        describeToCheck({ albums: 1, kind: 'unmatched' }),
        'lb-bot guessed a MusicBrainz artist that matches none of your 1 album',
    );
    assert.equal(describeToCheck({ albums: 3, kind: 'unresolved' }), 'No MusicBrainz artist found');
});

test('normalizeOverridesData: new shape passes, a bare legacy map is read as no toCheck', () => {
    const row = { mbid: 'm', name: 'N', ndArtistId: 'a', setAt: 1, tagMbid: '' };
    const full = { byNdId: { a: row }, toCheck: [] };
    assert.deepEqual(normalizeOverridesData(full), full);
    assert.deepEqual(normalizeOverridesData({ a: row }), { byNdId: { a: row }, toCheck: null });
    assert.deepEqual(normalizeOverridesData(undefined), { byNdId: {}, toCheck: null });
    // toCheck null stays null: absent field = older lb-bot, which is not "empty".
    assert.equal(normalizeOverridesData({ byNdId: {}, toCheck: null }).toCheck, null);
});

test('sortOverrides: by name, case-blind, nameless last', () => {
    const r = (name: string, id: string) => ({
        mbid: 'm',
        name,
        ndArtistId: id,
        setAt: 1,
        tagMbid: '',
    });
    assert.deepEqual(
        sortOverrides({ a: r('beta', 'a'), b: r('', 'b'), c: r('Alpha', 'c') }).map(
            (x) => x.ndArtistId,
        ),
        ['c', 'a', 'b'],
    );
});

test('describeListeningStatus in words, per state', () => {
    assert.match(
        describeListeningStatus(listen({ count: 0, state: 'off', total: null })),
        /not set up/i,
    );
    const importing = describeListeningStatus(listen({ count: 20, state: 'importing', total: 90 }));
    assert.match(importing, /Importing 20 of 90/);
    const ready = describeListeningStatus(listen());
    assert.match(ready, /100 listens/);
    assert.match(describeListeningStatus(listen({ error: 'boom', state: 'error' })), /boom/);
});

const idle = { id: 4, phase: 'idle' as const };
const before = { cursor: 10, epoch: 'e1', listening: listen(), sync: idle };
const at = (sync: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
    cursor: 10,
    epoch: 'e1',
    listening: listen(),
    sync: sync as never,
    ...over,
});

test('syncReport: a cursor that moved is reported with both numbers, whatever the run says', () => {
    const r = syncReport(before, at({ id: 5, phase: 'finished' }, { cursor: 14 }), false, 1000);
    assert.match(r.mirror, /10.*14/);
    assert.equal(r.listening, '');
});

test('syncReport: a new epoch is called out', () => {
    assert.match(
        syncReport(before, at({ id: 5, phase: 'finished' }, { cursor: 3, epoch: 'e2' }), false, 100)
            .mirror,
        /rebuilt/i,
    );
});

test('syncReport: "up to date" only after a pull that FINISHED with the cursor unchanged', () => {
    const r = syncReport(before, at({ id: 5, phase: 'finished' }), false, 300);
    assert.match(r.mirror, /up to date/i);
    assert.equal(r.done, true);
});

test('syncReport: a pull that failed says so and with what is known, never "up to date"', () => {
    const busy = syncReport(before, at({ id: 5, phase: 'failed', status: 503 }), false, 9000);
    assert.match(busy.mirror, /failed/i);
    assert.match(busy.mirror, /503/);
    assert.doesNotMatch(busy.mirror, /up to date/i);
    assert.equal(busy.done, true);
    assert.match(
        syncReport(before, at({ id: 5, phase: 'failed', status: 0 }), false, 9000).mirror,
        /failed/i,
    );
});

test('syncReport: a pull that is still running says it is, however long it has been', () => {
    const r = syncReport(before, at({ id: 5, phase: 'running' }), false, 20_000);
    assert.match(r.mirror, /still running/i);
    assert.doesNotMatch(r.mirror, /up to date/i);
    assert.equal(r.done, false);
});

test('syncReport: a skipped pull gives its reason', () => {
    const r = syncReport(
        before,
        at({ id: 5, phase: 'skipped', reason: 'the hub reports lb-bot down' }),
        false,
        500,
    );
    assert.match(r.mirror, /not run.*hub reports lb-bot down/i);
    assert.equal(r.done, true);
});

test("syncReport: a run that began BEFORE the click is not this click's answer", () => {
    // Same run id as before the click, finished earlier: no new pull has started.
    const stale = at({ id: 4, phase: 'finished' });
    assert.match(syncReport(before, stale, false, 500).mirror, /waiting for the pull to start/i);
    const late = syncReport(before, stale, false, 6000);
    assert.doesNotMatch(late.mirror, /up to date/i);
    assert.match(late.mirror, /no pull has started/i);
});

test('syncReport: listening shows the state change it caused, then settles', () => {
    const fin = { id: 5, phase: 'finished' };
    const importing = at(fin, {
        listening: listen({ count: 100, state: 'importing', total: 500 }),
    });
    const r1 = syncReport(before, importing, true, 2000);
    assert.match(r1.listening, /Importing 100 of 500/);
    assert.equal(r1.done, false);
    const synced = at(fin, { listening: listen({ count: 130, lastSyncAt: 1500 }) });
    assert.match(syncReport(before, synced, true, 4000).listening, /130 listens/);
    const waiting = syncReport(before, at(fin), true, 4000);
    assert.match(waiting.listening, /waiting/i);
    assert.equal(waiting.done, false);
    const late = syncReport(before, at(fin), true, 25_000);
    assert.match(late.listening, /no change/i);
    assert.equal(late.done, true);
});

test('classifyRefresh: only a successful answer identical to what is shown is "the same"', () => {
    assert.match(classifyRefresh({ ok: true, status: 200 }, true), /same as what is shown/i);
    assert.match(classifyRefresh({ ok: true, status: 200 }, false), /refreshed/i);
    const down = classifyRefresh({ error: 'Could not reach the hub', ok: false, status: 0 }, false);
    assert.match(down, /could not reach lb-bot/i);
    assert.match(down, /unchanged/i);
    const err = classifyRefresh({ error: 'lb-bot is busy', ok: false, status: 502 }, false);
    assert.match(err, /502/);
    assert.match(err, /lb-bot is busy/);
    assert.doesNotMatch(err, /nothing new|same as/i);
});

test('hasMetaFields: a body with none of the fields toMeta reads is "nothing"', () => {
    assert.equal(hasMetaFields({}), false);
    assert.equal(hasMetaFields({ unrelated: 1 }), false);
    assert.equal(hasMetaFields({ found: false }), true);
    assert.equal(hasMetaFields({ summary: '' }), true);
    assert.equal(hasMetaFields({ paragraphs: [] }), true);
    assert.equal(hasMetaFields({ relations: {} }), true);
});

test('classifyRefresh: a success that carries no meta is "returned nothing", not "Refreshed"', () => {
    const empty = classifyRefresh({ data: null, ok: true, status: 200 }, false);
    assert.match(empty, /returned nothing/i);
    assert.match(empty, /unchanged/i);
    assert.doesNotMatch(empty, /refreshed|same as/i);
    assert.match(classifyRefresh({ data: {}, ok: true, status: 200 }, false), /refreshed/i);
});

import { listeningSyncFailure } from './lbbot-data.ts';

test('listeningSyncFailure: 404 and 405 are "no listening history yet", not an error', () => {
    for (const status of [404, 405]) {
        const f = listeningSyncFailure({
            error: 'The method is not allowed for the requested URL.',
            status,
        });
        assert.equal(f.older, true);
        assert.match(f.message, /no listening history yet/i);
        assert.doesNotMatch(f.message, /not allowed/i);
    }
    const other = listeningSyncFailure({ error: 'lb-bot is busy', status: 502 });
    assert.equal(other.older, false);
    assert.equal(other.message, 'lb-bot is busy');
});
