import { queryOptions } from '@tanstack/react-query';

import { api } from '/@/renderer/api';
import { controller } from '/@/renderer/api/controller';
import { queryKeys } from '/@/renderer/api/query-keys';
import { getOptimizedListCount } from '/@/renderer/api/utils-list-count';
import { QueryHookArgs } from '/@/renderer/lib/react-query';
import { AlbumDetailQuery, AlbumListQuery, ListCountQuery } from '/@/shared/types/domain-types';

export const albumQueries = {
    detail: (args: QueryHookArgs<AlbumDetailQuery>) => {
        return queryOptions({
            queryFn: ({ signal }) => {
                return api.controller.getAlbumDetail({
                    apiClientProps: { serverId: args.serverId, signal },
                    query: args.query,
                });
            },
            queryKey: queryKeys.albums.detail(args.serverId, args.query),
            ...args.options,
        });
    },
    /**
     * `getAlbumInfo2` — the editorial album notes, which since the Apple Music
     * metadata agent went into Navidrome's chain are a real description rather
     * than an empty field.
     *
     * The album page never fetched this: the controller has produced `notes`
     * all along and the only caller in the repo was Discord Rich Presence,
     * which reads `imageUrl` and nothing else.
     *
     * `getAlbumInfo` is OPTIONAL on the controller — not every backend has an
     * equivalent — so this resolves to null rather than throwing, exactly as
     * `artistsQueries.albumArtistInfo` does.
     */
    info: (args: QueryHookArgs<AlbumDetailQuery>) => {
        return queryOptions({
            queryFn: ({ signal }) => {
                return (
                    api.controller.getAlbumInfo?.({
                        apiClientProps: { serverId: args.serverId, signal },
                        query: args.query,
                    }) ?? Promise.resolve(null)
                );
            },
            queryKey: queryKeys.albums.info(args.serverId, args.query),
            ...args.options,
        });
    },
    list: (args: QueryHookArgs<AlbumListQuery>) => {
        return queryOptions({
            queryFn: ({ signal }) => {
                return api.controller.getAlbumList({
                    apiClientProps: { serverId: args.serverId, signal },
                    query: args.query,
                });
            },
            queryKey: queryKeys.albums.list(
                args.serverId,
                args.query,
                args.query?.artistIds?.length === 1 ? args.query?.artistIds[0] : undefined,
            ),
            ...args.options,
        });
    },
    listCount: (args: QueryHookArgs<ListCountQuery<AlbumListQuery>>) => {
        return queryOptions({
            gcTime: 1000 * 60 * 60,
            queryFn: async ({ client, signal }) => {
                const optimizedCount = await getOptimizedListCount<
                    ListCountQuery<AlbumListQuery>,
                    AlbumListQuery,
                    { totalRecordCount: null | number }
                >({
                    client,
                    listQueryFn: controller.getAlbumList,
                    listQueryKeyFn: (serverId, query) => queryKeys.albums.list(serverId, query),
                    query: args.query,
                    serverId: args.serverId,
                    signal,
                });

                if (optimizedCount !== null) {
                    return optimizedCount;
                }

                return api.controller.getAlbumListCount({
                    apiClientProps: { serverId: args.serverId, signal },
                    query: args.query,
                });
            },
            queryKey: queryKeys.albums.count(
                args.serverId,
                args.query,
                args.query?.artistIds?.length === 1 ? args.query?.artistIds[0] : undefined,
            ),
            staleTime: 1000 * 60 * 60,
            ...args.options,
        });
    },
};
