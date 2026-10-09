import assert from 'node:assert/strict';
import test from 'node:test';

import { pollStart, pollStep } from './album-override.ts';
import {
    decideMergeLeave,
    defaultKeep,
    describeMergeFailure,
    MERGE_SPEC,
    mergeOutcomeSentence,
    planMerge,
    previewSentence,
    siblingGroupFor,
    UNDO_SPEC,
} from './artist-merge.ts';

/**
 * I-023: "Merge into one name" - which group an artist is in, which name is kept
 * by default, the merge and undo polls, and where to go when the spelling that was
 * rewritten was the page being shown.
 *
 *     node --test src/renderer/features/lbbot/utils/artist-merge.harness.ts
 */

const GROUPS = [
    {
        artists: [
            { albums: 7, name: 'Belle & Sebastian', ndArtistId: 'a' },
            { albums: 2, name: 'Belle and Sebastian', ndArtistId: 'b' },
            { albums: 1, name: 'Belle & Sebastian.', ndArtistId: 'c' },
        ],
        mbid: 'mb',
    },
];

test('siblingGroupFor: the group holding the artist; null when unknown, absent or alone', () => {
    assert.equal(siblingGroupFor(GROUPS, 'b')?.mbid, 'mb');
    assert.equal(siblingGroupFor(GROUPS, 'zzz'), null);
    // absent (null) and none ([]) both mean no merge block, but never throw
    assert.equal(siblingGroupFor(null, 'a'), null);
    assert.equal(siblingGroupFor([], 'a'), null);
    assert.equal(siblingGroupFor(GROUPS, ''), null);
});

test('defaultKeep: the spelling with the most albums, first on a tie', () => {
    assert.equal(defaultKeep(GROUPS[0].artists), 'a');
    assert.equal(
        defaultKeep([
            { albums: 3, name: 'x', ndArtistId: 'p' },
            { albums: 3, name: 'y', ndArtistId: 'q' },
        ]),
        'p',
    );
    assert.equal(
        defaultKeep([
            { albums: 1, name: 'x', ndArtistId: 'p' },
            { albums: 5, name: 'y', ndArtistId: 'q' },
        ]),
        'q',
    );
    assert.equal(defaultKeep([]), '');
});

test('planMerge: nd_id is the kept name, from_nd_id the rewritten one', () => {
    assert.deepEqual(planMerge('a', 'b', 'a'), { fromNdId: 'b', ndId: 'a' });
    assert.deepEqual(planMerge('a', 'b', 'b'), { fromNdId: 'a', ndId: 'b' });
    assert.equal(planMerge('a', 'a', 'a'), null);
    assert.equal(planMerge('a', 'b', 'c'), null);
    assert.equal(planMerge('', 'b', 'b'), null);
});

test('previewSentence: N files in M albums, singular aware', () => {
    assert.equal(previewSentence(31, 3), '31 files in 3 albums');
    assert.equal(previewSentence(1, 1), '1 file in 1 album');
});

const row = (state: string, extra: object = {}) => ({
    done: 0,
    failures: [],
    from: { name: 'F' },
    id: 'm',
    into: { name: 'I', ndArtistId: 'i' },
    mbid: 'mb',
    setAt: 1,
    state,
    total: 5,
    ...extra,
});

test('merge poll: merging continues, merged and failed are terminal', () => {
    const start = pollStart(MERGE_SPEC, 0);
    assert.equal(
        pollStep(start, { ok: true, row: row('merging', { done: 2 }) }, 2000).phase,
        'polling',
    );
    assert.equal(pollStep(start, { ok: true, row: row('merged') }, 2000).phase, 'settled');
    assert.equal(pollStep(start, { ok: true, row: row('failed') }, 2000).phase, 'failed');
});

test('merge poll: a failed poll is not an answer; a coded no_merge means the row is gone', () => {
    const start = pollStart(MERGE_SPEC, 0);
    assert.equal(pollStep(start, { code: '', ok: false, status: 0 }, 2000).phase, 'polling');
    assert.equal(pollStep(start, { code: '', ok: false, status: 404 }, 2000).phase, 'polling');
    assert.equal(pollStep(start, { code: 'no_merge', ok: false, status: 404 }, 2000).phase, 'gone');
});

test('undo poll: 404 no_merge is the finish; merged/failed before undoing was seen keeps polling', () => {
    const start = pollStart(UNDO_SPEC, 0);
    assert.equal(
        pollStep(start, { code: 'no_merge', ok: false, status: 404 }, 2000).phase,
        'settled',
    );
    assert.equal(pollStep(start, { ok: true, row: row('merged') }, 2000).phase, 'polling');
    let s = pollStep(start, { ok: true, row: row('undoing') }, 2000);
    s = pollStep(s, { ok: true, row: row('failed') }, 4000);
    assert.equal(s.phase, 'failed');
});

test('both polls give up after three minutes', () => {
    assert.equal(
        pollStep(pollStart(MERGE_SPEC, 0), { ok: true, row: row('merging') }, 180_000).phase,
        'timeout',
    );
    assert.equal(
        pollStep(pollStart(UNDO_SPEC, 0), { ok: true, row: row('undoing') }, 180_000).phase,
        'timeout',
    );
});

test('decideMergeLeave: only off the rewritten artist, to the kept one', () => {
    assert.deepEqual(
        decideMergeLeave({ fromNdId: 'b', intoNdId: 'a', pathname: '/library/album-artists/b' }),
        { id: 'a', kind: 'artist' },
    );
    assert.deepEqual(
        decideMergeLeave({ fromNdId: 'b', intoNdId: 'a', pathname: '/library/album-artists/a' }),
        { kind: 'stay' },
    );
    assert.deepEqual(
        decideMergeLeave({ fromNdId: 'b', intoNdId: 'a', pathname: '/library/album-artists/bb' }),
        { kind: 'stay' },
    );
    assert.deepEqual(
        decideMergeLeave({ fromNdId: 'b', intoNdId: '', pathname: '/library/album-artists/b' }),
        {
            kind: 'stay',
        },
    );
});

test('describeMergeFailure: older, lb-bot own text for coded answers, retry for 502', () => {
    assert.equal(describeMergeFailure({ error: 'x', status: 405 }).kind, 'older');
    assert.equal(describeMergeFailure({ error: 'x', status: 404 }).kind, 'older');
    const different = describeMergeFailure({
        code: 'different_artists',
        error: 'Not the same artist.',
        status: 409,
    });
    assert.equal(different.kind, 'answer');
    assert.equal(different.message, 'Not the same artist.');
    assert.equal(
        describeMergeFailure({ code: 'unknown_artist', error: 'Gone.', status: 404 }).message,
        'Gone.',
    );
    assert.equal(
        describeMergeFailure({ code: 'busy', error: 'Fill running.', status: 409 }).message,
        'Fill running.',
    );
    assert.equal(
        describeMergeFailure({ error: 'MB down.', retryable: true, status: 502 }).kind,
        'retry',
    );
});

test('mergeOutcomeSentence: states only what the row says', () => {
    assert.equal(
        mergeOutcomeSentence('merge', row('merged', { done: 5 })),
        'lb-bot retagged 5 files.',
    );
    assert.match(
        mergeOutcomeSentence(
            'merge',
            row('merged', { done: 4, failures: [{ album: 'a', reason: 'r', title: 't' }] }),
        ),
        /4 of 5 files; 1 could not be written/,
    );
    assert.match(mergeOutcomeSentence('merge', row('failed', { done: 1 })), /did not finish/);
    assert.equal(mergeOutcomeSentence('undo', null), 'lb-bot put the previous names back.');
});
