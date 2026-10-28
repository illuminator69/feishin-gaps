import { useTranslation } from 'react-i18next';

import styles from './queue-rail.module.css';

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

    if (!visible) return null;

    return (
        <aside className={styles.rail} id="queue-rail">
            <ActionIcon
                aria-label={t('player.viewQueue')}
                className={styles.button}
                icon="queue"
                iconProps={{ size: 'lg' }}
                onClick={() =>
                    folded ? setQueueOverlay(!overlayOpen) : setSideBar({ rightExpanded: true })
                }
                size="compact-md"
                tooltip={{ label: t('player.viewQueue'), position: 'left' }}
                variant="subtle"
            />
            {queueLength > 0 && <span className={styles.count}>{queueLength}</span>}
            <span aria-hidden className={styles.label}>
                {t('page.fullscreenPlayer.upNext')}
            </span>
        </aside>
    );
};
