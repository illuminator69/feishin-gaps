import assert from 'node:assert/strict';
import test from 'node:test';

import {
    afterFailedTrack,
    MAX_FAILED_IN_A_ROW,
    MAX_NETWORK_RETRIES,
    replaysSameTrack,
    retryDecision,
    retryStillApplies,
} from './retry-decision.ts';

/**
 * B-138:  node --test src/renderer/features/player/audio-player/engine/retry-decision.harness.ts
 *
 * The Marias "We're the Lucky Ones" failed 2 s before its end with code 4; upstream retried it from
 * 0 five times (about 18 minutes), then paused.
 */

test('aFileTheBrowserCannotOpenIsSkippedNotRetried', () => {
    assert.deepEqual(retryDecision(4, 0, 211.5), { action: 'skip' });
    assert.deepEqual(retryDecision(4, 0, 0), { action: 'skip' });
});

test('aDecodeErrorIsSkippedNotRetried', () => {
    assert.deepEqual(retryDecision(3, 0, 42), { action: 'skip' });
});

test('aNetworkErrorRetriesFromWhereTheTrackWas', () => {
    assert.deepEqual(retryDecision(2, 0, 211.5), { action: 'retry', resumeAt: 211.5 });
    assert.deepEqual(retryDecision(2, MAX_NETWORK_RETRIES - 1, 12), {
        action: 'retry',
        resumeAt: 12,
    });
});

test('aNetworkErrorWithNoUsablePositionRetriesFromTheTop', () => {
    assert.deepEqual(retryDecision(2, 0, Number.NaN), { action: 'retry', resumeAt: 0 });
    assert.deepEqual(retryDecision(2, 0, -1), { action: 'retry', resumeAt: 0 });
    assert.deepEqual(retryDecision(2, 0, Number.POSITIVE_INFINITY), {
        action: 'retry',
        resumeAt: 0,
    });
});

test('networkRetriesAreCappedThenPause', () => {
    assert.deepEqual(retryDecision(2, MAX_NETWORK_RETRIES, 12), { action: 'pause' });
});

test('anAbortOrAnErrorWithNoCodeIsLeftAlone', () => {
    assert.deepEqual(retryDecision(1, 0, 5), { action: 'ignore' });
    assert.deepEqual(retryDecision(undefined, 0, 5), { action: 'ignore' });
});

test('aSkipThatWouldReplayTheFailedTrackPausesInstead', () => {
    assert.equal(afterFailedTrack(1, true), 'pause');
    assert.equal(afterFailedTrack(1, false), 'skip');
});

test('aRunOfFailuresWithNothingHeardPauses', () => {
    assert.equal(afterFailedTrack(MAX_FAILED_IN_A_ROW - 1, false), 'skip');
    assert.equal(afterFailedTrack(MAX_FAILED_IN_A_ROW, false), 'pause');
});

test('theNextAutomaticTrackIsTheSameOneOnlyUnderRepeatOneOrAOneTrackRepeatAll', () => {
    assert.equal(replaysSameTrack('one', 10), true);
    assert.equal(replaysSameTrack('all', 1), true);
    assert.equal(replaysSameTrack('all', 2), false);
    // Repeat off on the last (or only) track stops: no loop.
    assert.equal(replaysSameTrack('none', 1), false);
    assert.equal(replaysSameTrack('none', 10), false);
});

test('aRetryIsDroppedWhenItsElementIsNoLongerThePlayingOne', () => {
    const src = 'https://nd/rest/stream?id=a';
    // Repeat-all over [A, B]: Next during the wait plays B on element 2 and gives element 1 A
    // again, with the same URL. The src matches; the retry must still not run.
    assert.equal(
        retryStillApplies({ failedOn: 1, failedSrc: src, playingNow: 2, srcNow: src }),
        false,
    );
    // Its element was given another track.
    assert.equal(
        retryStillApplies({ failedOn: 1, failedSrc: src, playingNow: 1, srcNow: `${src}b` }),
        false,
    );
    // Same element, still playing, same source: the retry runs.
    assert.equal(
        retryStillApplies({ failedOn: 1, failedSrc: src, playingNow: 1, srcNow: src }),
        true,
    );
});
