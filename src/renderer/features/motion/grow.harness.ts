import assert from 'node:assert/strict';
import test from 'node:test';

import { GROW_MS, GROW_MS_TALL, GROW_TALL_PX, growMs, growTarget } from './grow.ts';

/**
 * F7: the request box follows its content's height in 300 ms, 450 ms when tall.
 *
 *     node --test src/renderer/features/motion/grow.harness.ts
 */

test('the duration follows the height', () => {
    assert.equal(GROW_MS, 300);
    assert.equal(GROW_MS_TALL, 450);
    assert.equal(GROW_TALL_PX, 240);
    assert.equal(growMs(120), 300);
    assert.equal(growMs(240), 300);
    assert.equal(growMs(241), 450);
});

test('when the box animates', () => {
    assert.deepEqual(growTarget(100, 100, false), { animate: false, ms: 0 });
    assert.deepEqual(growTarget(0, 180, false), { animate: false, ms: 0 });
    assert.deepEqual(growTarget(120, 180, true), { animate: false, ms: 0 });
    assert.deepEqual(growTarget(120, 180, false), { animate: true, ms: 300 });
    assert.deepEqual(growTarget(120, 300, false), { animate: true, ms: 450 });
    assert.deepEqual(growTarget(300, 120, false), { animate: true, ms: 450 });
});
