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

test('folded height: whole lines, or more whole lines when there is room beside it', () => {
    // The artist page: five lines of 16 px / 1.55 (the old 124 px).
    assert.equal(clampHeight({ lineHeight: 24.8, lines: 5 }), 124);
    // Beside a column shorter than five lines: still five.
    assert.equal(clampHeight({ fillPx: 60, lineHeight: 21.7, lines: 5 }), 5 * 21.7);
    // Beside a 250 px column: eleven whole lines (238.7), never a half line.
    assert.equal(clampHeight({ fillPx: 250, lineHeight: 21.7, lines: 5 }), 11 * 21.7);
    // A fill a subpixel short of a whole line still counts that line.
    assert.equal(clampHeight({ fillPx: 6 * 21.7 - 0.5, lineHeight: 21.7, lines: 5 }), 6 * 21.7);
    assert.equal(clampHeight({ fillPx: -40, lineHeight: 20, lines: 5 }), 100);
    assert.equal(clampHeight({ lineHeight: 0, lines: 5 }), 0);
});

test('a text folds only when it runs past the folded height', () => {
    assert.equal(clampFolds(124, 124), false);
    assert.equal(clampFolds(124.8, 124), false);
    assert.equal(clampFolds(150, 124), true);
    // Not measured yet: no arrow, no clamp.
    assert.equal(clampFolds(300, 0), false);
});
