import assert from 'node:assert/strict';
import test from 'node:test';

import { tintHues } from './tint-hues.ts';

/**
 * F5:  node --test src/shared/components/animations/tint-hues.harness.ts
 *
 * A cover's placeholder tint: two hues from the item, stable, spread over the wheel, 40 to 100 degrees apart.
 */

const seeds = [
    ...Array.from({ length: 900 }, (_, i) => String(i)),
    ...Array.from({ length: 50 }, (_, i) => `al-${i * 7 + 3}`),
    ...Array.from({ length: 50 }, (_, i) => `song-${i * 131 + 4567}`),
];

test('theSameSeedGivesTheSamePair', () => {
    assert.deepEqual(tintHues('al-123'), tintHues('al-123'));
    assert.deepEqual(tintHues('song-4567'), tintHues('song-4567'));
});

test('huesAreIntegersOnTheWheelAndApart', () => {
    for (const s of seeds) {
        const [a, b] = tintHues(s);
        assert.ok(Number.isInteger(a) && a >= 0 && a <= 359, `${s}: ${a}`);
        assert.ok(Number.isInteger(b) && b >= 0 && b <= 359, `${s}: ${b}`);
        const gap = (((b - a) % 360) + 360) % 360;
        assert.ok(gap >= 40 && gap <= 100, `${s}: gap ${gap}`);
    }
});

test('firstHuesSpreadOverTheWheel', () => {
    const buckets = Array.from({ length: 12 }, () => 0);
    for (const s of seeds) buckets[Math.floor(tintHues(s)[0] / 30)] += 1;
    console.log('buckets', buckets.join(' '));
    assert.ok(buckets.every((n) => n > 0));
    assert.ok(buckets.every((n) => n <= seeds.length * 0.2));
});

test('shortSeedsAreValid', () => {
    for (const s of ['', 'a']) {
        const [a, b] = tintHues(s);
        assert.ok(a >= 0 && a <= 359 && b >= 0 && b <= 359);
    }
});
