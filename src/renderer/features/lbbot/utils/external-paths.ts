import { generatePath } from 'react-router';

import { AppRoute } from '/@/renderer/router/routes';
import { LbBotFreshRelease } from '/@/shared/types/lbbot-types';

/**
 * Links to the two virtual pages — an artist and an album the library does not
 * have.
 *
 * The id in the path is all these pages strictly need; everything else rides along
 * as query params so the header can render immediately rather than after a
 * MusicBrainz round trip. They are hints, not authority: the pages re-read the
 * real values from lb-bot and must work with the params absent (a pasted or
 * bookmarked URL).
 */

const withParams = (path: string, params: Record<string, string | undefined>): string => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value) search.set(key, value);
    }
    const query = search.toString();
    return query ? `${path}?${query}` : path;
};

export const externalArtistPath = (artistMbid: string, name?: string): string =>
    withParams(generatePath(AppRoute.EXTERNAL_ARTIST_DETAIL, { artistMbid }), { name });

export const externalAlbumPath = (release: LbBotFreshRelease): string =>
    withParams(generatePath(AppRoute.EXTERNAL_ALBUM_DETAIL, { rgid: release.releaseGroupMbid }), {
        artist: release.artist,
        // Carried so the album page can link the artist name to the *real*
        // artist page. It has the MBID either way, but sending an owned artist
        // to the virtual page is a worse answer than the one the tile it was
        // opened from already gave.
        artistId: release.artistOwned ? release.artistId : '',
        artistMbid: release.artistMbids[0],
        title: release.releaseName,
        type: release.secondaryType || release.type,
        year: (release.releaseDate || '').slice(0, 4),
    });

/**
 * Where an artist name should link, given whatever handles are to hand.
 *
 * Owned → the real artist page. Unowned but MusicBrainz-identified → the virtual
 * one, which renders their discography from lb-bot. Neither → `undefined`, and
 * the caller renders plain text rather than a link to nowhere.
 *
 * Shared by the Fresh tile and the virtual album page precisely so the two
 * cannot drift: the album page rendered the artist as bare text, which is how a
 * name that was a link on the tile stopped being one on the page it opened.
 */
export const artistLinkPath = (artistId: string, artistMbid: string): string | undefined => {
    if (artistId) {
        return generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, { albumArtistId: artistId });
    }
    if (artistMbid) {
        return generatePath(AppRoute.EXTERNAL_ARTIST_DETAIL, { artistMbid });
    }
    return undefined;
};
