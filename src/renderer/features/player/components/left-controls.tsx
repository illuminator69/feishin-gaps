import clsx from 'clsx';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, Link } from 'react-router';
import { shallow } from 'zustand/shallow';

import styles from './left-controls.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import {
    JOINED_ARTISTS_MUTED_PROPS,
    JoinedArtists,
} from '/@/renderer/features/albums/components/joined-artists';
import { ContextMenuController } from '/@/renderer/features/context-menu/context-menu-controller';
import { useRemoteAwarePlayerSong } from '/@/renderer/features/hub/hooks/use-remote-aware';
import { RadioMetadataDisplay } from '/@/renderer/features/player/components/radio-metadata-display';
import {
    useIsRadioActive,
    useRadioPlayer,
} from '/@/renderer/features/radio/hooks/use-radio-player';
import { useHotkeys } from '/@/renderer/hooks/use-hotkeys';
import { AppRoute } from '/@/renderer/router/routes';
import {
    useAppStore,
    useAppStoreActions,
    useFullScreenPlayerStore,
    useHotkeySettings,
    useHubActiveDeviceName,
    useHubIsRemoteActive,
    useSetFullScreenPlayerStore,
    useSidebarImageEnabled,
} from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { DURATION, EASING } from '/@/shared/components/animations/motion-tokens';
import { useExpressiveMotion } from '/@/shared/components/animations/use-expressive-motion';
import { Center } from '/@/shared/components/center/center';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { Text } from '/@/shared/components/text/text';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';
import { PlaybackSelectors } from '/@/shared/constants/playback-selectors';
import { LibraryItem } from '/@/shared/types/domain-types';

