import assert from 'node:assert/strict';
import test from 'node:test';

import { nextPlayedUniqueId, shouldSkipUnplayedSeekReport } from './scrobble-gate.ts';

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

test('auto-advance while PLAYING stamps the new item; a later paused seek is reported', () => {
    const played = nextPlayedUniqueId({
        currentUniqueId: 'b',
        isPlaying: true,
        playedUniqueId: 'a',
    });
    assert.equal(played, 'b');
    assert.equal(
        shouldSkipUnplayedSeekReport({
            currentUniqueId: 'b',
            isPlaying: false,
            playedUniqueId: played,
        }),
        false,
    );
});

test('fresh paused adopt does not stamp; its seek is skipped', () => {
    const played = nextPlayedUniqueId({
        currentUniqueId: 'b',
        isPlaying: false,
        playedUniqueId: 'a',
    });
    assert.equal(played, 'a');
    assert.equal(
        shouldSkipUnplayedSeekReport({
            currentUniqueId: 'b',
            isPlaying: false,
            playedUniqueId: played,
        }),
        true,
    );
});
