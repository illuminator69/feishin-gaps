import type {
    LbBotGap,
    LbBotGapSource,
    LbBotGapTrack,
    LbBotGapTrackState,
} from '/@/shared/types/lbbot-types';

import { initialGapSelection } from './components/source-cards-model.ts';
import { gapAwaitingMatch, gapFailReason } from './hooks/fill-announce-logic.ts';
import { type RequestStep, requestSteps } from './request-steps.ts';

/*
 * navi-connect R11 (B-223): the album page's gaps box, after Navic's `GapBox` (which retired its
 * `GapFillSheet`, as this retires Feishin's gap modal). The "N tracks missing" line unfolds to the
 * missing songs; Fill gaps turns the same box into the ranked sources for them; a request turns it
 * into the steps; the finish folds it to a result row and then to nothing. A failure keeps it open,
 * saying why.
 *
 * Which of those it shows is one function of what is known (lb-bot's gap record, this device's
 * ledger row for the group, where the user has the box, a tap in flight), so the box cannot be in
 * two states at once and every precedence is a case in `gap-stage.harness.ts`, ported from Navic's
 * `GapStageTest`. A transfer in flight is the truth whatever else is set: it may have been started
 * on another client. Pure: Navic's copy is `GapStage.kt`, written by hand (no shared build).
 */

/** Where the user has put the box. */
export type GapView = 'folded' | 'sources' | 'tracks';

/** How long the result row stays before the box folds away. */
export const GAP_RESULT_HOLD_MS = 6_000;

/** This device's ledger row for the group (`ActiveGap`), as the stage reads it. */
export interface GapFillRow {
    done: number;
    finishedAt: number;
    mp3WouldHelp: boolean;
    outcome: string;
    reason: string;
    settled: boolean;
    total: number;
}

export interface GapInput {
    /** A fetch lb-bot accepted that its status does not show yet. */
    committed: boolean;
    fill: GapFillRow | null;
    /** lb-bot's record for the group; null until the first read lands. */
    gap: GapRecord | null;
    /** The index's count, for the folded line before `gap` lands. */
    mirroredMissing: number;
    now: number;
    /** A search press whose answer, or the read that shows it running, has not come yet. */
    searchAsked: boolean;
    view: GapView;
}

/** The fields of lb-bot's gap record the stage reads. */
export type GapRecord = Pick<
    LbBotGap,
    | 'failDetail'
    | 'mp3WouldHelp'
    | 'noSourceReason'
    | 'present'
    | 'sources'
    | 'sourceTask'
    | 'stalledPlacement'
    | 'status'
    | 'total'
    | 'tracks'
>;

export type GapStage =
    /** Nothing missing, or the result has been shown: the box folds away. */
    | { added: number; kind: 'done'; present: number; total: number }
    /** lb-bot's record has not come yet and the box is open. */
    | { done: number; failed: number; kind: 'active'; steps: RequestStep[]; wanted: number }
    | { kind: 'absent' }
    /** A fill that failed: why, and a way on. */
    | { kind: 'attention'; reason: string }
    /** Files that arrived and need filing in lb-bot: no search or fetch from here can help. */
    | { kind: 'choosing'; preselected: null | number; sources: LbBotGapSource[] }
    | { kind: 'failed'; mp3WouldHelp: boolean; reason: string }
    | { kind: 'folded'; missing: number }
    | { kind: 'loading' }
    /** One line: how many are missing, Fill gaps, a chevron. */
    | { kind: 'noSources'; mp3WouldHelp: boolean; reason: string }
    /** A search that ended with nothing; lb-bot's reason when it gave one. */
    | { kind: 'searching' }
    /** Unfolded to the missing songs and what they are measured against. */
    | { kind: 'tracks'; missing: LbBotGapTrack[]; total: number };

/** Track states that mean "nothing further is coming for this slot". B-004: `cancelled` counts
 *  toward completion without counting as a success or a failure. */
const SETTLED_TRACK_STATES: ReadonlySet<LbBotGapTrackState> = new Set<LbBotGapTrackState>([
    'cancelled',
    'done',
    'downloaded',
    'skipped',
]);

/** Tracks that are no longer missing: in the library before, or put there by a fill. */
const HELD_TRACK_STATES: ReadonlySet<LbBotGapTrackState> = new Set<LbBotGapTrackState>([
    'done',
    'present',
]);

const SEARCH_IN_FLIGHT = new Set(['queued', 'running']);

/**
 * Fill progress, counted off the tracks rather than off a task: a gap fill is per-track and has no
 * single transfer to report. Measured against the tracks being filled, not the album's length:
 * progress against 17 when only 12 were queued stalls at 12/17 and reads as a hang.
 */
export const gapProgress = (gap: null | Pick<LbBotGap, 'tracks'> | undefined) => {
    const wanted = (gap?.tracks ?? []).filter((track) => track.state !== 'present');
    const done = wanted.filter((track) => SETTLED_TRACK_STATES.has(track.state));
    const failed = wanted.filter((track) => track.state === 'failed');
    return {
        done: done.length,
        failed: failed.length,
        percent: wanted.length ? Math.round((done.length / wanted.length) * 100) : 0,
        wanted: wanted.length,
    };
};

/** The tracks the album still lacks, in tracklist order. */
export const missingTracks = (gap: Pick<LbBotGap, 'tracks'>): LbBotGapTrack[] =>
    gap.tracks.filter((track) => !HELD_TRACK_STATES.has(track.state));

/** The tracks the album holds by lb-bot's count: what a re-read tracklist should have at least. */
export const heldTracks = (gap: Pick<LbBotGap, 'tracks'>): number =>
    gap.tracks.filter((track) => HELD_TRACK_STATES.has(track.state)).length;

