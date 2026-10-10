import assert from 'node:assert/strict';
import test from 'node:test';

import {
    albumCardView,
    albumTarget,
    artistCardView,
    artistTarget,
    DAILY_CAP,
    dailyForPeriod,
    dailyNote,
    DEFAULT_TAB,
    describeStoredListens,
    formatListeningTime,
    genresNote,
    heatmapCaption,
    heatmapGrid,
    historyMenuTarget,
    hoursBars,
    importFinished,
    LISTENING_TABS,
    listeningTimeNote,
    matchSongByTitle,
    PERIOD_OPTIONS,
    periodPhrase,
    playsLabel,
    rangeText,
    readState,
    recentRowView,
    showsPeriodPicker,
    statusLines,
    statusView,
    trackCardView,
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

test('heatmapGrid: whole weeks - the leading days before the first Monday are not drawn', () => {
    // 2026-06-10 is a Wednesday: the first Monday inside the data is 2026-06-15.
    const grid = heatmapGrid(days('2026-06-10', 112));
    assert.ok(grid.columns.every((c) => c.length === 7));
    assert.equal(grid.columns[0][0]?.date, '2026-06-15');
    assert.ok(grid.columns[0].every((c) => c !== null));
    // 112 days minus the 5 leading ones = 107 drawn, ending 2026-09-29 (a Tuesday).
    const cells = grid.columns.flat().filter((c) => c !== null);
    assert.equal(cells.length, 107);
    assert.equal(cells[106]?.date, '2026-09-29');
    assert.equal(grid.columns.length, 16);
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

// =============================================================================
// My Listening redesign (I-025)
// =============================================================================

const weekdayOf = (iso: string): number => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;

test('L3 heatmapGrid: a 112-day span STARTING on each weekday is a clean rectangle of whole weeks', () => {
    for (let shift = 0; shift < 7; shift += 1) {
        const start = new Date(Date.UTC(2026, 5, 15 + shift)).toISOString().slice(0, 10); // Mon + shift
        const span = days(start, 112);
        const startWeekday = weekdayOf(start);
        const leading = (7 - startWeekday) % 7; // days before the first Monday
        const grid = heatmapGrid(span);
        const label = `starting on weekday ${startWeekday}`;
        // The first column starts on a Monday and every column but the last is seven real days.
        assert.equal(weekdayOf(grid.columns[0][0]?.date ?? ''), 0, label);
        grid.columns.slice(0, -1).forEach((column) => {
            assert.equal(column.filter((c) => c !== null).length, 7, label);
        });
        // Cells sit in their weekday's row.
        grid.columns.forEach((column) => {
            column.forEach((cell, row) => {
                if (cell) assert.equal(weekdayOf(cell.date), row, label);
            });
        });
        // Nothing before the first Monday is drawn; everything after it is.
        const drawn = grid.columns.flat().filter((c) => c !== null);
        assert.equal(drawn.length, 112 - leading, label);
        assert.equal(drawn[0]?.date, span[leading].date, label);
        assert.equal(drawn[drawn.length - 1]?.date, span[111].date, label);
        // Only the last column can hold placeholders, after its last real day.
        const lastColumn = grid.columns[grid.columns.length - 1];
        const lastWeekday = weekdayOf(span[111].date);
        assert.ok(
            lastColumn.slice(lastWeekday + 1).every((c) => c === null),
            label,
        );
        assert.equal(lastColumn[lastWeekday]?.date, span[111].date, label);
        // The caption names exactly the drawn range and the week count.
        const caption = heatmapCaption(span);
        assert.ok(caption.includes(span[leading].date), label);
        assert.ok(caption.includes(span[111].date), label);
        assert.ok(caption.includes(`${grid.columns.length} weeks`), label);
        if (leading > 0) assert.ok(!caption.includes(span[0].date), label);
    }
});

test('L3 the screenshot case: 2026-06-21 (a Sunday) to 2026-10-10 starts on 2026-06-22, not with a lone Sunday', () => {
    const grid = heatmapGrid(days('2026-06-21', 112));
    assert.equal(grid.columns[0][0]?.date, '2026-06-22');
    assert.equal(grid.columns.length, 16);
    assert.match(heatmapCaption(days('2026-06-21', 112)), /2026-06-22 to 2026-10-10 \(16 weeks\)/);
});

test('L3 heatmapCaption names the drawn span, says the picker does not change it, and never claims a year', () => {
    const caption = heatmapCaption(days('2026-06-15', 112));
    assert.match(caption, /does not change/i);
    assert.equal(heatmapCaption([]), '');
    // Less than a week with no Monday inside is said in days.
    assert.match(heatmapCaption(days('2026-06-16', 3)), /3 days/);
});

test('L3 dailyForPeriod: the picked period is the tail of the daily series; longer periods get what there is, and say so', () => {
    const daily = days('2026-07-10', 90);
    assert.equal(dailyForPeriod(daily, '7d').length, 7);
    assert.equal(dailyForPeriod(daily, '7d')[6].date, daily[89].date);
    assert.equal(dailyForPeriod(daily, '30d').length, 30);
    assert.equal(dailyForPeriod(daily, '90d').length, 90);
    assert.equal(dailyForPeriod(daily, '365d').length, 90);
    assert.equal(dailyForPeriod(daily, 'all').length, 90);
    assert.equal(dailyForPeriod(days('2026-10-01', 4), '30d').length, 4);
    assert.equal(dailyNote('30d', 90), '');
    assert.match(dailyNote('365d', 90), /last 90 days/i);
    assert.match(dailyNote('all', 90), /last 90 days/i);
    assert.equal(dailyNote('90d', 90), '');
});

test('finding 2: the cap sentence only when the cap is what cut the series', () => {
    assert.equal(DAILY_CAP, 90);
    // All time with a short history: the history is that short, not capped - nothing false is said.
    assert.equal(dailyNote('all', 20), '');
    assert.equal(dailyNote('365d', 20), '');
    // All time / a year with the series at its 90-day maximum: the cap is the reason.
    assert.match(dailyNote('all', 90), /last 90 days.*longest daily series/i);
    assert.match(dailyNote('365d', 90), /last 90 days.*longest daily series/i);
    // A period the series covers needs no note.
    assert.equal(dailyNote('30d', 90), '');
});

test('L2 the period picker is drawn on Overview, Activity and Not in library - not on History', () => {
    assert.equal(showsPeriodPicker('overview'), true);
    assert.equal(showsPeriodPicker('activity'), true);
    assert.equal(showsPeriodPicker('not-in-library'), true);
    assert.equal(showsPeriodPicker('history'), false);
});

test('L1 four tabs in order, opening on Overview', () => {
    assert.deepEqual(
        LISTENING_TABS.map((t) => [t.id, t.label]),
        [
            ['overview', 'Overview'],
            ['activity', 'Activity'],
            ['history', 'History'],
            ['not-in-library', 'Not in library'],
        ],
    );
    assert.equal(DEFAULT_TAB, 'overview');
});

const stat = (over: Record<string, unknown> = {}) => ({
    count: 100,
    error: '',
    lastSyncAt: 1000,
    newest: 2_000_000,
    oldest: 1_000_000,
    state: 'ready' as const,
    total: 100,
    ...over,
});
const when = (n: null | number) => (n ? `t${n}` : 'never');

test('L8 the status is shown once: a banner for importing/error/off, a plain line only for ready', () => {
    for (const state of ['importing', 'error', 'off'] as const) {
        const block = statusLines(stat({ error: 'boom', state }), when);
        assert.ok(block.banner, state);
        assert.equal(block.line, '', state);
    }
    const ready = statusLines(stat(), when);
    assert.equal(ready.banner, null);
    assert.match(ready.line, /100 listens stored/);
    assert.match(ready.meta, /last sync t1000/);
    assert.equal(ready.line, describeStoredListens(stat()));
});

test('finding 1: the error banner keeps the stored-listens count the old line had', () => {
    const block = statusLines(stat({ count: 4321, error: 'boom', state: 'error' }), when);
    assert.match(block.banner?.detail ?? '', /4321 listens stored/);
    assert.match(block.banner?.detail ?? '', /boom/);
});

test("describeStoredListens: the count, and ListenBrainz's own total when it differs", () => {
    assert.equal(describeStoredListens(stat()), '100 listens stored.');
    assert.equal(
        describeStoredListens(stat({ total: 120 })),
        '100 listens stored of 120 on ListenBrainz.',
    );
    assert.equal(describeStoredListens(stat({ total: null })), '100 listens stored.');
});

test('L4 card views: rank and plays in the text, the Navidrome id (or none) for the picture', () => {
    const album = {
        artist: 'Magdalena Bay',
        ndAlbumId: 'al1',
        owned: true,
        plays: 274,
        rgid: 'rg1',
        title: 'Imaginal Disk',
    };
    assert.deepEqual(albumCardView(album, 1), {
        imageId: 'al1',
        imageRgid: null,
        linked: true,
        subtitle: 'Magdalena Bay · 274 plays',
        title: '1. Imaginal Disk',
    });
    assert.deepEqual(albumCardView({ ...album, ndAlbumId: '', owned: false, plays: 1 }, 7), {
        imageId: null,
        imageRgid: 'rg1',
        linked: true,
        subtitle: 'Magdalena Bay · 1 play · not in your library',
        title: '7. Imaginal Disk',
    });
    assert.deepEqual(
        artistCardView({ mbid: 'm', name: 'Geese', ndArtistId: 'ar1', plays: 414 }, 3),
        {
            imageId: 'ar1',
            imageRgid: null,
            linked: true,
            subtitle: '414 plays',
            title: '3. Geese',
        },
    );
    assert.equal(
        artistCardView({ mbid: 'm', name: 'X', ndArtistId: '', plays: 2 }, 1).imageId,
        null,
    );
    assert.deepEqual(
        trackCardView(
            { artist: 'Wet Leg', ndAlbumId: 'al9', plays: 50, rgid: '', title: 'Chaise Longue' },
            2,
        ),
        {
            imageId: 'al9',
            imageRgid: null,
            linked: true,
            subtitle: 'Wet Leg · 50 plays',
            title: '2. Chaise Longue',
        },
    );
    assert.equal(
        trackCardView({ artist: 'A', ndAlbumId: '', plays: 1, rgid: '', title: 'T' }, 1).imageId,
        null,
    );
});

test('L6 history row view: title, artist and album, cover id or none', () => {
    const row = {
        artist: 'Joji',
        ndAlbumId: 'al3',
        release: 'Piss In The Wind',
        track: 'Glimpse of Us',
    };
    assert.deepEqual(recentRowView(row), {
        imageId: 'al3',
        subtitle: 'Joji · Piss In The Wind',
        title: 'Glimpse of Us',
    });
    assert.deepEqual(recentRowView({ ...row, ndAlbumId: '', release: '' }), {
        imageId: null,
        subtitle: 'Joji',
        title: 'Glimpse of Us',
    });
});

test('periodPhrase: the reason line of a ranking names the period it covers', () => {
    assert.equal(periodPhrase('7d'), 'in the last 7 days');
    assert.equal(periodPhrase('30d'), 'in the last 30 days');
    assert.equal(periodPhrase('90d'), 'in the last 90 days');
    assert.equal(periodPhrase('365d'), 'in the last year');
    assert.equal(periodPhrase('all'), 'of all time');
});

test('finding 3: a ranking album/track the library lacks shows its Cover Art Archive cover by rgid; artists keep the placeholder', () => {
    const unowned = { artist: 'A', ndAlbumId: '', owned: false, plays: 3, rgid: 'rg9', title: 'T' };
    assert.equal(albumCardView(unowned, 1).imageRgid, 'rg9');
    assert.equal(albumCardView(unowned, 1).imageId, null);
    // a library id always wins: no external image for an album the library holds
    assert.equal(albumCardView({ ...unowned, ndAlbumId: 'al1', owned: true }, 1).imageRgid, null);
    assert.equal(
        trackCardView({ artist: 'A', ndAlbumId: '', plays: 1, rgid: 'rg9', title: 'T' }, 1)
            .imageRgid,
        'rg9',
    );
    // nothing to ask for without an rgid
    assert.equal(albumCardView({ ...unowned, rgid: '' }, 1).imageRgid, null);
    assert.equal(
        artistCardView({ mbid: 'm', name: 'X', ndArtistId: '', plays: 1 }, 1).imageRgid,
        null,
    );
});

test('finding 2: a card links only where it has somewhere to go', () => {
    const base = { artist: 'A', ndAlbumId: '', owned: false, plays: 1, rgid: '', title: 'T' };
    // no library id and no rgid: nowhere
    assert.equal(albumCardView(base, 1).linked, false);
    // owned but Navidrome has no id yet: plain, as the old rows were
    assert.equal(albumCardView({ ...base, owned: true }, 1).linked, false);
    assert.equal(albumCardView({ ...base, rgid: 'rg1' }, 1).linked, true);
    assert.equal(albumCardView({ ...base, ndAlbumId: 'al1', owned: true }, 1).linked, true);
    assert.equal(
        trackCardView({ artist: 'A', ndAlbumId: '', plays: 1, rgid: '', title: 'T' }, 1).linked,
        false,
    );
    assert.equal(
        trackCardView({ artist: 'A', ndAlbumId: '', plays: 1, rgid: 'rg1', title: 'T' }, 1).linked,
        true,
    );
    // an artist with neither a library id nor an MBID goes nowhere
    assert.equal(
        artistCardView({ mbid: '', name: 'X', ndArtistId: '', plays: 1 }, 1).linked,
        false,
    );
    assert.equal(
        artistCardView({ mbid: 'm', name: 'X', ndArtistId: '', plays: 1 }, 1).linked,
        true,
    );
    assert.equal(
        artistCardView({ mbid: '', name: 'X', ndArtistId: 'ar1', plays: 1 }, 1).linked,
        true,
    );
});

// --- item 7: which song a history row's context menu is for ------------------------------

const song = (id: string, name: string, mbzRecordingId: null | string = null) => ({
    id,
    mbzRecordingId,
    name,
});

test('item 7 matchSongByTitle: an exact title is that song', () => {
    const songs = [song('s1', 'Glimpse of Us'), song('s2', 'Slow Dancing in the Dark')];
    assert.equal(matchSongByTitle({ recordingMbid: '', track: 'Glimpse of Us' }, songs), 's1');
});

test('item 7 matchSongByTitle: case and punctuation do not matter', () => {
    const songs = [song('s1', "Don't Look Back In Anger"), song('s2', 'Wonderwall')];
    assert.equal(
        matchSongByTitle({ recordingMbid: '', track: 'dont look back in anger!' }, songs),
        's1',
    );
    assert.equal(matchSongByTitle({ recordingMbid: '', track: 'WONDERWALL' }, songs), 's2');
});

test('item 7 matchSongByTitle: two tracks with one title is no guess', () => {
    const songs = [song('s1', 'Intro'), song('s2', 'Intro'), song('s3', 'Other')];
    assert.equal(matchSongByTitle({ recordingMbid: '', track: 'Intro' }, songs), null);
});

test("item 7 matchSongByTitle: the recording id decides when the app's song carries one", () => {
    const songs = [song('s1', 'Intro', 'rec-a'), song('s2', 'Intro', 'rec-b')];
    assert.equal(matchSongByTitle({ recordingMbid: 'rec-b', track: 'Intro' }, songs), 's2');
    // a recording id nobody carries falls back to the title, which is ambiguous here
    assert.equal(matchSongByTitle({ recordingMbid: 'rec-z', track: 'Intro' }, songs), null);
});

test('item 7 matchSongByTitle: nothing matching, an empty title or no songs is null', () => {
    assert.equal(matchSongByTitle({ recordingMbid: '', track: 'Nope' }, [song('s1', 'Yes')]), null);
    assert.equal(matchSongByTitle({ recordingMbid: '', track: '' }, [song('s1', '')]), null);
    assert.equal(matchSongByTitle({ recordingMbid: '', track: 'X' }, []), null);
});

test('item 7 historyMenuTarget: the song when matched, else the album, else the artist, else none', () => {
    const ids = { ndAlbumId: 'al1', ndArtistId: 'ar1' };
    assert.deepEqual(historyMenuTarget(ids, 's1'), { id: 's1', kind: 'song' });
    assert.deepEqual(historyMenuTarget(ids, null), { id: 'al1', kind: 'album' });
    assert.deepEqual(historyMenuTarget({ ndAlbumId: '', ndArtistId: 'ar1' }, null), {
        id: 'ar1',
        kind: 'artist',
    });
    assert.deepEqual(historyMenuTarget({ ndAlbumId: '', ndArtistId: '' }, null), { kind: 'none' });
    // a matched song is only ever possible through the album; never acted on without one
    assert.deepEqual(historyMenuTarget({ ndAlbumId: '', ndArtistId: 'ar1' }, 's1'), {
        id: 'ar1',
        kind: 'artist',
    });
});
