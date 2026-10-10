import { generatePath } from 'react-router';

import type { PollState } from './album-override';

import { decideLeave, releaseUnchanged } from './album-override';
import { currentRoutePath, leaveTo } from './leave-page';

import { AppRoute } from '/@/renderer/router/routes';

/**
 * Leave the album page a finished apply / remove left dead, from whichever surface
 * started the job (the dialog, or Undo in the data panel) and whether or not it is
 * still open. The decision is {@link decideLeave}; this only goes where it says.
 * Not harnessed: it needs the router's routes. Everything it decides is.
 */
export const leaveAfterAlbumJob = (input: {
    artistId: string;
    deadAlbumId: string;
    ended: PollState;
    kind: 'apply' | 'remove';
}): void => {
    if (input.ended.phase !== 'settled') return;
    const row = input.ended.row;
    const decision = decideLeave({
        artistId: input.artistId,
        deadAlbumId: input.deadAlbumId,
        kind: input.kind,
        newAlbumId: row?.albumId ?? '',
        pathname: currentRoutePath(),
        releaseUnchanged: !!row && releaseUnchanged(row),
    });
    if (decision.kind === 'album') {
        leaveTo(generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: decision.id }));
    } else if (decision.kind === 'artist') {
        leaveTo(
            generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, { albumArtistId: decision.id }),
        );
    } else if (decision.kind === 'albums') {
        leaveTo(AppRoute.LIBRARY_ALBUMS);
    }
};
