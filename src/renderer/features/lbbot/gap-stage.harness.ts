import type { LbBotGapSource, LbBotGapTask, LbBotGapTrackState } from '/@/shared/types/lbbot-types';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
    GAP_RESULT_HOLD_MS,
    gapFillLanded,
    type GapFillRow,
    type GapInput,
    type GapRecord,
    gapStage,
    heldTracks,
} from './gap-stage.ts';
import { currentStep } from './request-steps.ts';

/**
 * R11 (B-223): which state the album page's gaps box is in, ported case for case from Navic's
 * `GapStageTest`. A transfer in flight beats everything; a finished fill shows its result for a few
 * seconds and then the box goes; files waiting on lb-bot's workspace are their own state; the
 * sources view searches, chooses or says nothing was found; a failed fill keeps the box open;
 * otherwise it is the user's fold.
 *
 *     node --test src/renderer/features/lbbot/gap-stage.harness.ts
 */

const track = (position: number, state: LbBotGapTrackState, disc = 1) => ({
    disc,
    downloadError: '',
    position,
    state,
    title: `T${position}`,
});

const task = (status: string): LbBotGapTask => ({
    current: '',
    error: '',
    id: 't',
    label: '',
    status,
    summary: '',
});

const gap = (over: Partial<GapRecord> = {}): GapRecord => {
    const tracks = over.tracks ?? [
        track(1, 'present'),
        track(2, 'present'),
        track(3, 'missing'),
        track(4, 'missing'),
    ];
    return {
        failDetail: '',
        mp3WouldHelp: false,
        noSourceReason: '',
        sources: [],
        sourceTask: null,
        stalledPlacement: false,
        status: 'ready',
        ...over,
        present: tracks.filter((t) => t.state === 'present').length,
        total: tracks.length,
        tracks,
    };
};

const fill = (outcome: string, over: Partial<GapFillRow> = {}): GapFillRow => ({
    done: 2,
    finishedAt: 0,
    mp3WouldHelp: false,
    outcome,
    reason: "lb-bot's own words",
    settled: true,
    total: 2,
    ...over,
});

const input = (over: Partial<GapInput> = {}): GapInput => ({
    committed: false,
    fill: null,
    gap: gap(),
    mirroredMissing: 2,
    now: 100_000,
    searchAsked: false,
    view: 'folded',
    ...over,
});

const source = (over: Partial<LbBotGapSource> = {}): LbBotGapSource => ({
    albumMatch: 1,
    albumMatchOk: true,
    artistVerified: true,
    bitrate: '',
    coverage: '',
    coverageDetail: { haveTracks: 2, totalTracks: 2, unmatched: [] },
    coverageFull: true,
    fileCount: 2,
    files: [],
    filesTruncated: false,
    flags: [],
    folder: 'f',
    format: 'FLAC',
    freeSlot: true,
    id: 0,
    peer: 'p',
    queueLength: 0,
    rank: 1,
    recommendation: '',
    recommended: true,
    score: 1,
    size: '',
    speedMbps: 0,
    ...over,
});

const good = source();
const unverified = source({ artistVerified: false, id: 1, peer: 'q' });

test('beforeLbBotAnswersTheMirrorCountFoldsAndAnOpenBoxWaits', () => {
    assert.deepEqual(gapStage(input({ gap: null, mirroredMissing: 3 })), {
        kind: 'folded',
        missing: 3,
    });
    assert.deepEqual(gapStage(input({ gap: null, mirroredMissing: 3, view: 'tracks' })), {
        kind: 'loading',
    });
    assert.deepEqual(gapStage(input({ gap: null, mirroredMissing: 0 })), { kind: 'absent' });
});

test('foldedCountsTheTracksStillMissing', () => {
    assert.deepEqual(gapStage(input()), { kind: 'folded', missing: 2 });
});

