import assert from 'node:assert/strict';
import test from 'node:test';

import {
    albumTarget,
    artistTarget,
    formatListeningTime,
    genresNote,
    heatmapGrid,
    hoursBars,
    importFinished,
    listeningTimeNote,
    PERIOD_OPTIONS,
    playsLabel,
    rangeText,
    readState,
    statusView,
    unownedAlbumRelease,
} from './listening-logic.ts';

/**
 * I-006: the My Listening view-model. Run directly:
 *
 *     node --test src/renderer/features/listening/listening-logic.harness.ts
 */

const status = (over: Record<string, unknown> = {}) => ({
    count: 0,
    error: '',
    lastSyncAt: null,
    newest: null,
    oldest: null,
    state: 'ready' as const,
    total: null,
    ...over,
});

test('periods are exactly the contract values, in order, with human labels', () => {
    assert.deepEqual(
        PERIOD_OPTIONS.map((p) => p.value),
        ['7d', '30d', '90d', '365d', 'all'],
    );
    assert.equal(PERIOD_OPTIONS.find((p) => p.value === '365d')?.label, 'Year');
});

test('formatListeningTime', () => {
    assert.equal(formatListeningTime(0), '0 min');
    assert.equal(formatListeningTime(59), '< 1 min');
    assert.equal(formatListeningTime(45 * 60), '45 min');
    assert.equal(formatListeningTime(3600), '1 h');
    assert.equal(formatListeningTime(3600 * 12 + 60 * 30), '12 h 30 min');
    assert.equal(formatListeningTime(3600 * 250 + 60 * 30), '250 h');
});

test('listeningTimeNote only speaks when the duration covers fewer plays than were counted', () => {
    assert.equal(listeningTimeNote({ plays: 100, secondsKnownFor: 100 }), '');
    assert.equal(listeningTimeNote({ plays: 100, secondsKnownFor: 80 }), 'from 80 of 100 plays');
    assert.equal(listeningTimeNote({ plays: 5, secondsKnownFor: 0 }), 'from 0 of 5 plays');
    assert.equal(listeningTimeNote({ plays: 0, secondsKnownFor: 0 }), '');
});

test('genresNote names both numbers and the restriction', () => {
    assert.equal(genresNote(40, 100), 'from 40 of 100 plays — albums in your library');
});

test('statusView: each state, and the importing text uses total when known', () => {
    assert.equal(statusView(status({ state: 'off' })).kind, 'off');
    const importing = statusView(status({ count: 1200, state: 'importing', total: 9000 }));
    assert.equal(importing.kind, 'importing');
    assert.equal(importing.headline, 'Importing 1200 of 9000');
    assert.equal(
        statusView(status({ count: 30, state: 'importing', total: null })).headline,
        'Importing 30 listens so far',
    );
    const err = statusView(status({ error: 'ListenBrainz 503', state: 'error' }));
    assert.equal(err.kind, 'error');
    assert.match(err.detail, /ListenBrainz 503/);
    assert.equal(statusView(status()).kind, 'ready');
});

test('statusView: importing polls, nothing else does', () => {
    assert.equal(statusView(status({ state: 'importing' })).poll, true);
    for (const state of ['off', 'ready', 'error'] as const) {
        assert.equal(statusView(status({ state })).poll, false);
    }
});

const days = (start: string, n: number, countOf = (i: number) => i) =>
    Array.from({ length: n }, (_, i) => {
        const d = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000);
        return { count: countOf(i), date: d.toISOString().slice(0, 10) };
    });

test('heatmapGrid: 112 days become Monday-first week columns, padded at the front only', () => {
    // 2026-09-30 is a Wednesday: 112 days earlier is a Wednesday too -> offset 2.
    const grid = heatmapGrid(days('2026-06-10', 112));
    assert.ok(grid.columns.every((c) => c.length === 7));
    assert.equal(grid.columns.length, 17);
    assert.equal(grid.columns[0][0], null);
    assert.equal(grid.columns[0][1], null);
    assert.equal(grid.columns[0][2]?.date, '2026-06-10');
    const cells = grid.columns.flat().filter((c) => c !== null);
    assert.equal(cells.length, 112);
    assert.equal(cells[111]?.date, '2026-09-29');
    // Row index is the weekday, Monday = 0.
    assert.equal(grid.columns[1][0]?.date, '2026-06-15');
});

test('heatmapGrid: levels are 0 for no plays and 1..4 scaled to the busiest day', () => {
    const grid = heatmapGrid([
        { count: 0, date: '2026-09-28' },
        { count: 1, date: '2026-09-29' },
        { count: 50, date: '2026-09-30' },
        { count: 100, date: '2026-10-01' },
    ]);
    const cells = grid.columns.flat().filter((c) => c !== null);
    assert.deepEqual(
        cells.map((c) => c?.level),
        [0, 1, 2, 4],
    );
    assert.equal(grid.max, 100);
});

test('heatmapGrid: empty and all-zero input does not divide by zero', () => {
    assert.deepEqual(heatmapGrid([]).columns, []);
    const cells = heatmapGrid(days('2026-09-28', 3, () => 0))
        .columns.flat()
        .filter(Boolean);
    assert.ok(cells.every((c) => c?.level === 0));
});

