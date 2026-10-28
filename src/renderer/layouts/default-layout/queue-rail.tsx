import { useTranslation } from 'react-i18next';

import styles from './queue-rail.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { useRemoteAwareNextSong } from '/@/renderer/features/hub/hooks/use-remote-aware';
import {
    useQueueFolded,
    useQueueRailVisible,
} from '/@/renderer/features/now-playing/hooks/use-right-sidebar-visible';
import {
    useQueueOverlayOpen,
    useSetQueueOverlay,
} from '/@/renderer/layouts/default-layout/use-shell-fit';
import {
    useAppStoreActions,
    useHubIsRemoteActive,
    useHubStore,
    usePlayerData,
} from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';
import { LibraryItem } from '/@/shared/types/domain-types';

/** The queue panel, collapsed: a 44px column with the queue's length, where the panel stands when open. */
export const QueueRail = () => {
    const { t } = useTranslation();
    const visible = useQueueRailVisible();
    const { setSideBar } = useAppStoreActions();
    // On a narrow window the rail opens the panel over the page and leaves the saved flag alone.
    const folded = useQueueFolded();
    const overlayOpen = useQueueOverlayOpen();
    const setQueueOverlay = useSetQueueOverlay();
    // The session's queue, as the window bar counts it: the hub's mirror while another device plays.
    const isRemote = useHubIsRemoteActive();
    const remoteQueueLength = useHubStore((state) => state.remoteQueue.length);
    const local = usePlayerData();
    const queueLength = isRemote ? remoteQueueLength : local.queueLength;
    // What plays next, from the source the player bar and the full-screen player read: the local
    // player's (repeat and shuffle applied), or the hub session's while another device plays.
    const next = useRemoteAwareNextSong();

    if (!visible) return null;

    const open = () =>
        folded ? setQueueOverlay(!overlayOpen) : setSideBar({ rightExpanded: true });
    const nextArtist = next?.artistName || next?.artists?.map((artist) => artist.name).join(', ');
    const nextLabel = next
        ? t('naviConnect.queue.railNext', { artist: nextArtist, title: next.name })
        : undefined;
    // Nothing next in a queue that has songs: its end, with repeat off. An empty queue says Up next.
    const atEnd = queueLength > 0 && !next;

    return (
        <aside className={styles.rail} id="queue-rail">
            <ActionIcon
                aria-label={t('player.viewQueue')}
                className={styles.button}
                icon="queue"
                iconProps={{ size: 'lg' }}
                onClick={open}
                size="compact-md"
                tooltip={{ label: t('player.viewQueue'), position: 'left' }}
                variant="subtle"
            />
            {queueLength > 0 && <span className={styles.count}>{queueLength}</span>}
            <span aria-hidden className={styles.label}>
                {atEnd ? t('naviConnect.queue.endOfQueue') : t('page.fullscreenPlayer.upNext')}
            </span>
            {next && (
                <>
                    <Tooltip label={nextLabel} multiline position="left" w={220}>
                        <button
                            aria-label={nextLabel}
                            className={styles.cover}
                            onClick={open}
                            type="button"
                        >
                            <ItemImage
                                id={next.imageId}
                                itemType={LibraryItem.SONG}
                                serverId={next._serverId}
                                src={next.imageUrl}
                                type="table"
                            />
                        </button>
                    </Tooltip>
                    <span aria-hidden className={styles.next}>
                        <span className={styles.nextTitle}>{next.name}</span>
                        {nextArtist && <span className={styles.nextArtist}>{nextArtist}</span>}
                    </span>
                </>
            )}
        </aside>
    );
};
