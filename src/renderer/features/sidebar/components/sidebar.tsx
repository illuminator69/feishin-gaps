import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './sidebar.module.css';

import { useItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { ContextMenuController } from '/@/renderer/features/context-menu/context-menu-controller';
import { useRemoteAwarePlayerSong } from '/@/renderer/features/hub/hooks/use-remote-aware';
import {
    useIsRadioActive,
    useRadioPlayer,
} from '/@/renderer/features/radio/hooks/use-radio-player';
import { SidebarCollectionList } from '/@/renderer/features/sidebar/components/sidebar-collection-list';
import {
    SidebarGroups,
    SidebarMore,
    useSidebarModel,
} from '/@/renderer/features/sidebar/components/sidebar-groups';
import {
    SidebarPlaylistAddDragContext,
    SidebarPlaylistList,
    SidebarSharedPlaylistList,
    useSidebarPlaylistAddDragMonitor,
} from '/@/renderer/features/sidebar/components/sidebar-playlist-list';
import {
    useAppStore,
    useAppStoreActions,
    useFullScreenPlayerStore,
    useGeneralSettings,
    useImagePlaceholderPriority,
    useSetFullScreenPlayerStore,
} from '/@/renderer/store';
import {
    useSidebarImageEnabled,
    useSidebarPlaylistList,
    useWindowSettings,
} from '/@/renderer/store/settings.store';
import { Accordion } from '/@/shared/components/accordion/accordion';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Center } from '/@/shared/components/center/center';
import { Icon } from '/@/shared/components/icon/icon';
import { ImageUnloader } from '/@/shared/components/image/image';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';
import { useImageHashUrl } from '/@/shared/hooks/use-image-hash-url';
import { ExplicitStatus, LibraryItem } from '/@/shared/types/domain-types';
import { Platform } from '/@/shared/types/types';

const SidebarPlaylistSection = () => {
    const isAddDragActive = useSidebarPlaylistAddDragMonitor();

    return (
        <SidebarPlaylistAddDragContext.Provider value={isAddDragActive}>
            <SidebarPlaylistList />
            <SidebarSharedPlaylistList />
        </SidebarPlaylistAddDragContext.Provider>
    );
};

export const Sidebar = () => {
    const sidebarPlaylistList = useSidebarPlaylistList();
    const { windowBarStyle } = useWindowSettings();
    const sidebarImageEnabled = useSidebarImageEnabled();
    const sidebarImageShown = useAppStore((state) => state.sidebar.image);
    const showImage = sidebarImageEnabled && sidebarImageShown;
    const { groups, more } = useSidebarModel();
    const mainGroups = groups.filter((group) => group.id === 'main');
    const lowerGroups = groups.filter((group) => group.id !== 'main');

    const isCustomWindowBar =
        windowBarStyle === Platform.WINDOWS || windowBarStyle === Platform.MACOS;

    return (
        <div
            className={clsx(styles.container, {
                [styles.customBar]: isCustomWindowBar,
            })}
            id="left-sidebar"
        >
            <ScrollArea allowDragScroll className={styles.scrollArea}>
                <SidebarGroups groups={mainGroups} />
                <Accordion
                    classNames={{
                        content: styles.accordionContent,
                        control: styles.accordionControl,
                        item: styles.accordionItem,
                    }}
                    defaultValue={['collections', 'playlists']}
                    multiple
                >
                    <SidebarCollectionList />
                    {sidebarPlaylistList && <SidebarPlaylistSection />}
                </Accordion>
            </ScrollArea>
            <div className={styles.groupStack}>
                <SidebarGroups groups={lowerGroups} />
                {more.length > 0 && <SidebarMore entries={more} />}
            </div>
            <AnimatePresence initial={false} mode="popLayout">
                {showImage && <SidebarImage />}
            </AnimatePresence>
        </div>
    );
};

