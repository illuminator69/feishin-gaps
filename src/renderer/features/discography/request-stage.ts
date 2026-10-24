/**
 * navi-connect F7 (Task 7): which stage an album request is at, from the fill ledger's row and the
 * index. Never inferred from the page: "Placed" is not "In your library" until Navidrome has the album.
 */

export type RequestStage =
    | 'active'
    | 'cancelled'
    | 'failed'
    | 'gaveUp'
    | 'inLibrary'
    | 'needsMatch'
    | 'needsPick'
    | 'none'
    | 'syncing';

export const requestStage = (input: {
    /** The index row for this release-group names a Navidrome album. */
    indexRowOwned: boolean;
    ownedAlbumId: null | string;
    row: null | { outcome: string; settled: boolean; state: string; verifyGaveUp?: boolean };
}): RequestStage => {
    if (input.indexRowOwned && input.ownedAlbumId) return 'inLibrary';
    const { row } = input;
    if (!row) return 'none';
    if (!row.settled) return row.state === 'placed' ? 'syncing' : 'active';
    switch (row.outcome) {
        case 'cancelled':
            return 'cancelled';
        case 'done':
            return row.verifyGaveUp ? 'syncing' : 'inLibrary';
        case 'failed':
            return row.state === 'needs_match' ? 'needsMatch' : 'failed';
        case 'gaveUp':
            return 'gaveUp';
        case 'needsPick':
            return 'needsPick';
        default:
            return 'active';
    }
};
