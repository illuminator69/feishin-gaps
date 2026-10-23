import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import { api } from '/@/renderer/api';
import { useCurrentServer } from '/@/renderer/store';
import {
    AlbumArtist,
    AlbumArtistListResponse,
    AlbumArtistListSort,
    SortOrder,
} from '/@/shared/types/domain-types';

const PAGE = 500;
const MAX_ARTISTS = 20_000;

/**
 * The cached value has the shape every other album-artist list entry has: the rating and favourite
 * optimistic updaters walk every `[serverId, 'albumArtists', 'list', ...]` entry and map its `items`.
 * `partial` marks the pages written while a first read is still going.
 */
type LibraryArtistsData = AlbumArtistListResponse & { partial?: boolean };

export const libraryArtistsKey = (serverId: string, musicFolderId: null | string | string[]) =>
    [serverId, 'albumArtists', 'list', 'library-all', musicFolderId] as const;

/**
 * F6: every album artist in the library (Call 3): Navidrome's search is substring-only, so the
 * Library field narrows a list held here. Read in pages of 500 (at most 20,000 rows), sorted by
 * name, in the persisted music folder. On the first read each page is shown as it arrives; a refetch
 * (the lb-bot library refresh, an artist image change) keeps the old list on screen until the new one
 * is whole. Cached 10 minutes under the `albumArtists` list family, so the refresh drops it.
 */
export const useLibraryArtists = (): {
    artists: AlbumArtist[];
    error: boolean;
    loadedAll: boolean;
    loading: boolean;
    refetch: () => void;
    total: number | undefined;
} => {
    const server = useCurrentServer();
    const serverId = server?.id ?? '';
    const musicFolderId = server?.musicFolderId?.length ? server.musicFolderId : null;
    const queryClient = useQueryClient();
    const queryKey = useMemo(
        () => libraryArtistsKey(serverId, musicFolderId),
        [serverId, musicFolderId],
    );

    const query = useQuery<LibraryArtistsData>({
        enabled: !!serverId,
        gcTime: 30 * 60 * 1000,
        queryFn: async ({ signal }) => {
            const firstRead = queryClient.getQueryData(queryKey) === undefined;
            const items: AlbumArtist[] = [];
            let total: null | number = null;
            for (;;) {
                const page = await api.controller.getAlbumArtistList({
                    apiClientProps: { serverId, signal },
                    query: {
                        limit: PAGE,
                        sortBy: AlbumArtistListSort.NAME,
                        sortOrder: SortOrder.ASC,
                        startIndex: items.length,
                    },
                });
                const rows = page?.items ?? [];
                items.push(...rows);
                total = page?.totalRecordCount ?? total;
                const done =
                    rows.length === 0 ||
                    (total !== null && items.length >= total) ||
                    items.length >= MAX_ARTISTS;
                if (done) break;
                if (firstRead) {
                    queryClient.setQueryData<LibraryArtistsData>(queryKey, {
                        items: [...items],
                        partial: true,
                        startIndex: 0,
                        totalRecordCount: total,
                    });
                }
            }
            return { items, startIndex: 0, totalRecordCount: total };
        },
        queryKey,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 10 * 60 * 1000,
        throwOnError: false,
    });

    const data = query.data;
    const { refetch: refetchQuery } = query;
    const refetch = useCallback(() => void refetchQuery(), [refetchQuery]);

    return {
        artists: data?.items ?? EMPTY,
        error: query.isError,
        loadedAll: !!data && !data.partial,
        loading: !data && query.isFetching,
        refetch,
        total: data?.totalRecordCount ?? undefined,
    };
};

const EMPTY: AlbumArtist[] = [];
