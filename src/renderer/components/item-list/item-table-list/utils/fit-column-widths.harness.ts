import assert from 'node:assert/strict';
import test from 'node:test';

import type { FitColumn } from './fit-column-widths.ts';

import {
    columnMinWidth,
    fitColumnWidths,
    GENERIC_MIN_WIDTH,
    ownWidthForResize,
    RATING_MIN_WIDTH,
    TITLE_MIN_WIDTH,
} from './fit-column-widths.ts';

/**
 * B-264:  node --test src/renderer/components/item-list/item-table-list/utils/fit-column-widths.harness.ts
 *
 * `autoFitColumns` scaled every unpinned column by one factor with no floor, so the Library Tracks
 * table with the side queue docked and the Filters panel open (about 490 px of table at 1440 x 900)
 * drew Title at 98 px (a 56 px cover and two letters), Bitrate at 32 px (its header clipped to
 * "'RA") and Rating at 32 px (five stars, 79 px, drawn over the heart beside it). Now a column
 * never shrinks below its minimum: when the minimums do not fit, the table is wider than its
 * container and scrolls sideways, as a table without autoFit already does.
 */

const col = (id: string, width: number, pinned: FitColumn['pinned'] = null): FitColumn => ({
    id,
    pinned,
    width,
});

// The Library Tracks table's default columns, in order (SONG_TABLE_COLUMNS + F6's Bitrate, Rating).
const TRACKS: FitColumn[] = [
    col('rowIndex', 60),
    col('titleCombined', 300),
    col('duration', 100),
    col('album', 300),
    col('genres', 300),
    col('year', 200),
    col('bitRate', 100),
    col('userFavorite', 60),
    col('userRating', 100),
];

// The side queue's default columns.
const QUEUE: FitColumn[] = [
    col('rowIndex', 60),
    col('titleCombined', 300),
    col('duration', 100),
    col('userFavorite', 60),
];

const sum = (widths: number[]) => widths.reduce((a, b) => a + b, 0);
const at = (columns: FitColumn[], widths: number[], id: string) =>
    widths[columns.findIndex((c) => c.id === id)];

test('titleKeepsItsMinimum', () => {
    for (const container of [400, 490, 600, 790]) {
        const widths = fitColumnWidths(TRACKS, container);
        assert.ok(
            at(TRACKS, widths, 'titleCombined') >= Math.min(TITLE_MIN_WIDTH, container / 2),
            `${container}: ${widths.join(' ')}`,
        );
    }
    assert.ok(at(TRACKS, fitColumnWidths(TRACKS, 490), 'titleCombined') >= TITLE_MIN_WIDTH);
});

test('overflowScrollsInsteadOfCrushing', () => {
    const widths = fitColumnWidths(TRACKS, 490);
    // Wider than the container: the grid scrolls sideways.
    assert.ok(sum(widths) > 490, widths.join(' '));
    TRACKS.forEach((column, i) => {
        assert.ok(widths[i] >= columnMinWidth(column, 490), `${column.id} ${widths[i]}`);
    });
});

test('ratingColumnFitsStars', () => {
    for (const container of [490, 790, 1150]) {
        const widths = fitColumnWidths(TRACKS, container);
        assert.ok(at(TRACKS, widths, 'userRating') >= RATING_MIN_WIDTH, `${container}`);
    }
});

test('whenTheMinimumsFitTheTableFillsItsContainer', () => {
    for (const container of [790, 1150, 1300, 1600, 2400]) {
        assert.equal(sum(fitColumnWidths(TRACKS, container)), container, `${container}`);
    }
});

test('aWideTableKeepsItsProportions', () => {
    // No minimum is reached: the same widths as the plain scale (the album table, a wide window).
    assert.deepEqual(fitColumnWidths(TRACKS, 1600), [63, 316, 105, 316, 316, 211, 105, 63, 105]);
    const album = [col('trackNumber', 50), col('name', 400), col('duration', 100)];
    assert.deepEqual(fitColumnWidths(album, 880), [80, 640, 160]);
});

test('theSideQueueAtItsNarrowestDoesNotScroll', () => {
    // A 250 px panel (constrainRightSidebarWidth's floor) minus the list's 12 px sides.
    for (const container of [226, 336]) {
        const widths = fitColumnWidths(QUEUE, container);
        assert.equal(sum(widths), container, widths.join(' '));
    }
    // Its proportions stay as they were: nothing reaches a minimum there.
    assert.deepEqual(fitColumnWidths(QUEUE, 226), [26, 131, 43, 26]);
});

test('pinnedColumnsKeepTheirWidth', () => {
    const columns = [col('rowIndex', 60, 'left'), ...TRACKS.slice(1)];
    assert.equal(fitColumnWidths(columns, 490)[0], 60);
    assert.equal(fitColumnWidths(columns, 1600)[0], 60);
});

test('anUnmeasuredContainerKeepsTheOwnWidths', () => {
    assert.deepEqual(
        fitColumnWidths(TRACKS, 0),
        TRACKS.map((c) => c.width),
    );
});

