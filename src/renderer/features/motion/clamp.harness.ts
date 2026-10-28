import assert from 'node:assert/strict';
import test from 'node:test';

import { ABOUT_LINES, clampFolds, clampHeight, lineHeightPx } from './clamp.ts';

/**
 * R13 (B-243): the About text folds to whole lines, with an arrow only when it runs past them.
 *
 *     node --test src/renderer/features/motion/clamp.harness.ts
 */

test('one line count on every page', () => {
    assert.equal(ABOUT_LINES, 5);
});

test('the line height in pixels', () => {
    assert.equal(lineHeightPx('24.8px', '16px'), 24.8);
    assert.equal(lineHeightPx('normal', '14px'), 14 * 1.55);
    assert.equal(lineHeightPx('normal', ''), 0);
});

test('folded height: whole lines', () => {
    // The artist page: five lines of 16 px / 1.55 (the old 124 px).
    assert.equal(clampHeight({ lineHeight: 24.8, lines: 5 }), 124);
    assert.equal(clampHeight({ lineHeight: 0, lines: 5 }), 0);
});

test('a text folds only when it runs past the folded height', () => {
    assert.equal(clampFolds(124, 124), false);
    assert.equal(clampFolds(124.8, 124), false);
    assert.equal(clampFolds(150, 124), true);
    // Not measured yet: no arrow, no clamp.
    assert.equal(clampFolds(300, 0), false);
});