const SidebarImage = () => {
    const { t } = useTranslation();
    const { setSideBar } = useAppStoreActions();
    // navi-connect: the expanded-sidebar cover follows the SESSION — reading the local
    // (paused, pre-transfer) player left it frozen on the last locally-played track while
    // a remote device played on. Same reasoning as the playerbar and the full-screen view.
    const currentSong = useRemoteAwarePlayerSong();
    const isRadioActive = useIsRadioActive();
    const { currentStationArt } = useRadioPlayer();
    const { blurExplicitImages } = useGeneralSettings();

    const imageUrl = useItemImageUrl({
        id: currentSong?.imageId || undefined,
        itemType: LibraryItem.SONG,
        serverId: currentSong?._serverId,
        type: 'sidebar',
    });
    const imagePlaceholderPriority = useImagePlaceholderPriority();
    const songHashUrl = useImageHashUrl(
        currentSong?.thumbHash,
        currentSong?.blurHash,
        imagePlaceholderPriority,
    );

    const radioImageUrl = useItemImageUrl({
        id: isRadioActive ? currentStationArt?.imageId || undefined : undefined,
        imageUrl: isRadioActive ? currentStationArt?.imageUrl || undefined : undefined,
        itemType: LibraryItem.RADIO_STATION,
        serverId: isRadioActive ? currentStationArt?.serverId : undefined,
        type: 'sidebar',
    });

    const isSongDefined = Boolean(currentSong?.id);

    const setFullScreenPlayerStore = useSetFullScreenPlayerStore();
    const { expanded: isFullScreenPlayerExpanded } = useFullScreenPlayerStore();
    const expandFullScreenPlayer = () => {
        setFullScreenPlayerStore({ expanded: !isFullScreenPlayerExpanded });
    };

    const handleToggleContextMenu = (e: MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();

        if (!currentSong || isRadioActive) {
            return;
        }

        if (isSongDefined && !isFullScreenPlayerExpanded) {
            ContextMenuController.call({
                cmd: { items: [currentSong!], type: LibraryItem.SONG },
                event: e,
            });
        }
    };

    return (
        <motion.div
            animate={{ opacity: 1, y: 0 }}
            className={styles.imageContainer}
            exit={{ opacity: 0, y: 200 }}
            initial={{ opacity: 0, y: 200 }}
            key="sidebar-image"
            onClick={expandFullScreenPlayer}
            onContextMenu={handleToggleContextMenu}
            role="button"
            style={{ aspectRatio: 1 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
        >
            <Tooltip label={t('player.toggleFullscreenPlayer')}>
                {isRadioActive && radioImageUrl ? (
                    <img className={styles.sidebarImage} loading="eager" src={radioImageUrl} />
                ) : isRadioActive ? (
                    <Center
                        className={styles.sidebarImage}
                        style={{
                            background: 'var(--theme-colors-surface)',
                            borderRadius: 'var(--theme-card-default-radius)',
                            height: '100%',
                            width: '100%',
                        }}
                    >
                        <Icon color="muted" icon="radio" size="40%" />
                    </Center>
                ) : imageUrl ? (
                    <img
                        className={clsx(styles.sidebarImage, {
                            [styles.censored]:
                                currentSong?.explicitStatus === ExplicitStatus.EXPLICIT &&
                                blurExplicitImages,
                        })}
                        loading="eager"
                        src={imageUrl}
                        style={
                            songHashUrl
                                ? {
                                      backgroundImage: `url(${songHashUrl})`,
                                      backgroundPosition: 'center',
                                      backgroundSize: 'cover',
                                  }
                                : undefined
                        }
                    />
                ) : (
                    <ImageUnloader icon="emptySongImage" />
                )}
            </Tooltip>
            <ActionIcon
                icon="arrowDownS"
                iconProps={{
                    size: 'lg',
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    setSideBar({ image: false });
                }}
                opacity={0.8}
                radius="md"
                style={{
                    cursor: 'default',
                    position: 'absolute',
                    right: '1rem',
                    top: '1rem',
                }}
                tooltip={{
                    label: t('common.collapse'),
                    openDelay: 500,
                }}
            />
        </motion.div>
    );
};