test('aMinimumIsNeverMoreThanHalfANarrowTable', () => {
    assert.equal(columnMinWidth(col('titleCombined', 300), 226), 113);
    assert.equal(columnMinWidth(col('titleCombined', 300), 1000), TITLE_MIN_WIDTH);
    assert.equal(columnMinWidth(col('name', 120), 1000), TITLE_MIN_WIDTH);
    assert.equal(columnMinWidth(col('album', 300), 1000), GENERIC_MIN_WIDTH);
    assert.equal(columnMinWidth(col('userRating', 100), 1000), RATING_MIN_WIDTH);
});

/*
 * R15 review I2: the share floor (0.4 of a column's own width, 120 px for a 300 px Album or Genre)
 * reached every autoFit table, so the playlist, Now Playing and full-screen tables scrolled by
 * slivers at ordinary widths. Title and Rating keep their absolute floors; every other column's
 * floor is small and absolute, so a table scrolls only when those do not fit.
 */

// SONG_TABLE_COLUMNS' enabled columns: the playlist's and the Now Playing page's defaults.
const SONG_DEFAULTS: FitColumn[] = [
    col('rowIndex', 60),
    col('titleCombined', 300),
    col('duration', 100),
    col('album', 300),
    col('genres', 300),
    col('year', 200),
    col('userFavorite', 60),
];
// The full-screen player's queue: the same without the row index.
const FULL_SCREEN = SONG_DEFAULTS.slice(1);

test('aGenericColumnsFloorIsSmallAndAbsolute', () => {
    for (const id of ['album', 'genres', 'duration', 'year', 'bitRate']) {
        for (const width of [100, 200, 300]) {
            assert.equal(columnMinWidth(col(id, width), 1000), GENERIC_MIN_WIDTH, `${id} ${width}`);
        }
    }
    // A column narrower than that by default (the index, the heart) keeps its smaller share.
    assert.ok(columnMinWidth(col('rowIndex', 60), 1000) <= GENERIC_MIN_WIDTH);
    assert.ok(columnMinWidth(col('userFavorite', 60), 1000) <= GENERIC_MIN_WIDTH);
});

test('otherAutoFitTablesDoNotScrollAtNarrowWidths', () => {
    const cases: Array<[string, FitColumn[], number]> = [
        ['playlist songs, 1100 x 700 with the queue docked', SONG_DEFAULTS, 450],
        ['the Now Playing page', SONG_DEFAULTS, 600],
        ['the full-screen queue, a narrow window', FULL_SCREEN, 450],
        ['the mobile full-screen player', FULL_SCREEN, 375],
        ['the side queue at its narrowest', QUEUE, 226],
    ];
    for (const [name, columns, container] of cases) {
        const widths = fitColumnWidths(columns, container);
        assert.equal(sum(widths), container, `${name}: ${widths.join(' ')}`);
        // Title still keeps its floor there.
        assert.ok(
            at(columns, widths, 'titleCombined') >= Math.min(TITLE_MIN_WIDTH, container / 2),
            `${name}: ${widths.join(' ')}`,
        );
    }
});

/*
 * R15 review I1: a resize saved the displayed px as the column's own width, which autoFit treats
 * as a proportion, so in the overflow state a drag wider made the column narrower and a click on
 * the handle shrank it. A drag now ends where the user let go: the saved width is the one that
 * fits back to the dragged px.
 */

const resized = (columns: FitColumn[], container: number, id: string, dragged: number) => {
    const index = columns.findIndex((c) => c.id === id);
    const own = ownWidthForResize(columns, container, index, dragged);
    return columns.map((c, i) => (i === index ? { ...c, width: own } : c));
};

test('aResizeInOverflowKeepsTheDraggedWidth', () => {
    // Tracks with the queue docked and Filters open: the floors overflow 340 px.
    const container = 340;
    assert.ok(sum(fitColumnWidths(TRACKS, container)) > container);
    for (const [id, dragged] of [
        ['album', 200],
        ['album', 60],
        ['duration', 90],
        ['titleCombined', 320],
        ['userRating', 120],
        ['genres', 41],
    ] as Array<[string, number]>) {
        const after = resized(TRACKS, container, id, dragged);
        const shown = at(after, fitColumnWidths(after, container), id);
        assert.equal(shown, dragged, `${id} dragged to ${dragged}, shows ${shown}`);
    }
});

test('aResizeInAFittingTableKeepsTheDraggedWidth', () => {
    for (const [container, id, dragged] of [
        [1150, 'album', 300],
        [1150, 'album', 150],
        [1150, 'titleCombined', 400],
        [1600, 'year', 120],
        [790, 'genres', 200],
    ] as Array<[number, string, number]>) {
        const after = resized(TRACKS, container, id, dragged);
        const widths = fitColumnWidths(after, container);
        assert.equal(at(after, widths, id), dragged, `${container} ${id} ${widths.join(' ')}`);
    }
});

test('aDragWiderNeverShowsNarrower', () => {
    for (const container of [340, 490, 790, 1150]) {
        const before = fitColumnWidths(TRACKS, container);
        TRACKS.forEach((column, i) => {
            const wider = resized(TRACKS, container, column.id, before[i] + 30);
            assert.ok(
                at(wider, fitColumnWidths(wider, container), column.id) > before[i],
                `${container} ${column.id}`,
            );
        });
    }
});

test('aPinnedColumnResizesToThePxDragged', () => {
    const columns = [col('rowIndex', 60, 'left'), ...TRACKS.slice(1)];
    assert.equal(ownWidthForResize(columns, 490, 0, 90), 90);
});
