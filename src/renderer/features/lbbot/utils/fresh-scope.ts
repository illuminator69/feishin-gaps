/**
 * I-006: the Fresh feed's scopes, as pure functions over the rows.
 *
 * `artistPlays` is lb-bot's all-time count of plays by the row's artists in its
 * listens mirror: 0 when none, and ALSO 0 while the mirror is off or importing.
 * A row from an lb-bot older than the field has no `artistPlays` at all — that is
 * how the third scope knows to stay hidden instead of showing an empty list.
 */

export type FreshScopeValue = 'all' | 'mine' | 'plays';

interface ScopedRow {
    artistOwned: boolean;
    artistPlays?: number;
    releaseDate: string;
}

/** Any row carries the field (even as 0): this lb-bot knows about listens. */
export const hasArtistPlays = (
    rows: readonly Pick<ScopedRow, 'artistPlays'>[] | undefined,
): boolean => !!rows?.some((row) => typeof row.artistPlays === 'number');

/** A persisted `plays` scope with nothing able to support it reads as `mine`
 *  rather than as an empty page with no way to leave it. */
export const scopeInEffect = (scope: FreshScopeValue, playsAvailable: boolean): FreshScopeValue =>
    scope === 'plays' && !playsAvailable ? 'mine' : scope;

export const applyFreshScope = <T extends ScopedRow>(
    rows: readonly T[],
    scope: FreshScopeValue,
): T[] => {
    if (scope === 'all') return [...rows];
    if (scope === 'mine') return rows.filter((row) => row.artistOwned);
    return rows
        .filter((row) => (row.artistPlays ?? 0) > 0)
        .sort(
            (a, b) =>
                (b.artistPlays ?? 0) - (a.artistPlays ?? 0) ||
                (b.releaseDate || '').localeCompare(a.releaseDate || ''),
        );
};
