import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { transportSpan } from './seek-row.ts';

/**
 * R6 Task 4 (B-211):  node --test src/renderer/features/player/components/seek-row.harness.ts
 *
 * The owner: shrink the progress slider "so that it looks centered, along with the elements above
 * it". The seek row is as wide as the transport's buttons, outer edge to outer edge, and centred on
 * the play button (the centre column centres it, and the two time columns are the same width).
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('spanIsOuterEdgeToOuterEdge', () => {
    // 1440 x 900 on the VM: shuffle, previous | play | next, repeat, shuffle all.
    const buttons = [
        { left: 614, right: 646 },
        { left: 654, right: 686 },
        { left: 698, right: 742 },
        { left: 754, right: 786 },
        { left: 794, right: 826 },
        { left: 838, right: 870 },
    ];
    assert.equal(transportSpan(buttons), 256);
    // Order does not matter, hidden buttons (zero boxes) do not count.
    assert.equal(transportSpan([...buttons].reverse().concat({ left: 0, right: 0 })), 256);
    assert.equal(transportSpan([]), null);
});

test('rowTakesTheSpanAndFixedTimeColumns', () => {
    const css = read('./playerbar-slider.module.css');
    const row = css.slice(
        css.indexOf('.slider-container {'),
        css.indexOf('\n}', css.indexOf('.slider-container {')),
    );
    assert.match(row, /width: var\(--transport-width, 100%\);/);
    assert.match(
        row,
        /grid-template-columns: var\(--slider-value-width\) minmax\(0, 1fr\) var\(--slider-value-width\);/,
    );
    assert.match(css, /font-variant-numeric: tabular-nums;/);

    const tsx = read('./center-controls.tsx');
    assert.ok(tsx.includes("'--transport-width'"));
    assert.ok(tsx.includes('new ResizeObserver'));
});
