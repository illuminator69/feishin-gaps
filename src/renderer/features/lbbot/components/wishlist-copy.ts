/**
 * What the Wishlist page says, per row and when empty (Worbus P1, F3). Pure and import-free
 * (`wishlist-copy.harness.ts` resolves the keys against en.json): the component passes each line
 * to `t(key, values)`.
 *
 * While downloading is off lb-bot does not search, so nothing here may say it does (Navic's
 * sentence, lane N ruling 1): a row says the album is kept for later, with no attempts and no
 * reason. While on - or unknown, an older peer - the copy is what the page always said.
 */

export interface CopyLine {
    key: string;
    values?: Record<string, number>;
}

export const wishlistRowLines = (
    downloadsShown: boolean,
    entry: { attempts: number; lastReason: string },
): { reason: null | string; status: CopyLine } => {
    if (!downloadsShown) {
        return { reason: null, status: { key: 'naviConnect.wishlist.savedForLater' } };
    }
    return {
        // lb-bot's own sentence about the last attempt, verbatim.
        reason: entry.lastReason || null,
        status:
            entry.attempts > 0
                ? { key: 'naviConnect.wishlist.stillLooking', values: { count: entry.attempts } }
                : { key: 'naviConnect.wishlist.waitingFirst' },
    };
};

/** `everyHours` is lb-bot's re-search cadence, 0 when it did not say. */
export const wishlistEmptyLine = (downloadsShown: boolean, everyHours: number): CopyLine => {
    if (!downloadsShown) return { key: 'naviConnect.wishlist.emptyOff' };
    return everyHours
        ? { key: 'naviConnect.wishlist.emptyEvery', values: { hours: everyHours } }
        : { key: 'naviConnect.wishlist.emptyPeriodically' };
};
