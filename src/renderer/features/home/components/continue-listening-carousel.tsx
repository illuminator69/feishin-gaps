import { closeAllModals, openModal } from '@mantine/modals';
import { Link } from 'react-router';

import { api } from '/@/renderer/api';
import {
    GridCarousel,
    useGridCarouselContainerQuery,
} from '/@/renderer/components/grid-carousel/grid-carousel-v2';
import discoverStyles from '/@/renderer/features/discover/components/discover-row.module.css';
import { DiscoverTile } from '/@/renderer/features/discover/components/discover-tile';
import { sendHubAct } from '/@/renderer/features/hub/utils/remote-queue';
import { useRestoreSavedQueue } from '/@/renderer/features/player/hooks/use-saved-queues';
import { restartQueueSession } from '/@/renderer/features/player/utils/saved-queue-source';
import { SaveAsPlaylistForm } from '/@/renderer/features/playlists/components/save-as-playlist-form';
import { savedQueuePreviewModalProps } from '/@/renderer/features/saved-queues/components/saved-queue-preview-modal';
import {
    savedQueueTitle as queueTitle,
    savedQueueCoverSongId,
    savedQueueSourceLine,
    savedQueueSubtitle,
} from '/@/renderer/features/saved-queues/utils/saved-queue-format';
import { AppRoute } from '/@/renderer/router/routes';
import {
    SavedQueue,
    useContinueListening,
    useCurrentServerId,
    useHubSavedQueueId,
    useHubStore,
    useSavedQueuesActions,
} from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Group } from '/@/shared/components/group/group';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { LibraryItem } from '/@/shared/types/domain-types';

interface CardProps {
    entry: SavedQueue;
    isActive: boolean;
    serverId: string;
}

const ContinueListeningCard = ({ entry, isActive, serverId }: CardProps) => {
    const { isRestoring, restore } = useRestoreSavedQueue();
    const { remove } = useSavedQueuesActions();

    const openPreview = () => {
        openModal(savedQueuePreviewModalProps(entry, isRestoring, () => void restore(entry)));
    };

    // Local first (instant, and covers rows the hub hasn't been told about yet), then
    // the hub act so the deletion propagates to every client and is tombstoned there.
    const doRemove = () => {
        const wasLive = useHubStore.getState().savedQueueId === entry.id;
        remove(entry.id);
        sendHubAct('deleteSavedQueue', { id: entry.id });
        // Deleting the record the live queue publishes into leaves it homeless — start a
        // new session so it reappears under a fresh card.
        if (wasLive) restartQueueSession();
    };

    const saveAsPlaylist = () => {
        openModal({
            children: (
                <SaveAsPlaylistForm
                    body={{ name: queueTitle(entry) }}
                    onCancel={closeAllModals}
                    onSuccess={async (data) => {
                        try {
                            await api.controller.addToPlaylist({
                                apiClientProps: { serverId },
                                body: { songId: entry.songs.map((song) => song.id) },
                                query: { id: data?.id || '' },
                            });
                            toast.success({ message: `Saved ${entry.songs.length} tracks` });
                        } catch (err) {
                            toast.error({
                                message: (err as Error).message,
                                title: 'Could not add tracks to the playlist',
                            });
                        }
                    }}
                    serverId={serverId}
                />
            ),
            title: 'Save queue as playlist',
        });
    };

    // One list for both menus: the "..." on the cover and a right-click, as on the
    // app's cards.
    const menu: { label: string; onSelect: () => void }[] = [
        { label: 'Resume', onSelect: () => void restore(entry) },
        { label: 'Preview queue', onSelect: openPreview },
        { label: 'Save as playlist', onSelect: saveAsPlaylist },
        { label: 'Remove from history', onSelect: doRemove },
    ];

    return (
        <ContextMenu>
            <ContextMenu.Target>
                <div>
                    <DiscoverTile
                        action={
                            <div className={discoverStyles.action}>
                                <DropdownMenu>
                                    <DropdownMenu.Target>
                                        <ActionIcon
                                            icon="ellipsisHorizontal"
                                            size="sm"
                                            variant="filled"
                                        />
                                    </DropdownMenu.Target>
                                    <DropdownMenu.Dropdown>
                                        {menu.map((item) => (
                                            <DropdownMenu.Item
                                                key={item.label}
                                                onClick={item.onSelect}
                                            >
                                                {item.label}
                                            </DropdownMenu.Item>
                                        ))}
                                    </DropdownMenu.Dropdown>
                                </DropdownMenu>
                            </div>
                        }
                        caption={savedQueueSourceLine(entry) || undefined}
                        // Resolved from the resume track's id with our own credentials:
                        // a peer's `coverImageUrl` is an authed URL for its server.
                        imageId={savedQueueCoverSongId(entry)}
                        isBusy={isRestoring}
                        itemType={LibraryItem.SONG}
                        onClick={() => void restore(entry)}
                        subtitle={savedQueueSubtitle(entry, isActive)}
                        title={`${isActive ? '▶ ' : ''}${queueTitle(entry)}`}
                    />
                </div>
            </ContextMenu.Target>
            <ContextMenu.Content>
                {menu.map((item) => (
                    <ContextMenu.Item key={item.label} onSelect={item.onSelect}>
                        {item.label}
                    </ContextMenu.Item>
                ))}
            </ContextMenu.Content>
        </ContextMenu>
    );
};

const noop = () => {};

export const ContinueListeningCarousel = ({
    containerQuery,
}: {
    containerQuery?: ReturnType<typeof useGridCarouselContainerQuery>;
}) => {
    const serverId = useCurrentServerId();
    const activeId = useHubSavedQueueId();
    const raw = useContinueListening(serverId, 12);

    // Current queue first (highlighted "Now Playing"), then most-recent.
    const entries = raw.slice().sort((a, b) => {
        if (a.id === activeId) return -1;
        if (b.id === activeId) return 1;
        return b.updatedAt - a.updatedAt;
    });

    if (!serverId || entries.length === 0) {
        return null;
    }

    // The app's own carousel, paged by Home's container query: its cards are the size of
    // every other Home row's at every width. It was a hand-rolled sideways-scrolling strip
    // of fixed 190px cards on a surface of their own.
    return (
        <GridCarousel
            cards={entries.map((entry) => ({
                content: (
                    <ContinueListeningCard
                        entry={entry}
                        isActive={entry.id === activeId}
                        serverId={serverId}
                    />
                ),
                id: entry.id,
            }))}
            containerQuery={containerQuery}
            onNextPage={noop}
            onPrevPage={noop}
            title={
                <Group align="baseline" gap="md">
                    <TextTitle fw={700} isNoSelect order={3}>
                        Continue Listening
                    </TextTitle>
                    <Text isMuted size="sm">
                        <Link to={AppRoute.SAVED_QUEUES}>Manage</Link>
                    </Text>
                </Group>
            }
        />
    );
};
