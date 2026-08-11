import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useTranslation } from 'react-i18next';

import { useItemListColumnReorder } from '/@/renderer/components/item-list/helpers/use-item-list-column-reorder';
import { useItemListColumnResize } from '/@/renderer/components/item-list/helpers/use-item-list-column-resize';
import { ItemTableList } from '/@/renderer/components/item-list/item-table-list/item-table-list';
import { ItemTableListColumn } from '/@/renderer/components/item-list/item-table-list/item-table-list-column';
import { ErrorFallback } from '/@/renderer/features/action-required/components/error-fallback';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { songsQueries } from '/@/renderer/features/songs/api/songs-api';
import { useListSettings, usePlayerQueue } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { LibraryItem, Song } from '/@/shared/types/domain-types';
import { ItemListKey, Play } from '/@/shared/types/types';

// The Related tab is a quick "what next" surface, not a full list — cap it so it
// stays scannable and the "Play" action starts a sensibly-sized queue.
const MAX_RELATED = 20;

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
    const player = usePlayer();
    const { t } = useTranslation();

    const tableData = useMemo(() => {
        const data = songQuery.data || [];
        // Keep the Related list ADDITIVE: drop the seed song and anything already in the queue so it
        // never just mirrors what's playing / queued next (getSimilarSongs is single-seed and does no
        // such filtering itself). Cap the result so the tab stays a short "what next" shortlist.
        const queuedIds = new Set(queue.map((queueSong) => queueSong.id));
        return data
            .filter((similar) => similar.id !== song.id && !queuedIds.has(similar.id))
            .slice(0, MAX_RELATED);
    }, [songQuery.data, queue, song.id]);

    // Start a fresh queue from the suggested songs (Play.NOW clears the current queue).
    const handlePlayRelated = useCallback(() => {
        if (tableData.length === 0) return;
        player.addToQueueByData(tableData, Play.NOW);
    }, [player, tableData]);

    if (songQuery.isLoading || songQuery.isRefetching) {
        return <Spinner container size={25} />;
    }

    return (
        <ErrorBoundary FallbackComponent={ErrorFallback}>
            <div
                style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}
            >
                {tableData.length > 0 && (
                    <Group gap="xs" px="sm" py="xs">
                        <Button
                            fw="600"
                            leftSection={<Icon icon="mediaPlay" />}
                            onClick={handlePlayRelated}
                            size="sm"
                            uppercase
                            variant="subtle"
                        >
                            {t('player.play')}
                        </Button>
                    </Group>
                )}
                <div style={{ flex: 1, minHeight: 0 }}>
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
                </div>
            </div>
        </ErrorBoundary>
    );
};
