import { closeAllModals, openModal } from '@mantine/modals';
import { Link } from 'react-router';

import styles from './continue-listening-carousel.module.css';

import { api } from '/@/renderer/api';
import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { sendHubAct } from '/@/renderer/features/hub/utils/remote-queue';
import { useRestoreSavedQueue } from '/@/renderer/features/player/hooks/use-saved-queues';
import { restartQueueSession } from '/@/renderer/features/player/utils/saved-queue-source';
import { SaveAsPlaylistForm } from '/@/renderer/features/playlists/components/save-as-playlist-form';
import { savedQueuePreviewModalProps } from '/@/renderer/features/saved-queues/components/saved-queue-preview-modal';
import {
    savedQueueCoverSongId,
    savedQueueSourceLine,
    savedQueueSubtitle,
    savedQueueTitle as queueTitle,
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
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
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

    return (
        <div
            aria-busy={isRestoring}
            className={styles.card}
            onClick={() => void restore(entry)}
            onKeyDown={(e) => {
                if (e.key === 'Enter') void restore(entry);
            }}
            role="button"
            tabIndex={0}
        >
            <div className={styles.menu} onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                    <DropdownMenu.Target>
                        <ActionIcon icon="ellipsisHorizontal" size="sm" variant="subtle" />
                    </DropdownMenu.Target>
                    <DropdownMenu.Dropdown>
                        <DropdownMenu.Item onClick={() => void restore(entry)}>
                            Resume
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onClick={openPreview}>Preview queue</DropdownMenu.Item>
                        <DropdownMenu.Item onClick={saveAsPlaylist}>
                            Save as playlist
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onClick={doRemove}>
                            Remove from history
                        </DropdownMenu.Item>
                    </DropdownMenu.Dropdown>
                </DropdownMenu>
            </div>
            {/* Resolved from the resume track's id with our own credentials — see the route. */}
            <ItemImage
                containerClassName={styles.cover}
                id={savedQueueCoverSongId(entry)}
                itemType={LibraryItem.SONG}
                serverId={serverId}
            />
            <div className={styles.meta}>
                <Text className={styles.kind} isMuted size="xs">
                    {savedQueueSubtitle(entry, isActive)}
                </Text>
                <Text lineClamp={1} size="sm" weight={600}>
                    {isActive ? '▶ ' : ''}
                    {queueTitle(entry)}
                </Text>
                <Text isMuted lineClamp={1} size="xs">
                    {savedQueueSourceLine(entry)}
                </Text>
            </div>
        </div>
    );
};

/**
 * navi-connect: home-page "Continue Listening" row — the most-recently-played saved queues, tap to
 * resume where you left off. Renders nothing when there's no history yet.
 */
export const ContinueListeningCarousel = () => {
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

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <Text size="lg" weight={700}>
                    Continue Listening
                </Text>
                <Link className={styles.manageLink} to={AppRoute.SAVED_QUEUES}>
                    <Text isMuted size="sm">
                        Manage
                    </Text>
                </Link>
            </div>
            <div className={styles.row}>
                {entries.map((entry) => (
                    <ContinueListeningCard
                        entry={entry}
                        isActive={entry.id === activeId}
                        key={entry.id}
                        serverId={serverId}
                    />
                ))}
            </div>
        </div>
    );
};