test('unfoldedListsOnlyTheMissingTracksAgainstTheReleaseLength', () => {
    const stage = gapStage(input({ view: 'tracks' }));
    assert.equal(stage.kind, 'tracks');
    if (stage.kind !== 'tracks') return;
    assert.deepEqual(
        stage.missing.map((t) => t.position),
        [3, 4],
    );
    assert.equal(stage.total, 4);
});

test('aTransferInFlightBeatsTheFoldAndTheSources', () => {
    // Review Focus 1: a fill started on another client shows its steps whatever the box was showing.
    const moving = gap({
        tracks: [track(1, 'present'), track(2, 'done'), track(3, 'downloading')],
    });
    for (const view of ['folded', 'tracks', 'sources'] as const) {
        const stage = gapStage(input({ gap: moving, view }));
        assert.equal(stage.kind, 'active');
        if (stage.kind !== 'active') return;
        assert.equal(stage.done, 1);
        assert.equal(stage.wanted, 2);
    }
    // Over a failed ledger row too.
    assert.equal(gapStage(input({ fill: fill('failed'), gap: moving })).kind, 'active');
});

test('aFetchLbBotAcceptedIsActiveBeforeItsStatusMoves', () => {
    assert.equal(gapStage(input({ committed: true, view: 'sources' })).kind, 'active');
});

test('theStepsFollowTheTracks', () => {
    const now = (...states: LbBotGapTrackState[]) => {
        const stage = gapStage(
            input({
                gap: gap({
                    status: 'downloading',
                    tracks: states.map((state, i) => track(i + 1, state)),
                }),
            }),
        );
        assert.equal(stage.kind, 'active');
        return stage.kind === 'active' ? currentStep(stage.steps) : -1;
    };
    assert.equal(now('present', 'queued', 'queued'), 1);
    assert.equal(now('present', 'downloaded', 'downloading'), 2);
    assert.equal(now('present', 'downloaded', 'downloaded'), 3);
});

test('aFinishedFillShowsItsResultForAFewSecondsThenTheBoxGoes', () => {
    const filled = gap({
        status: 'complete',
        tracks: [track(1, 'present'), track(2, 'done'), track(3, 'done')],
    });
    const done = fill('done', { finishedAt: 100_000 });
    assert.deepEqual(gapStage(input({ fill: done, gap: filled, now: 101_000 })), {
        added: 2,
        kind: 'done',
        present: 1,
        total: 3,
    });
    assert.deepEqual(
        gapStage(input({ fill: done, gap: filled, now: 100_000 + GAP_RESULT_HOLD_MS })),
        { kind: 'absent' },
    );
});

test('aCompleteAlbumHasNoBox', () => {
    const whole = gap({ status: 'complete', tracks: [track(1, 'present'), track(2, 'present')] });
    assert.deepEqual(gapStage(input({ gap: whole, view: 'tracks' })), { kind: 'absent' });
});

test('filesWaitingOnLbBotsWorkspaceAreAttentionWhateverTheView', () => {
    const stalled = gap({
        failDetail: 'Reconcile in lb-bot',
        stalledPlacement: true,
        status: 'failed',
    });
    assert.deepEqual(gapStage(input({ gap: stalled, view: 'sources' })), {
        kind: 'attention',
        reason: 'Reconcile in lb-bot',
    });
    const awaiting = gap({
        status: 'picking',
        tracks: [track(1, 'present'), track(2, 'downloaded'), track(3, 'missing')],
    });
    assert.equal(gapStage(input({ gap: awaiting })).kind, 'attention');
});

