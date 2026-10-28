import assert from 'node:assert/strict';
import test from 'node:test';

import { aboutRow } from './album-page-layout.ts';

/**
 * R3 Task 2: the owned album page's About row (board `.two`). Both sides with content is the
 * two-column grid, one side is one column, neither is nothing, and a pending About keeps its
 * left column so the tracklist does not jump when the text lands.
 *
 *     node --test src/renderer/features/albums/album-page-layout.harness.ts
 */

const none = { aboutLoading: false, hasAbout: false, linkCount: 0, tagCount: 0 };

test('emptyAboutRowRendersNothing: no About, no tags, no links', () => {
    assert.equal(aboutRow(none), 'none');
});

test('aboutOnly: About text and nothing on the side', () => {
    assert.equal(aboutRow({ ...none, hasAbout: true }), 'about-only');
});

test('sideOnly: tags without About', () => {
    assert.equal(aboutRow({ ...none, tagCount: 2 }), 'side-only');
    assert.equal(aboutRow({ ...none, linkCount: 1 }), 'side-only');
});

test('two: About beside tags or links', () => {
    assert.equal(aboutRow({ ...none, hasAbout: true, tagCount: 3 }), 'two');
    assert.equal(aboutRow({ ...none, hasAbout: true, linkCount: 2 }), 'two');
});

test('loadingKeepsTheLeftColumn: a pending About holds the left column', () => {
    assert.equal(aboutRow({ ...none, aboutLoading: true, tagCount: 2 }), 'two');
    assert.equal(aboutRow({ ...none, aboutLoading: true }), 'about-only');
});
