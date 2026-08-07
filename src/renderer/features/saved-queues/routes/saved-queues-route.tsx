import { closeAllModals, openModal } from '@mantine/modals';
import { Suspense, useState } from 'react';

import styles from './saved-queues-route.module.css';

import { api } from '/@/renderer/api';
import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { NativeScrollArea } from '/@/renderer/components/native-scroll-area/native-scroll-area';
import { sendHubAct } from '/@/renderer/features/hub/utils/remote-queue';
import { useRestoreSavedQueue } from '/@/renderer/features/player/hooks/use-saved-queues';
import { restartQueueSession } from '/@/renderer/features/player/utils/saved-queue-source';
import { SaveAsPlaylistForm } from '/@/renderer/features/playlists/components/save-as-playlist-form';
import { savedQueuePreviewModalProps } from '/@/renderer/features/saved-queues/components/saved-queue-preview-modal';
import {
    savedQueueCoverSongId,
    savedQueueSourceLine,
    savedQueueSubtitle,
    savedQueueTitle,
} from '/@/renderer/features/saved-queues/utils/saved-queue-format';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { LibraryContainer } from '/@/renderer/features/shared/components/library-container';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import {
    SavedQueue,
    useCurrentServerId,
    useHubSavedQueueId,
    useHubStore,
    useSavedQueues,
    useSavedQueuesActions,
    useWindowSettings,
} from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Group } from '/@/shared/components/group/group';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { LibraryItem } from '/@/shared/types/domain-types';
import { Platform } from '/@/shared/types/types';

// navi-connect: full-screen management view for the saved-queue history — rename, resume,
// save-as-playlist, remove individual entries, and clear the whole history. The home page's
// "Continue Listening" row is the compact companion; this is its "Manage" destination.

const RenameQueueForm = ({
    entry,
    onSubmit,
}: {
    entry: SavedQueue;
    onSubmit: (name: string) => void;
}) => {
    const [value, setValue] = useState(entry.name ?? savedQueueTitle(entry));

    return (
        <Stack gap="md">
            <TextInput
                autoFocus
                onChange={(e) => setValue(e.currentTarget.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        onSubmit(value);
                        closeAllModals();
                    }
                }}
                value={value}
            />
            <Group justify="flex-end">
                <Button onClick={() => closeAllModals()} variant="subtle">
                    Cancel
                </Button>
                <Button
                    onClick={() => {
                        onSubmit(value);
                        closeAllModals();
                    }}
                    variant="filled"
                >
                    Save
                </Button>
            </Group>
        </Stack>
    );
};

interface RowProps {
    entry: SavedQueue;
    isActive: boolean;
    serverId: string;
}