export const LeftControls = () => {
    const { t } = useTranslation();
    const { setSideBar } = useAppStoreActions();
    const {
        expanded: isFullScreenPlayerExpanded,
        visualizerExpanded: isFullScreenVisualizerExpanded,
    } = useFullScreenPlayerStore();
    const setFullScreenPlayerStore = useSetFullScreenPlayerStore();

    const { collapsed: sidebarCollapsed, image: sidebarImageShown } = useAppStore(
        (state) => ({
            collapsed: state.sidebar.collapsed,
            image: state.sidebar.image,
        }),
        shallow,
    );

    const currentSong = useRemoteAwarePlayerSong();
    const motionEnabled = useExpressiveMotion();
    const isRemote = useHubIsRemoteActive();
    const remoteDeviceName = useHubActiveDeviceName();
    const isRadioActive = useIsRadioActive();
    const { currentStationArt } = useRadioPlayer();
    const { bindings } = useHotkeySettings();
    const sidebarImageEnabled = useSidebarImageEnabled();

    const isRadioMode = isRadioActive;
    const hasRadioStationImage = Boolean(currentStationArt?.imageId || currentStationArt?.imageUrl);
    const hideImage = !sidebarCollapsed && sidebarImageEnabled && sidebarImageShown;
    const isSongDefined = Boolean(currentSong?.id) && !isRadioMode;
    const title = currentSong?.name;
    const artists = currentSong?.artists;

    // With Expressive motion on, key the artwork by the current track (or radio station) so a
    // song switch crossfades/slides the cover in the player bar instead of swapping instantly.
    // Off: a constant key keeps the prior behaviour (no per-song animation).
    const artworkKey = currentSong?.id ?? currentStationArt?.imageId ?? 'none';

    const handleToggleFullScreenPlayer = (e?: KeyboardEvent | MouseEvent<HTMLDivElement>) => {
        // don't toggle if right click
        if (e && 'button' in e && e.button === 2) {
            return;
        }

        e?.stopPropagation();

        const shouldClose = isFullScreenPlayerExpanded || isFullScreenVisualizerExpanded;

        if (shouldClose) {
            setFullScreenPlayerStore({
                expanded: false,
                visualizerExpanded: false,
                visualizerReturnToPlayer: false,
            });
        } else {
            setFullScreenPlayerStore({ expanded: true });
        }
    };

    const handleToggleSidebarImage = (e?: MouseEvent<HTMLButtonElement>) => {
        e?.stopPropagation();
        setSideBar({ image: true });
    };

    const handleToggleContextMenu = (e: MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();

        if (!currentSong) {
            return;
        }

        ContextMenuController.call({
            cmd: { items: [currentSong], type: LibraryItem.SONG },
            event: e,
        });
    };

    const stopPropagation = (e?: MouseEvent) => e?.stopPropagation();

    useHotkeys([
        [
            bindings.toggleFullscreenPlayer.allowGlobal
                ? ''
                : bindings.toggleFullscreenPlayer.hotkey,
            handleToggleFullScreenPlayer,
        ],
    ]);

    return (
        <div className={styles.leftControlsContainer}>
            <LayoutGroup>
                <AnimatePresence initial={false} mode="popLayout">
                    {!hideImage && (
                        <div className={styles.imageWrapper}>
                            <motion.div
                                animate={{ opacity: 1, scale: 1, x: 0 }}
                                className={styles.image}
                                exit={{ opacity: 0, x: -50 }}
                                initial={{ opacity: 0, x: -50 }}
                                key={
                                    motionEnabled
                                        ? `playerbar-image-${artworkKey}`
                                        : 'playerbar-image'
                                }
                                onClick={handleToggleFullScreenPlayer}
                                onContextMenu={handleToggleContextMenu}
                                role="button"
                                transition={
                                    motionEnabled
                                        ? {
                                              duration: DURATION.medium2 / 1000,
                                              ease: EASING.emphasized,
                                          }
                                        : { duration: 0.2, ease: 'easeOut' }
                                }
                            >
                                <Tooltip label={t('player.toggleFullscreenPlayer')}>
                                    {isRadioMode && hasRadioStationImage ? (
                                        <ItemImage
                                            className={clsx(
                                                styles.playerbarImage,
                                                PlaybackSelectors.playerCoverArt,
                                            )}
                                            enableDebounce={false}
                                            enableViewport={false}
                                            fetchPriority="high"
                                            id={currentStationArt?.imageId ?? undefined}
                                            itemType={LibraryItem.RADIO_STATION}
                                            serverId={currentStationArt?.serverId}
                                            src={currentStationArt?.imageUrl ?? ''}
                                            thumbHash={currentStationArt?.thumbHash ?? null}
                                            type="table"
                                        />
                                    ) : isRadioMode ? (
                                        <Center
                                            className={clsx(
                                                styles.playerbarImage,
                                                styles.radioImage,
                                            )}
                                        >
                                            <Icon color="muted" icon="radio" size="40%" />
                                        </Center>
                                    ) : (
                                        <ItemImage
                                            blurHash={currentSong?.blurHash}
                                            className={clsx(
                                                styles.playerbarImage,
                                                PlaybackSelectors.playerCoverArt,
                                            )}
                                            enableDebounce={false}
                                            enableViewport={false}
                                            explicitStatus={currentSong?.explicitStatus}
                                            fetchPriority="high"
                                            id={currentSong?.imageId}
                                            itemType={LibraryItem.SONG}
                                            serverId={currentSong?._serverId}
                                            src={currentSong?.imageUrl ?? undefined}
                                            thumbHash={currentSong?.thumbHash}
                                            type="table"
                                        />
                                    )}
                                </Tooltip>
                                {!sidebarCollapsed && sidebarImageEnabled && (
                                    <ActionIcon
                                        className={styles.toggleButton}
                                        icon="arrowUpS"
                                        iconProps={{ size: 'xl' }}
                                        onClick={handleToggleSidebarImage}
                                        opacity={0.8}
                                        radius="md"
                                        size="xs"
                                        tooltip={{
                                            label: t('common.expand'),
                                            openDelay: 0,
                                        }}
                                    />
                                )}
                            </motion.div>
                        </div>
                    )}
                </AnimatePresence>
                <motion.div className={styles.metadataStack} layout="position">
                    {isRadioMode ? (
                        <RadioMetadataDisplay
                            onStopPropagation={stopPropagation}
                            onToggleContextMenu={handleToggleContextMenu}
                        />
                    ) : (
                        <>
                            {isRemote && (
                                <div className={styles.lineItem} onClick={stopPropagation}>
                                    <Group align="center" gap="xs" wrap="nowrap">
                                        <Icon color="success" icon="radio" size="sm" />
                                        <Text isMuted overflow="hidden" size="xs">
                                            {t('player.playingOnDevice', {
                                                defaultValue: 'Playing on {{device}}',
                                                device: remoteDeviceName,
                                            })}
                                        </Text>
                                    </Group>
                                </div>
                            )}
                            <div className={styles.lineItem} onClick={stopPropagation}>
                                <Group align="center" gap="xs" wrap="nowrap">
                                    <Text
                                        className={PlaybackSelectors.songTitle}
                                        component={Link}
                                        fw={500}
                                        isLink
                                        onContextMenu={handleToggleContextMenu}
                                        overflow="hidden"
                                        to={AppRoute.NOW_PLAYING}
                                    >
                                        {title || '—'}
                                        {currentSong?.trackSubtitle && (
                                            <Text component="span" isMuted size="sm">
                                                {' ('}
                                                {currentSong.trackSubtitle}
                                                {')'}
                                            </Text>
                                        )}
                                    </Text>
                                    {isSongDefined && (
                                        <ActionIcon
                                            icon="ellipsisVertical"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                if (currentSong) {
                                                    ContextMenuController.call({
                                                        cmd: {
                                                            items: [currentSong],
                                                            type: LibraryItem.SONG,
                                                        },
                                                        event: e,
                                                    });
                                                }
                                            }}
                                            size="xs"
                                            styles={{
                                                root: {
                                                    '--ai-size-xs': '1.15rem',
                                                },
                                            }}
                                            variant="subtle"
                                        />
                                    )}
                                </Group>
                            </div>
                            <div
                                className={clsx(
                                    styles.lineItem,
                                    styles.secondary,
                                    PlaybackSelectors.songArtist,
                                )}
                                onClick={stopPropagation}
                            >
                                <JoinedArtists
                                    artistName={currentSong?.artistName || ''}
                                    // Track artists, not album artists — the ids come
                                    // from `song.artists`.
                                    artistRoute="artist"
                                    artists={artists || []}
                                    linkProps={{
                                        ...JOINED_ARTISTS_MUTED_PROPS.linkProps,
                                        size: 'md',
                                    }}
                                    rootTextProps={{
                                        ...JOINED_ARTISTS_MUTED_PROPS.rootTextProps,
                                        className: styles.joinedArtists,
                                        size: 'md',
                                    }}
                                />
                            </div>
                            <div
                                className={clsx(
                                    styles.lineItem,
                                    styles.secondary,
                                    PlaybackSelectors.songAlbum,
                                )}
                                onClick={stopPropagation}
                            >
                                {/* `to=''` is a RELATIVE link, and the playerbar sits in a
                                    pathless layout route whose base is `/` — so with no
                                    album id it resolved to the home page. With no id there
                                    is nothing to navigate to: render plain text. */}
                                <Text
                                    component={currentSong?.albumId ? Link : undefined}
                                    fw={500}
                                    isLink={Boolean(currentSong?.albumId)}
                                    overflow="hidden"
                                    size="md"
                                    to={
                                        currentSong?.albumId
                                            ? generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, {
                                                  albumId: currentSong.albumId,
                                              })
                                            : undefined
                                    }
                                >
                                    {currentSong?.album || '—'}
                                </Text>
                            </div>
                        </>
                    )}
                </motion.div>
            </LayoutGroup>
        </div>
    );
};