/**
 * A gap fill's tracks as the request's step names: one downloading is Downloading; queued ones
 * with none moving yet are Queued; all fetched and some not yet filed is Placing in your library.
 */
export const gapStepState = (gap: Pick<LbBotGap, 'tracks'>): string => {
    const wanted = gap.tracks.filter((track) => track.state !== 'present');
    if (wanted.some((track) => track.state === 'downloading')) return 'downloading';
    if (wanted.some((track) => track.state === 'queued' || track.state === 'picked'))
        return 'queued';
    if (wanted.some((track) => track.state === 'downloaded')) return 'placing';
    return 'queued';
};

/**
 * Why a gap fill ended, in lb-bot's own words: its sentence (never the machine `failReason` token,
 * B-044), then the search task's error for a search that itself broke.
 */
export const gapReason = (gap: GapRecord): string =>
    gapFailReason(gap) || gap.sourceTask?.error || '';

export const gapStage = (input: GapInput): GapStage => {
    const { fill, gap } = input;
    if (!gap) {
        if (input.mirroredMissing <= 0) return { kind: 'absent' };
        return input.view === 'folded'
            ? { kind: 'folded', missing: input.mirroredMissing }
            : { kind: 'loading' };
    }
    const transferring =
        input.committed ||
        gap.status === 'downloading' ||
        gap.tracks.some((track) => track.state === 'queued' || track.state === 'downloading');
    if (transferring) {
        const progress = gapProgress(gap);
        return {
            done: progress.done,
            failed: progress.failed,
            kind: 'active',
            steps: requestSteps(gapStepState(gap), progress.done, progress.wanted),
            wanted: progress.wanted,
        };
    }
    const missing = missingTracks(gap);
    if (fill?.settled && fill.outcome === 'done') {
        if (input.now - fill.finishedAt < GAP_RESULT_HOLD_MS) {
            return {
                added: fill.done > 0 ? fill.done : fill.total,
                kind: 'done',
                present: gap.present,
                total: gap.total,
            };
        }
        if (missing.length === 0) return { kind: 'absent' };
    }
    if (gap.status === 'complete' || (missing.length === 0 && gap.total > 0)) {
        return { kind: 'absent' };
    }
    const searching = input.searchAsked || SEARCH_IN_FLIGHT.has(gap.sourceTask?.status ?? '');
    if (gap.stalledPlacement || (!searching && gapAwaitingMatch(gap))) {
        return { kind: 'attention', reason: gapReason(gap) };
    }
    // A fill that failed keeps the box open, saying why, until it is dismissed or tried again,
    // also over the sources it was requested from (the summary drops the source rows, and the
    // sources view with none left and nothing searching read as searching for good). A new search
    // press is the way out.
    if (fill?.settled && fill.outcome === 'failed' && !input.searchAsked) {
        return {
            kind: 'failed',
            mp3WouldHelp: gap.mp3WouldHelp || fill.mp3WouldHelp,
            reason: gapReason(gap) || fill.reason,
        };
    }
    if (input.view === 'sources') {
        if (searching) return { kind: 'searching' };
        if (gap.sources.length > 0) {
            return {
                kind: 'choosing',
                preselected: initialGapSelection(gap.sources),
                sources: gap.sources,
            };
        }
        if (gap.noSourceReason || gap.sourceTask) {
            return {
                kind: 'noSources',
                mp3WouldHelp: gap.mp3WouldHelp,
                reason: gap.noSourceReason,
            };
        }
        // Nothing asked yet: the box asks as it opens on the sources.
        return { kind: 'searching' };
    }
    if (input.view === 'tracks') return { kind: 'tracks', missing, total: gap.total };
    return { kind: 'folded', missing: missing.length > 0 ? missing.length : input.mirroredMissing };
};

/** Which stages share a header, so a change between them does not cross-fade the whole box. */
export const gapStageFamily = (stage: GapStage): string =>
    stage.kind === 'folded' || stage.kind === 'tracks'
        ? 'fold'
        : stage.kind === 'searching' || stage.kind === 'choosing' || stage.kind === 'noSources'
          ? 'sources'
          : stage.kind;

/**
 * A fill has put its tracks in the library: this device's ledger row settled done, or lb-bot counts
 * the album whole (a fill started on another client has no ledger row here). The album page re-reads
 * its tracklist when this turns true during the visit.
 */
export const gapFillLanded = (
    gap: Pick<LbBotGap, 'status' | 'total' | 'tracks'>,
    fill: GapFillRow | null,
): boolean =>
    (!!fill && fill.settled && fill.outcome === 'done') ||
    gap.status === 'complete' ||
    (gap.total > 0 && missingTracks(gap).length === 0);

/** The review group an album page's box is for, and the index's count of what it misses. */
export interface GapBoxGroup {
    albumId: string;
    groupId: string;
    mirroredMissing: number;
}

/**
 * Which group the album page's box is for. Once shown for an album it stays for the visit (review
 * I3): lb-bot flips the group's index row to `present` as a Fill-gaps completion lands, so the
 * mirror stops naming the album incomplete exactly when the box should show its result row. The
 * box then has nothing mirrored to count and `gapStage` decides when it goes. Another album on
 * the same page inherits nothing.
 */
export const gapBoxGroup = (
    kept: GapBoxGroup | null,
    albumId: string,
    release: null | { groupId: string; missing: number },
): GapBoxGroup | null => {
    if (release?.groupId) {
        return { albumId, groupId: release.groupId, mirroredMissing: release.missing };
    }
    if (kept && kept.albumId === albumId) return { ...kept, mirroredMissing: 0 };
    return null;
};
