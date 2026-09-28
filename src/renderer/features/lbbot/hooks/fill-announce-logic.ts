import type { FillOutcome } from '/@/renderer/features/lbbot/stores/active-fills.store';

/**
 * B-026 (Feishin half): what `useFillAnnouncements` should say about a row that
 * just settled, kept apart from the toast/notify wiring so the decision can be
 * tested with `node --test` (no runtime imports here — see the harness).
 *
 * The bug this closes: a settled `'failed'` outcome does not always mean lb-bot
 * failed to get anything. Two cases reach `'failed'` with the files already sitting
 * in lb-bot, waiting to be filed:
 *   - a gap whose placement stalled (`stalledPlacement`, PROTOCOL §15.2's
 *     needs_match row, rulings R10/R15/R17) — the tracks downloaded but a rename
 *     or move needs a human in lb-bot's own workspace;
 *   - an album fill lb-bot reports as `needs_match` (`outcomeFor` in
 *     `use-lbbot.ts` folds this into `'failed'` before it ever reaches here).
 * Both should read as "downloaded, needs sorting out" rather than "couldn't get
 * it" — the second sends the user looking for a retry that would only refetch
 * files already on disk.
 */

/** Which of the two settled-row toasts to show; `null` means say nothing (the
 *  outcome is `'cancelled'`, `'needsPick'`, `'gaveUp'` or `'running'` — each of
 *  those already announces itself, or announces nothing, elsewhere). */
export type AnnounceKind = 'couldntGet' | 'done' | 'needsSorting';

/** The fields `useFillAnnouncements` reads off a ledger row (fill or gap) to
 *  decide what to say. `state` is the row's raw state string, not the outcome —
 *  it is how a `needs_match` album fill is told apart from any other failure,
 *  since `outcomeFor` has already folded both into `'failed'` by the time the
 *  row reaches the ledger. */
export interface AnnounceRow {
    outcome: FillOutcome;
    stalledPlacement?: boolean;
    state?: string;
}

/**
 * `null` for every outcome that isn't worth announcing here (mirrors the
 * `if (outcome === 'done') ... else if (outcome === 'failed') ...` branch in
 * `useFillAnnouncements` — `cancelled`/`needsPick`/`gaveUp`/`running` fall
 * through untouched, same as before this change).
 */
export const announcementKindFor = (row: AnnounceRow): AnnounceKind | null => {
    if (row.outcome === 'done') return 'done';
    if (row.outcome !== 'failed') return null;
    if (row.stalledPlacement || row.state === 'needs_match') return 'needsSorting';
    return 'couldntGet';
};
