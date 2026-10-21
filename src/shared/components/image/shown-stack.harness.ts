import assert from 'node:assert/strict';
import test from 'node:test';

import { dropUnder, markLoaded, showNext } from './shown-stack.ts';

/**
 * F5 review:  node --test src/shared/components/image/shown-stack.harness.ts
 *
 * The images an <img> stack shows while its request changes: the one kept underneath is the last one
 * that loaded, so skipping twice fast (A, B, C) never leaves an empty frame while C loads.
 */

test('theFirstImageStandsAlone', () => {
    assert.deepEqual(showNext([], 'a', true), [{ fade: true, loaded: false, src: 'a' }]);
});

test('aLoadedImageStaysUnderTheNextOne', () => {
    const a = markLoaded(showNext([], 'a', false), 'a');
    assert.deepEqual(showNext(a, 'b', true), [
        { fade: false, loaded: true, src: 'a' },
        { fade: true, loaded: false, src: 'b' },
    ]);
});

test('skippingTwiceKeepsTheLastLoadedOneUnder', () => {
    const a = markLoaded(showNext([], 'a', false), 'a');
    const b = showNext(a, 'b', true);
    assert.deepEqual(
        showNext(b, 'c', true).map((e) => e.src),
        ['a', 'c'],
    );
});

test('theSameSourceChangesNothing', () => {
    const a = showNext([], 'a', false);
    assert.equal(showNext(a, 'a', true), a);
});

test('theOldOneGoesOnlyOnceTheNewOneHasLoaded', () => {
    const a = markLoaded(showNext([], 'a', false), 'a');
    const b = showNext(a, 'b', true);
    assert.equal(dropUnder(b), b);
    assert.deepEqual(dropUnder(markLoaded(b, 'b')), [{ fade: true, loaded: true, src: 'b' }]);
});