test('hoursBars: 24 bars, ratio against the busiest hour', () => {
    const hours = Array.from({ length: 24 }, (_, h) => (h === 21 ? 40 : h === 8 ? 10 : 0));
    const bars = hoursBars(hours);
    assert.equal(bars.length, 24);
    assert.equal(bars[21].ratio, 1);
    assert.equal(bars[8].ratio, 0.25);
    assert.equal(bars[0].ratio, 0);
    assert.ok(hoursBars(new Array(24).fill(0)).every((b) => b.ratio === 0));
});

test('artistTarget / albumTarget: library first, then the virtual page, else plain text', () => {
    assert.deepEqual(artistTarget('nd1', 'mb1'), { id: 'nd1', kind: 'library' });
    assert.deepEqual(artistTarget('', 'mb1'), { kind: 'external', mbid: 'mb1' });
    assert.equal(artistTarget('', ''), null);
    assert.deepEqual(albumTarget('al1', 'rg1'), { id: 'al1', kind: 'library' });
    assert.deepEqual(albumTarget('', 'rg1'), { kind: 'external', rgid: 'rg1' });
    assert.equal(albumTarget('', ''), null);
    // An owned row lb-bot has no id for yet (a filled album still syncing) is text,
    // never a link to the acquire page.
    assert.equal(albumTarget('', 'rg1', true), null);
    assert.deepEqual(albumTarget('', 'rg1', false), { kind: 'external', rgid: 'rg1' });
    assert.deepEqual(albumTarget('al1', 'rg1', true), { id: 'al1', kind: 'library' });
});

test('unownedAlbumRelease builds a missing release row for the shared tile', () => {
    const r = unownedAlbumRelease({ rgid: 'rg1', title: 'T' }, false);
    assert.equal(r.rgid, 'rg1');
    assert.equal(r.title, 'T');
    assert.equal(r.status, 'missing');
    assert.deepEqual(r.navidromeAlbumIds, []);
});

test('importFinished: only the importing -> ready/error edge refreshes the numbers', () => {
    assert.equal(importFinished('importing', 'ready'), true);
    assert.equal(importFinished('importing', 'error'), true);
    assert.equal(importFinished('importing', 'importing'), false);
    assert.equal(importFinished('importing', 'off'), false);
    assert.equal(importFinished('ready', 'ready'), false);
    assert.equal(importFinished('ready', 'importing'), false);
    assert.equal(importFinished(undefined, 'ready'), false);
});

test('unownedAlbumRelease: a finished fill is not re-offered as missing', () => {
    assert.equal(unownedAlbumRelease({ rgid: 'r', title: 'T' }, true).status, 'complete');
    assert.equal(unownedAlbumRelease({ rgid: 'r', title: 'T' }, false).status, 'missing');
});

const rs = (over: Record<string, unknown> = {}) =>
    readState({
        available: true,
        error: null,
        fetching: false,
        hasData: false,
        rowCount: 0,
        supported: true,
        ...over,
    } as never);

test('readState: reading only while a fetch is in flight, empty only from a 200', () => {
    assert.equal(rs({ fetching: true }).kind, 'reading');
    assert.equal(rs({ hasData: true, rowCount: 0 }).kind, 'empty');
    assert.equal(rs({ hasData: true, rowCount: 3 }).kind, 'rows');
    assert.notEqual(rs().kind, 'empty');
    assert.notEqual(rs().kind, 'reading');
});

test("readState: a failure carries lb-bot's text; a 400 is permanent (no Retry); 404/405 is older", () => {
    assert.deepEqual(rs({ error: { message: 'Navidrome unavailable', status: 503 } }), {
        kind: 'failed',
        permanent: false,
        text: 'Navidrome unavailable',
    });
    const bad = rs({ error: { message: 'unknown tz', status: 400 } });
    assert.equal(bad.kind === 'failed' && bad.permanent, true);
    assert.equal(rs({ error: { message: '', status: 404 } }).kind, 'older');
    assert.equal(rs({ error: { message: '', status: 405 } }).kind, 'older');
    const generic = rs({ error: { message: '', status: 500 } });
    assert.equal(generic.kind === 'failed' && /could not/i.test(generic.text), true);
    assert.equal(
        rs({ error: { message: 'x', status: 503 }, hasData: true, rowCount: 2 }).kind,
        'rows',
    );
});

test('readState: unsupported or unreachable says that, not "empty" or "loading"', () => {
    assert.equal(rs({ available: false }).kind, 'unreachable');
    assert.equal(rs({ supported: false }).kind, 'unreachable');
    assert.equal(rs({ available: false, hasData: true, rowCount: 2 }).kind, 'rows');
});

test('playsLabel and rangeText wording', () => {
    assert.equal(playsLabel(1), '1 play');
    assert.equal(playsLabel(0), '0 plays');
    assert.equal(playsLabel(12), '12 plays');
    assert.equal(
        rangeText(null, null, (n) => `d${n}`),
        '',
    );
    assert.equal(
        rangeText(1, 2, (n) => `d${n}`),
        'Range d1 to d2',
    );
    assert.equal(
        rangeText(1, null, (n) => `d${n}`),
        'Range from d1',
    );
});
