import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { useItemListColumnReorder } from '/@/renderer/components/item-list/helpers/use-item-list-column-reorder';
import { useItemListColumnResize } from '/@/renderer/components/item-list/helpers/use-item-list-column-resize';
import { ItemTableList } from '/@/renderer/components/item-list/item-table-list/item-table-list';
import { ItemTableListColumn } from '/@/renderer/components/item-list/item-table-list/item-table-list-column';
import { ErrorFallback } from '/@/renderer/features/action-required/components/error-fallback';
import { songsQueries } from '/@/renderer/features/songs/api/songs-api';
import { useListSettings, usePlayerQueue } from '/@/renderer/store';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { LibraryItem, Song } from '/@/shared/types/domain-types';
import { ItemListKey } from '/@/shared/types/types';

export type SimilarSongsListProps = {
    count?: number;
    fullScreen?: boolean;
    // Which list's column settings this instance uses. Defaults to the full-screen player's config;
    // the docked queue sheet passes its own key so it gets the sheet's columns.
    itemListKey?: ItemListKey;
    song: Song;
};

export const SimilarSongsList = ({
    count,
    itemListKey = ItemListKey.FULL_SCREEN,
    song,
}: SimilarSongsListProps) => {
    const songQuery = useQuery(
        songsQueries.similar({
            options: {
                gcTime: 1000 * 60 * 2,
            },
            query: {
                count,
                songId: song.id,
            },
            serverId: song?._serverId,
        }),
    );

    const { table } = useListSettings(itemListKey);

    const { handleColumnReordered } = useItemListColumnReorder({
        itemListKey,
    });

    const { handleColumnResized } = useItemListColumnResize({
        itemListKey,
    });

    const queue = usePlayerQueue();

    const tableData = useMemo(() => {
        const data = songQuery.data || [];
        // Keep the Related list ADDITIVE: drop the seed song and anything already in the queue so it
        // never just mirrors what's playing / queued next (getSimilarSongs is single-seed and does no
        // such filtering itself).
        const queuedIds = new Set(queue.map((queueSong) => queueSong.id));
        return data.filter((similar) => similar.id !== song.id && !queuedIds.has(similar.id));
    }, [songQuery.data, queue, song.id]);

    if (songQuery.isLoading || songQuery.isRefetching) {
        return <Spinner container size={25} />;
    }

    return (
        <ErrorBoundary FallbackComponent={ErrorFallback}>
            <ItemTableList
                autoFitColumns={table?.autoFitColumns}
                CellComponent={ItemTableListColumn}
                columns={table?.columns || []}
                data={tableData}
                enableAlternateRowColors={table?.enableAlternateRowColors}
                enableExpansion={false}
                enableHeader={table?.enableHeader}
                enableHorizontalBorders={table?.enableHorizontalBorders}
                enableRowHoverHighlight={table?.enableRowHoverHighlight}
                enableScrollShadow={false}
                enableSelection
                enableSelectionDialog={false}
                enableVerticalBorders={table?.enableVerticalBorders}
                itemType={LibraryItem.SONG}
                onColumnReordered={handleColumnReordered}
                onColumnResized={handleColumnResized}
                size={table?.size}
            />
        </ErrorBoundary>
    );
};
