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
 *
 * Final-review fix: this module also owns the "needs sorting out" toast's link
 * target now (`announcementLinkPathFor`), because getting it wrong here is the
 * same mistake as getting the wording wrong — `ActiveFill.groupId` looks exactly
 * like `ActiveGap.groupId` at the call site (same field name, same "a status poll
 * learned this" story) but is NOT a review-group id at `needs_match`: lb-bot
 * repoints it at an import-recovery record (`rec<N>`,
 * `listenbrainz_bot.py`'s `_album_fill_set`), and `#/gaps/rec17` is a page lb-bot
 * answers "Group not found" on. Only `ActiveGap.groupId` resolves `#/gaps/<id>`.
 */

/** Which of the two settled-row toasts to show; `null` means say nothing (the
 *  outcome is `'cancelled'`, `'needsPick'`, `'gaveUp'` or `'running'` — each of
 *  those already announces itself, or announces nothing, elsewhere). */
export type AnnounceKind = 'couldntGet' | 'done' | 'needsSorting';

/** The fields `useFillAnnouncements` reads off a ledger row (fill or gap) to
 *  decide what to say and where to link. `state` is the row's raw state string,
 *  not the outcome — it is how a `needs_match` album fill is told apart from any
 *  other failure, since `outcomeFor` has already folded both into `'failed'` by
 *  the time the row reaches the ledger. `isGap` and `groupId` are read by
 *  `announcementLinkPathFor` only; `announcementKindFor` ignores them. */
export interface AnnounceRow {
    /** The id off the row, whatever it currently means for this row's kind —
     *  see the module doc comment. Never assume it is a review-group id. */
    groupId?: string;
    /** Which ledger map the row came from — tag it at the point `rows` is built
     *  (`use-fill-announcements.ts`), never infer it from `stalledPlacement`
     *  being falsy: an *unstalled* gap has no stalledPlacement either. */
    isGap: boolean;
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

/**
 * The path (relative to lb-bot's `webUrl`) the "needs sorting out" toast should
 * link to, or `''` when no link is possible. Only meaningful when
 * `announcementKindFor` returned `'needsSorting'` — callers should not call this
 * for any other kind.
 *
 * A gap's `groupId` IS the review group lb-bot's Fill-gaps workspace is keyed
 * on, so it gets the specific page. An album fill's `groupId` at `needs_match`
 * is an import-recovery record id, not a review group — there is no
 * album-specific page for it in lb-bot's SPA (`Lb-bot-missing/web/src/App.jsx`
 * has no route keyed on that id), so it goes to the placement queue
 * (`#/downloads`, `TAB_ROUTES['Downloads'] === 'downloads'`) instead, which is
 * never row-specific but is always the right screen.
 */
export const announcementLinkPathFor = (row: Pick<AnnounceRow, 'groupId' | 'isGap'>): string => {
    if (row.isGap) return row.groupId ? `#/gaps/${encodeURIComponent(row.groupId)}` : '';
    return '#/downloads';
};
