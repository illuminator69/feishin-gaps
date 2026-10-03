import assert from 'node:assert/strict';
import test from 'node:test';

import {
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

const before = { cursor: 10, epoch: 'e1', listening: listen() };

test('syncReport: mirror cursor moving is reported with both numbers', () => {
    const r = syncReport(before, { cursor: 14, epoch: 'e1', listening: listen() }, false, 1000);
    assert.match(r.mirror, /10.*14/);
    assert.equal(r.listening, '');
});

test('syncReport: mirror unchanged is "checking" at first, "up to date" after a few seconds', () => {
    const now = { cursor: 10, epoch: 'e1', listening: listen() };
    assert.match(syncReport(before, now, false, 500).mirror, /checking/i);
    assert.match(syncReport(before, now, false, 6000).mirror, /up to date/i);
    assert.equal(syncReport(before, now, false, 6000).done, true);
});

test('syncReport: a new epoch is called out', () => {
    assert.match(
        syncReport(before, { cursor: 3, epoch: 'e2', listening: listen() }, false, 100).mirror,
        /rebuilt|new/i,
    );
});

test('syncReport: listening shows the state change it caused, then settles', () => {
    const importing = {
        cursor: 10,
        epoch: 'e1',
        listening: listen({ count: 100, state: 'importing', total: 500 }),
    };
    const r1 = syncReport(before, importing, true, 2000);
    assert.match(r1.listening, /Importing 100 of 500/);
    assert.equal(r1.done, false);
    const synced = { cursor: 10, epoch: 'e1', listening: listen({ count: 130, lastSyncAt: 1500 }) };
    const r2 = syncReport(before, synced, true, 4000);
    assert.match(r2.listening, /130 listens/);
    const waiting = syncReport(
        before,
        { cursor: 10, epoch: 'e1', listening: listen() },
        true,
        4000,
    );
    assert.match(waiting.listening, /waiting/i);
    assert.equal(waiting.done, false);
    const late = syncReport(before, { cursor: 10, epoch: 'e1', listening: listen() }, true, 25_000);
    assert.match(late.listening, /no change/i);
    assert.equal(late.done, true);
});
