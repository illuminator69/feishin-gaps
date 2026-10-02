import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldSkipUnplayedSeekReport } from './scrobble-gate.ts';

/**
 * Q-041:  node --test src/renderer/features/player/hooks/scrobble-gate.harness.ts
 */

test('paused fresh adopt (never played) is skipped', () => {
    assert.equal(
        shouldSkipUnplayedSeekReport({
            currentUniqueId: 'a',
            isPlaying: false,
            playedUniqueId: undefined,
        }),
        true,
    );
});

test('paused after having played is reported', () => {
    assert.equal(
        shouldSkipUnplayedSeekReport({
            currentUniqueId: 'a',
            isPlaying: false,
            playedUniqueId: 'a',
        }),
        false,
    );
});

test('playing is always reported', () => {
    assert.equal(
        shouldSkipUnplayedSeekReport({
            currentUniqueId: 'a',
            isPlaying: true,
            playedUniqueId: undefined,
        }),
        false,
    );
});

test('same track id, new _uniqueId after a reload, paused: skipped', () => {
    assert.equal(
        shouldSkipUnplayedSeekReport({
            currentUniqueId: 'b',
            isPlaying: false,
            playedUniqueId: 'a',
        }),
        true,
    );
});
