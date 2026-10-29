import assert from 'node:assert/strict';
import test from 'node:test';

import type { FitColumn } from './fit-column-widths.ts';

import {
    columnMinWidth,
    fitColumnWidths,
    MIN_SCALE,
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
        assert.ok(widths[i] >= column.width * MIN_SCALE, `${column.id} ${widths[i]}`);
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
    assert.equal(columnMinWidth(col('album', 300), 1000), 300 * MIN_SCALE);
    assert.equal(columnMinWidth(col('userRating', 100), 1000), RATING_MIN_WIDTH);
});
