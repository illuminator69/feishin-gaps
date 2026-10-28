import { useCallback } from 'react';

import {
    type DiscographyItem,
    type DiscographyView,
    filterItems,
    sortItems,
} from '/@/renderer/features/discography/discography-model';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { useCurrentServer } from '/@/renderer/store';
import { usePlayButtonBehavior } from '/@/renderer/store/settings.store';
import { LibraryItem, Song } from '/@/shared/types/domain-types';
import { Play } from '/@/shared/types/types';

/**
 * Call 4: the album ids the discography's current view shows (its kind chip, ownership filter and
 * sort), owned and partly-owned albums only, in the order the view draws them. A missing release
 * has nothing to play.
 */
export const viewPlayIds = (items: DiscographyItem[], view: DiscographyView): string[] =>
    sortItems(filterItems(items, view), view).flatMap((item) =>
        item.albumId && (item.ownership === 'owned' || item.ownership === 'partly')
            ? [item.albumId]
            : [],
    );

/**
 * Plays an artist's albums by id, keeping only the songs this artist is on (a compilation's other
 * artists are left out). The caller picks the ids: the discography page plays its filtered view,
 * the artist page its owned albums.
 */
export const usePlayArtistReleases = ({
    albumArtistId,
    routeId,
}: {
    albumArtistId?: string;
    routeId: string;
}) => {
    const server = useCurrentServer();
    const { addToQueueByFetch } = usePlayer();
    const playButtonBehavior = usePlayButtonBehavior();

    return useCallback(
        (albumIds: string[], type?: Play) => {
            if (!server?.id || !routeId) return;

            if (albumIds.length === 0) return;

            const filter = (song: Song) => {
                if (song.albumArtists.some((artist) => artist.id === albumArtistId)) {
                    return true;
                }

                return song.artists.some((artist) => artist.id === albumArtistId);
            };

            addToQueueByFetch(server.id, albumIds, LibraryItem.ALBUM, type || playButtonBehavior, {
                filter,
            });
        },
        [addToQueueByFetch, playButtonBehavior, routeId, server.id, albumArtistId],
    );
};
