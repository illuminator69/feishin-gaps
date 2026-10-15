import { useQueryClient } from '@tanstack/react-query';
import { MouseEvent, useCallback } from 'react';

import { api } from '/@/renderer/api';
import { albumQueries } from '/@/renderer/features/albums/api/album-api';
import { artistsQueries } from '/@/renderer/features/artists/api/artists-api';
import { ContextMenuController } from '/@/renderer/features/context-menu/context-menu-controller';
import { playlistsQueries } from '/@/renderer/features/playlists/api/playlists-api';
import { useCurrentServerId } from '/@/renderer/store';
import { LibraryItem } from '/@/shared/types/domain-types';

/** A library item a fork card or row points at, by its Navidrome id. */
export type LibraryMenuTarget =
    | { id: string; kind: 'album' }
    | { id: string; kind: 'artist' }
    | { id: string; kind: 'playlist' }
    | { id: string; kind: 'song' };

/**
 * Right-click on a fork card or row that shows a library item opens the app's own
 * menu for it: the same `ContextMenuController` the song lists, the album and artist
 * pages and every upstream card call. A fork row carries an id, not the item, so the
 * item is read when the menu is asked for (from the query cache the app already keeps
 * for its detail pages), never per row. An item that cannot be read opens nothing.
 */
export const useLibraryContextMenu = () => {
    const queryClient = useQueryClient();
    const serverId = useCurrentServerId();

    return useCallback(
        async (event: MouseEvent<HTMLElement>, target: LibraryMenuTarget | null) => {
            if (!target?.id) return;
            // Before the first await: the browser's own menu is decided synchronously.
            event.preventDefault();

            switch (target.kind) {
                case 'album': {
                    const album = await queryClient
                        .fetchQuery(albumQueries.detail({ query: { id: target.id }, serverId }))
                        .catch(() => null);
                    if (album) {
                        ContextMenuController.call({
                            cmd: { items: [album], type: LibraryItem.ALBUM },
                            event,
                        });
                    }
                    return;
                }
                case 'artist': {
                    const artist = await queryClient
                        .fetchQuery(
                            artistsQueries.albumArtistDetail({
                                query: { id: target.id },
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
                    return;
                }
                case 'playlist': {
                    const playlist = await queryClient
                        .fetchQuery(playlistsQueries.detail({ query: { id: target.id }, serverId }))
                        .catch(() => null);
                    if (playlist) {
                        ContextMenuController.call({
                            cmd: { items: [playlist], type: LibraryItem.PLAYLIST },
                            event,
                        });
                    }
                    return;
                }
                case 'song': {
                    const song = await api.controller
                        .getSongDetail({ apiClientProps: { serverId }, query: { id: target.id } })
                        .catch(() => null);
                    if (song) {
                        ContextMenuController.call({
                            cmd: { items: [song], type: LibraryItem.SONG },
                            event,
                        });
                    }
                }
            }
        },
        [queryClient, serverId],
    );
};