test('theSourcesViewSearchesThenChoosesPreselectingOnlyASafeSource', () => {
    assert.deepEqual(gapStage(input({ view: 'sources' })), { kind: 'searching' });
    assert.deepEqual(
        gapStage(input({ gap: gap({ sourceTask: task('running') }), view: 'sources' })),
        { kind: 'searching' },
    );
    assert.deepEqual(
        gapStage(input({ gap: gap({ sources: [good], status: 'picking' }), view: 'sources' })),
        { kind: 'choosing', preselected: 0, sources: [good] },
    );
    // Review Focus 2: no safe source, no card chosen, so no Request button until a tap.
    assert.deepEqual(
        gapStage(
            input({ gap: gap({ sources: [unverified], status: 'picking' }), view: 'sources' }),
        ),
        { kind: 'choosing', preselected: null, sources: [unverified] },
    );
});

test('aSearchTapInFlightSearchesEvenOverOldSources', () => {
    assert.deepEqual(
        gapStage(
            input({
                gap: gap({ sources: [good], status: 'picking' }),
                searchAsked: true,
                view: 'sources',
            }),
        ),
        { kind: 'searching' },
    );
});

test('aSearchThatEndedWithNothingSaysSoWithLbBotsReason', () => {
    const none = gap({
        mp3WouldHelp: true,
        noSourceReason: 'No FLAC',
        sourceTask: task('complete'),
        status: 'picking',
    });
    assert.deepEqual(gapStage(input({ gap: none, view: 'sources' })), {
        kind: 'noSources',
        mp3WouldHelp: true,
        reason: 'No FLAC',
    });
});

test('aFailedFillKeepsTheBoxOpenUntilTheSourcesAreAskedAgain', () => {
    // Review Focus 3: the box stays open saying why, in lb-bot's words.
    const failed = gap({ failDetail: 'The download itself failed', status: 'failed' });
    const entry = fill('failed');
    assert.deepEqual(gapStage(input({ fill: entry, gap: failed })), {
        kind: 'failed',
        mp3WouldHelp: false,
        reason: 'The download itself failed',
    });
    assert.deepEqual(
        gapStage(input({ fill: entry, gap: failed, searchAsked: true, view: 'sources' })),
        { kind: 'searching' },
    );
});

test('aFailedFillShowsOverTheSourcesItWasRequestedFrom', () => {
    const failed = gap({ failDetail: 'The peer went offline', status: 'failed' });
    assert.deepEqual(gapStage(input({ fill: fill('failed'), gap: failed, view: 'sources' })), {
        kind: 'failed',
        mp3WouldHelp: false,
        reason: 'The peer went offline',
    });
});

test('a failed fill with no sentence from lb-bot falls back to the ledger row, and offers MP3 from either', () => {
    const failed = gap({ status: 'failed' });
    assert.deepEqual(
        gapStage(input({ fill: fill('failed', { mp3WouldHelp: true }), gap: failed })),
        { kind: 'failed', mp3WouldHelp: true, reason: "lb-bot's own words" },
    );
});

test('aCancelledFillIsJustTheFold', () => {
    assert.deepEqual(gapStage(input({ fill: fill('cancelled') })), { kind: 'folded', missing: 2 });
});

test('aFillHasLandedOnceItsRowSettlesDoneOrTheAlbumIsWhole', () => {
    const moving = gap({
        status: 'downloading',
        tracks: [track(1, 'present'), track(2, 'downloading')],
    });
    assert.equal(gapFillLanded(moving, fill('done', { settled: false })), false);
    assert.equal(gapFillLanded(gap(), fill('done')), true);
    // Started on another client: no ledger row here, and lb-bot's record says it all.
    assert.equal(gapFillLanded(gap({ status: 'complete' }), null), true);
    assert.equal(
        gapFillLanded(gap({ tracks: [track(1, 'present'), track(2, 'done')] }), null),
        true,
    );
    assert.equal(gapFillLanded(gap(), fill('failed')), false);
});

test('heldTracksCountWhatTheLibraryHasBeforeAndAfterTheFill', () => {
    assert.equal(
        heldTracks(
            gap({
                tracks: [
                    track(1, 'present'),
                    track(2, 'done'),
                    track(3, 'done'),
                    track(4, 'failed'),
                ],
            }),
        ),
        3,
    );
});