const SavedQueueRow = ({ entry, isActive, serverId }: RowProps) => {
    const { isRestoring, restore } = useRestoreSavedQueue();
    const { remove, rename } = useSavedQueuesActions();

    const openPreview = () => {
        openModal(savedQueuePreviewModalProps(entry, isRestoring, () => void restore(entry)));
    };

    // Apply locally AND tell the hub (which propagates to every client and echoes the
    // reconciled list back). Local-first matters: the hub silently ignores a rename for
    // a record it doesn't have yet — an offline-captured row it hasn't been sent — so
    // hub-only would drop the edit. The local write is also what makes the UI instant.
    const doRename = (name: string) => {
        rename(entry.id, name);
        sendHubAct('renameSavedQueue', { id: entry.id, name });
    };
    const doRemove = () => {
        const wasLive = useHubStore.getState().savedQueueId === entry.id;
        remove(entry.id);
        sendHubAct('deleteSavedQueue', { id: entry.id });
        // Deleting the record the live queue publishes into leaves it homeless — start a
        // new session so it reappears under a fresh card.
        if (wasLive) restartQueueSession();
    };

    const openRename = () => {
        openModal({
            children: <RenameQueueForm entry={entry} onSubmit={doRename} />,
            title: 'Rename queue',
        });
    };

    const saveAsPlaylist = () => {
        openModal({
            children: (
                <SaveAsPlaylistForm
                    body={{ name: savedQueueTitle(entry) }}
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
        <div className={styles.row}>
            <button
                className={styles.rowMain}
                disabled={isRestoring}
                onClick={() => void restore(entry)}
                type="button"
            >
                {/* Art of the track this queue resumes on, built from its id with OUR credentials.
                    Passing a peer's `coverImageUrl` as `src` meant rendering Navic's authed URL
                    against Navic's server — which is why these were empty placeholders. */}
                <ItemImage
                    containerClassName={styles.cover}
                    id={savedQueueCoverSongId(entry)}
                    itemType={LibraryItem.SONG}
                    serverId={serverId}
                />
                <div className={styles.meta}>
                    <Text lineClamp={1} size="md" weight={600}>
                        {isActive ? '▶ ' : ''}
                        {savedQueueTitle(entry)}
                    </Text>
                    <Text isMuted lineClamp={1} size="sm">
                        {savedQueueSubtitle(entry, isActive)} ·{' '}
                        {new Date(entry.updatedAt).toLocaleDateString()}
                    </Text>
                    <Text isMuted lineClamp={1} size="xs">
                        {savedQueueSourceLine(entry)}
                    </Text>
                </div>
            </button>
            <DropdownMenu>
                <DropdownMenu.Target>
                    <ActionIcon icon="ellipsisHorizontal" size="sm" variant="subtle" />
                </DropdownMenu.Target>
                <DropdownMenu.Dropdown>
                    <DropdownMenu.Item onClick={() => void restore(entry)}>
                        Resume
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onClick={openPreview}>Preview queue</DropdownMenu.Item>
                    <DropdownMenu.Item onClick={openRename}>Rename</DropdownMenu.Item>
                    <DropdownMenu.Item onClick={saveAsPlaylist}>Save as playlist</DropdownMenu.Item>
                    <DropdownMenu.Item onClick={doRemove}>Remove from history</DropdownMenu.Item>
                </DropdownMenu.Dropdown>
            </DropdownMenu>
        </div>
    );
};

const SavedQueuesRoute = () => {
    const serverId = useCurrentServerId();
    const queues = useSavedQueues();
    const activeId = useHubSavedQueueId();
    const { clearAll } = useSavedQueuesActions();
    const { windowBarStyle } = useWindowSettings();

    // "Clear all" was local-only: the hub kept every record and rebroadcast the lot on the
    // next connect, so the whole list reappeared. Delete each id through the hub too (which
    // tombstones them), then restart the live session so the queue you're still playing gets
    // a fresh card rather than vanishing from the history until you play something else.
    const doClearAll = () => {
        const ids = queues.map((queue) => queue.id);
        clearAll();
        for (const id of ids) sendHubAct('deleteSavedQueue', { id });
        restartQueueSession();
    };

    // Current queue pinned to the top, then most-recently-updated. A record with no serverId is
    // NOT filtered out: Navic's rows carry none (single-server setup, no such column over there),
    // and a strict equality test silently hid every queue the phone had captured.
    const entries = (serverId ? queues.filter((q) => !q.serverId || q.serverId === serverId) : [])
        .slice()
        .sort((a, b) => {
            if (a.id === activeId) return -1;
            if (b.id === activeId) return 1;
            return b.updatedAt - a.updatedAt;
        });

    return (
        <AnimatedPage>
            <NativeScrollArea
                pageHeaderProps={{
                    backgroundColor: 'var(--theme-colors-background)',
                    children: (
                        <LibraryHeaderBar>
                            <LibraryHeaderBar.Title>Saved Queues</LibraryHeaderBar.Title>
                        </LibraryHeaderBar>
                    ),
                    offset: 200,
                }}
            >
                <LibraryContainer>
                    <Stack
                        gap="lg"
                        mb="5rem"
                        pt={windowBarStyle === Platform.WEB ? '5rem' : '3rem'}
                        px="2rem"
                    >
                        <Group justify="space-between">
                            <Text size="xl" weight={700}>
                                Saved Queues
                            </Text>
                            {entries.length > 0 && (
                                <Button onClick={doClearAll} variant="subtle">
                                    Clear all
                                </Button>
                            )}
                        </Group>
                        {entries.length === 0 ? (
                            <Text isMuted>
                                No saved queues yet. Queues you play are captured here
                                automatically.
                            </Text>
                        ) : (
                            <Stack gap="sm">
                                {entries.map((entry) => (
                                    <SavedQueueRow
                                        entry={entry}
                                        isActive={entry.id === activeId}
                                        key={entry.id}
                                        serverId={serverId as string}
                                    />
                                ))}
                            </Stack>
                        )}
                    </Stack>
                </LibraryContainer>
            </NativeScrollArea>
        </AnimatedPage>
    );
};

const SavedQueuesRouteWithBoundary = () => {
    return (
        <PageErrorBoundary>
            <Suspense fallback={<Spinner container />}>
                <SavedQueuesRoute />
            </Suspense>
        </PageErrorBoundary>
    );
};

export default SavedQueuesRouteWithBoundary;
