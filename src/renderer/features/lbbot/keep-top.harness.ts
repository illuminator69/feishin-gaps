import assert from 'node:assert/strict';
import test from 'node:test';

import { albumBoxKey, albumBoxShrinks, gapBoxShrinks, scrollToKeepTop } from './keep-top.ts';

/**
 * R12 (B-236): after Request the lb-bot boxes swap a tall view for a short one while the page keeps
 * its scroll, so the box's top can land under the sticky bar. The scroll that brings it back, and
 * which view changes ask for it.
 *
 *     node --test src/renderer/features/lbbot/keep-top.harness.ts
 */

test('inViewIsNull', () => {
    assert.equal(scrollToKeepTop({ barBottom: 117, boxTop: 400, gap: 8 }), null);
});

test('underBarScrollsUp', () => {
    // The workstation's numbers: box top 35 against the bar's bottom 147.
    assert.equal(scrollToKeepTop({ barBottom: 147, boxTop: 35, gap: 8 }), -120);
    // Scrolled far past it: the top is above the window.
    assert.equal(scrollToKeepTop({ barBottom: 117, boxTop: -600, gap: 8 }), -725);
});

test('exactlyAtLineIsNull', () => {
    assert.equal(scrollToKeepTop({ barBottom: 117, boxTop: 125, gap: 8 }), null);
    assert.equal(scrollToKeepTop({ barBottom: 117, boxTop: 124.6, gap: 8 }), null);
});

test('gapApplied', () => {
    assert.equal(scrollToKeepTop({ barBottom: 117, boxTop: 117, gap: 8 }), -8);
    assert.equal(scrollToKeepTop({ barBottom: 117, boxTop: 117, gap: 0 }), null);
    assert.equal(scrollToKeepTop({ barBottom: 117, boxTop: 100, gap: 20 }), -37);
});

test('gapBoxShrinksOnlyAfterTheUsersOwnStep', () => {
    assert.equal(gapBoxShrinks('sources', 'active'), true);
    assert.equal(gapBoxShrinks('active', 'done'), true);
    assert.equal(gapBoxShrinks('active', 'fold'), true);
    assert.equal(gapBoxShrinks('active', 'failed'), true);
    assert.equal(gapBoxShrinks('done', 'fold'), true);
    assert.equal(gapBoxShrinks('done', 'absent'), true);
    // The first read landing, or the user opening something: never moves the page.
    assert.equal(gapBoxShrinks('loading', 'fold'), false);
    assert.equal(gapBoxShrinks('fold', 'sources'), false);
    assert.equal(gapBoxShrinks('failed', 'sources'), false);
    assert.equal(gapBoxShrinks('active', 'active'), false);
});

test('albumBoxShrinksOnlyAfterTheUsersOwnStep', () => {
    assert.equal(albumBoxShrinks('sources', 'fill-active'), true);
    assert.equal(albumBoxShrinks('fill-active', 'fill-inLibrary'), true);
    assert.equal(albumBoxShrinks('fill-active', 'fill-failed'), true);
    assert.equal(albumBoxShrinks('fill-inLibrary', 'none'), true);
    assert.equal(albumBoxShrinks('none', 'sources'), false);
    assert.equal(albumBoxShrinks('fill-failed', 'sources'), false);
    assert.equal(albumBoxShrinks('fill-active', 'fill-active'), false);
});

test('albumBoxKeyCountsSyncingAsActive', () => {
    assert.equal(albumBoxKey('fill', 'syncing'), 'fill-active');
    assert.equal(albumBoxKey('fill', 'inLibrary'), 'fill-inLibrary');
    assert.equal(albumBoxKey('sources', 'none'), 'sources');
    assert.equal(
        albumBoxShrinks(albumBoxKey('fill', 'active'), albumBoxKey('fill', 'syncing')),
        false,
    );
});
