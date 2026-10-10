import { useQueryClient } from '@tanstack/react-query';
import { MouseEvent, useCallback } from 'react';

import { albumQueries } from '/@/renderer/features/albums/api/album-api';
import { artistsQueries } from '/@/renderer/features/artists/api/artists-api';
import { ContextMenuController } from '/@/renderer/features/context-menu/context-menu-controller';
import {
    historyMenuTarget,
    matchSongByTitle,
} from '/@/renderer/features/listening/listening-logic';
import { useCurrentServerId } from '/@/renderer/store';
import { LibraryItem } from '/@/shared/types/domain-types';
import { LbBotRecentRow } from '/@/shared/types/lbbot-types';

/**
 * Right-click on a History row opens the app's own context menu - the same
 * `ContextMenuController` the queue, the song lists and the album and artist pages
 * call. A recent play carries no Navidrome song id, so the song is resolved WHEN THE
 * MENU IS ASKED FOR, not per row: the album's songs come from the album-detail query
 * the app already caches (`albumQueries.detail`), matched by `matchSongByTitle`. A
 * row that cannot be resolved to one song opens its album's menu, else its artist's,
 * else nothing - never a menu that acts on the wrong song.
 */
export const useHistoryContextMenu = () => {
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();

    return useCallback(
        async (event: MouseEvent<HTMLElement>, row: LbBotRecentRow) => {
            // Before the first await: the browser's own menu is decided synchronously.
            event.preventDefault();
            if (!row.ndAlbumId && !row.ndArtistId) return;

            const album = row.ndAlbumId
                ? await queryClient
                      .fetchQuery(albumQueries.detail({ query: { id: row.ndAlbumId }, serverId }))
                      .catch(() => null)
                : null;
            const song = album?.songs?.find(
                (candidate) => candidate.id === matchSongByTitle(row, album.songs ?? []),
            );
            const target = historyMenuTarget(row, song?.id ?? null);

            if (target.kind === 'song' && song) {
                ContextMenuController.call({
                    cmd: { items: [song], type: LibraryItem.SONG },
                    event,
                });
            } else if (target.kind === 'album' && album) {
                ContextMenuController.call({
                    cmd: { items: [album], type: LibraryItem.ALBUM },
                    event,
                });
            } else if (target.kind === 'artist' || (target.kind === 'album' && !album)) {
                // The album could not be read: the artist's menu, when the row has one.
                if (!row.ndArtistId) return;
                const artist = await queryClient
                    .fetchQuery(
                        artistsQueries.albumArtistDetail({
                            query: { id: row.ndArtistId },
                            serverId,
                        }),
                    )
                    .catch(() => null);
                if (artist) {
                    ContextMenuController.call({
                        cmd: { items: [artist], type: LibraryItem.ALBUM_ARTIST },
                        event,
                    });
                }
            }
        },
        [queryClient, serverId],
    );
};
