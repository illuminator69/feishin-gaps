import assert from 'node:assert/strict';
import test from 'node:test';

import { hasOtherArtists, visibleTracks } from './artist-track-list-model.ts';

/**
 * The artist page's compact track list (R10): how many rows show, and which toggle sits under them.
 *
 *     node --test src/renderer/features/artists/artist-track-list-model.harness.ts
 */

const songs = (count: number) => Array.from({ length: count }, (_, i) => `s${i + 1}`);

test('foldedShowsFive', () => {
    const view = visibleTracks({ expanded: false, initial: 5, max: 10, songs: songs(12) });
    assert.deepEqual(view.rows, ['s1', 's2', 's3', 's4', 's5']);
    assert.equal(view.toggle, 'more');
});

test('expandedShowsTen', () => {
    const view = visibleTracks({ expanded: true, initial: 5, max: 10, songs: songs(10) });
    assert.equal(view.rows.length, 10);
    assert.equal(view.toggle, 'less');
});

test('fewerThanFiveShowsAllAndNoToggle', () => {
    for (const expanded of [false, true]) {
        const view = visibleTracks({ expanded, initial: 5, max: 10, songs: songs(3) });
        assert.deepEqual(view.rows, ['s1', 's2', 's3']);
        assert.equal(view.toggle, null);
    }
    const exactlyFive = visibleTracks({ expanded: false, initial: 5, max: 10, songs: songs(5) });
    assert.equal(exactlyFive.rows.length, 5);
    assert.equal(exactlyFive.toggle, null);
});

test('moreThanMaxCapsAtMax', () => {
    const view = visibleTracks({ expanded: true, initial: 5, max: 10, songs: songs(50) });
    assert.deepEqual(view.rows, songs(10));
    assert.equal(view.toggle, 'less');

    const seven = visibleTracks({ expanded: true, initial: 5, max: 10, songs: songs(7) });
    assert.equal(seven.rows.length, 7);
    assert.equal(seven.toggle, 'less');
});

test('secondLineOnlyWithOtherArtists', () => {
    assert.equal(hasOtherArtists([{ id: 'a' }], 'a'), false);
    assert.equal(hasOtherArtists([], 'a'), false);
    assert.equal(hasOtherArtists([{ id: 'a' }, { id: 'b' }], 'a'), true);
    assert.equal(hasOtherArtists([{ id: 'b' }], 'a'), true);
    // No page artist (a list outside an artist page): any credit is worth a line.
    assert.equal(hasOtherArtists([{ id: 'a' }], undefined), true);
});
