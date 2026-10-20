import { t } from 'i18next';
import { useCallback, useEffect, useState, WheelEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { HubDevicePicker } from '/@/renderer/features/hub/components/hub-device-picker';
import {
    useRemoteAwarePlayerSong,
    useRemoteAwareVolume,
} from '/@/renderer/features/hub/hooks/use-remote-aware';
import {
    SliderHold,
    sliderHoldRemaining,
    VOLUME_HOLD_MS,
} from '/@/renderer/features/hub/utils/volume-hold';
import { PopoverPlayQueue } from '/@/renderer/features/now-playing/components/popover-play-queue';
import { DlnaVolumeButton } from '/@/renderer/features/player/components/dlna/volume-button';
import { MoreControl } from '/@/renderer/features/player/components/more-control';
import { CustomPlayerbarSlider } from '/@/renderer/features/player/components/playerbar-slider';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { toggleLyrics } from '/@/renderer/features/player/utils/toggle-lyrics';
import { useAudioDevices } from '/@/renderer/features/settings/components/playback/audio-settings';
import { useSetRating } from '/@/renderer/features/shared/hooks/use-set-rating';
import { useCreateFavorite } from '/@/renderer/features/shared/mutations/create-favorite-mutation';
import { useDeleteFavorite } from '/@/renderer/features/shared/mutations/delete-favorite-mutation';
import { useHotkeys } from '/@/renderer/hooks/use-hotkeys';
import {
    useAppStoreActions,
    useCurrentServer,
    useFullScreenPlayerStore,
    useHotkeySettings,
    useHubActiveDeviceId,
    useHubIsRemoteActive,
    usePlaybackSettings,
    usePlaybackType,
    usePlayerData,
    usePlayerMuted,
    useSettingsStoreActions,
    useShowFavorites,
    useShowRatings,
    useSidebarRightExpanded,
    useSideQueueType,
    useVolumeWheelStep,
    useVolumeWidth,
} from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { Flex } from '/@/shared/components/flex/flex';
import { Group } from '/@/shared/components/group/group';
import { Rating } from '/@/shared/components/rating/rating';
import { useMediaQuery } from '/@/shared/hooks/use-media-query';
import { useThrottledCallback } from '/@/shared/hooks/use-throttled-callback';
import { LibraryItem, QueueSong, ServerType } from '/@/shared/types/domain-types';
import { PlayerType } from '/@/shared/types/types';

export const RightControls = () => {
    const showRatings = useShowRatings();
    const showFavorites = useShowFavorites();
    const playbackType = usePlaybackType();
    return (
        <Flex align="flex-end" direction="column" h="100%" px="1rem" py="0.5rem">
            <Group h="calc(100% / 3)">{showRatings && <RatingButton />}</Group>
            <Group align="center" gap="xs" wrap="nowrap">
                <HubDevicePicker />
                <LyricsButton />
                {showFavorites && <FavoriteButton />}
                <QueueButton />
                <MoreControl />
                {playbackType === PlayerType.DLNA ? <DlnaVolumeButton /> : <VolumeButton />}
            </Group>
            <Group h="calc(100% / 3)" />
        </Flex>
    );
};

const QueueButton = () => {
    const { t } = useTranslation();
    const isSidebarRightExpanded = useSidebarRightExpanded();
    const { setSideBar } = useAppStoreActions();
    const sideQueueType = useSideQueueType();
    const { bindings } = useHotkeySettings();
    const [popoverOpened, setPopoverOpened] = useState(false);
    const handleToggleQueue = () => {
        if (sideQueueType === 'sideQueue') setSideBar({ rightExpanded: !isSidebarRightExpanded });
        else setPopoverOpened((prev) => !prev);
    };
    useHotkeys([
        [bindings.toggleQueue.isGlobal ? '' : bindings.toggleQueue.hotkey, handleToggleQueue],
    ]);
    if (sideQueueType === 'sideQueue') {
        return (
            <ActionIcon
                icon={isSidebarRightExpanded ? 'panelRightClose' : 'panelRightOpen'}
                iconProps={{ size: 'lg' }}
                onClick={(e) => {
                    e.stopPropagation();
                    handleToggleQueue();
                }}
                size="sm"
                tooltip={{
                    label: t('player.viewQueue'),
                    openDelay: 0,
                }}
                variant="subtle"
            />
        );
    }
    return (
        <PopoverPlayQueue
            onClose={() => setPopoverOpened(false)}
            onToggle={(e) => {
                e.stopPropagation();
                handleToggleQueue();
            }}
            opened={popoverOpened}
        />
    );
};

const LyricsButton = () => {
    const activeTab = useFullScreenPlayerStore((state) => state.activeTab);
    const { expanded: isFullScreenPlayerExpanded } = useFullScreenPlayerStore();

    return (
        <ActionIcon
            icon="microphone"
            iconProps={{
                color: activeTab === 'lyrics' && isFullScreenPlayerExpanded ? 'primary' : undefined,
                size: 'lg',
            }}
            onClick={(e) => {
                e.stopPropagation();
                toggleLyrics();
            }}
            role="button"
            size="sm"
            tooltip={{
                label: t('player.lyrics'),
                openDelay: 0,
            }}
            variant="subtle"
        />
    );
};

const FavoriteButton = () => {
    const currentSong = useRemoteAwarePlayerSong();
    const { bindings } = useHotkeySettings();
    const addToFavoritesMutation = useCreateFavorite({});
    const removeFromFavoritesMutation = useDeleteFavorite({});
    const handleAddToFavorites = (song: QueueSong | undefined) => {
        if (!song?.id) return;
        addToFavoritesMutation.mutate({
            apiClientProps: { serverId: song._serverId || '' },
            query: { id: [song.id], type: LibraryItem.SONG },
        });
    };
    const handleRemoveFromFavorites = (song: QueueSong | undefined) => {
        if (!song?.id) return;
        removeFromFavoritesMutation.mutate({
            apiClientProps: { serverId: song._serverId || '' },
            query: { id: [song.id], type: LibraryItem.SONG },
        });
    };
    const handleToggleFavorite = (song: QueueSong | undefined) => {
        if (!song?.id) return;
        song.userFavorite ? handleRemoveFromFavorites(song) : handleAddToFavorites(song);
    };
    useFavoritePreviousSongHotkeys({
        handleAddToFavorites,
        handleRemoveFromFavorites,
        handleToggleFavorite,
    });
    useHotkeys([
        [
            bindings.favoriteCurrentAdd.isGlobal ? '' : bindings.favoriteCurrentAdd.hotkey,
            () => handleAddToFavorites(currentSong),
        ],
        [
            bindings.favoriteCurrentRemove.isGlobal ? '' : bindings.favoriteCurrentRemove.hotkey,
            () => handleRemoveFromFavorites(currentSong),
        ],
        [
            bindings.favoriteCurrentToggle.isGlobal ? '' : bindings.favoriteCurrentToggle.hotkey,
            () => handleToggleFavorite(currentSong),
        ],
    ]);
    return (
        <ActionIcon
            icon="favorite"
            iconProps={{ fill: currentSong?.userFavorite ? 'primary' : undefined, size: 'lg' }}
            onClick={(e) => {
                e.stopPropagation();
                handleToggleFavorite(currentSong);
            }}
            size="sm"
            tooltip={{
                label: currentSong?.userFavorite ? t('player.unfavorite') : t('player.favorite'),
                openDelay: 0,
            }}
            variant="subtle"
        />
    );
};

const useFavoritePreviousSongHotkeys = ({
    handleAddToFavorites,
    handleRemoveFromFavorites,
    handleToggleFavorite,
}: {
    handleAddToFavorites: (song: QueueSong | undefined) => void;
    handleRemoveFromFavorites: (song: QueueSong | undefined) => void;
    handleToggleFavorite: (song: QueueSong | undefined) => void;
}) => {
    const { bindings } = useHotkeySettings();
    const { previousSong } = usePlayerData();
    useHotkeys([
        [
            bindings.favoritePreviousAdd.isGlobal ? '' : bindings.favoritePreviousAdd.hotkey,
            () => handleAddToFavorites(previousSong),
        ],
        [
            bindings.favoritePreviousRemove.isGlobal ? '' : bindings.favoritePreviousRemove.hotkey,
            () => handleRemoveFromFavorites(previousSong),
        ],
        [
            bindings.favoritePreviousToggle.isGlobal ? '' : bindings.favoritePreviousToggle.hotkey,
            () => handleToggleFavorite(previousSong),
        ],
    ]);
    return null;
};

const RatingButton = () => {
    const server = useCurrentServer();
    const currentSong = useRemoteAwarePlayerSong();
    const setRating = useSetRating();
    const { bindings } = useHotkeySettings();
    const isSongDefined = Boolean(currentSong?.id);
    const showRating =
        isSongDefined &&
        (server?.type === ServerType.NAVIDROME || server?.type === ServerType.SUBSONIC);
    const handleUpdateRating = (rating: number) => {
        if (!currentSong) return;
        setRating(currentSong._serverId, [currentSong.id], LibraryItem.SONG, rating);
    };
    useHotkeys([
        [bindings.rate0.isGlobal ? '' : bindings.rate0.hotkey, () => handleUpdateRating(0)],
        [bindings.rate1.isGlobal ? '' : bindings.rate1.hotkey, () => handleUpdateRating(1)],
        [bindings.rate2.isGlobal ? '' : bindings.rate2.hotkey, () => handleUpdateRating(2)],
        [bindings.rate3.isGlobal ? '' : bindings.rate3.hotkey, () => handleUpdateRating(3)],
        [bindings.rate4.isGlobal ? '' : bindings.rate4.hotkey, () => handleUpdateRating(4)],
        [bindings.rate5.isGlobal ? '' : bindings.rate5.hotkey, () => handleUpdateRating(5)],
    ]);
    return (
        <>
            {showRating && (
                <Rating
                    onChange={handleUpdateRating}
                    size="xs"
                    value={currentSong?.userRating || 0}
                />
            )}
        </>
    );
};

const VolumeButton = () => {
    const { bindings } = useHotkeySettings();
    const volume = useRemoteAwareVolume();
    // Whose volume that is: the active remote device's, or (null) this machine's.
    const isRemote = useHubIsRemoteActive();
    const activeDeviceId = useHubActiveDeviceId();
    const volumeScope = isRemote ? activeDeviceId : null;
    const muted = usePlayerMuted();
    const volumeWheelStep = useVolumeWheelStep();
    const volumeWidth = useVolumeWidth();
    const { decreaseVolume, increaseVolume, mediaToggleMute, setVolume } = usePlayer();
    const isMinWidth = useMediaQuery('(max-width: 480px)');

    const playbackType = usePlaybackType();
    const playbackSettings = usePlaybackSettings();
    const { setSettings } = useSettingsStoreActions();
    const audioDevices = useAudioDevices(playbackType);

    const currentAudioDeviceId =
        playbackType === PlayerType.LOCAL
            ? playbackSettings.mpvAudioDeviceId
            : playbackSettings.audioDeviceId;

    const handleSelectAudioDevice = useCallback(
        (deviceId: null | string) => {
            setSettings({
                playback:
                    playbackType === PlayerType.LOCAL
                        ? { mpvAudioDeviceId: deviceId }
                        : { audioDeviceId: deviceId },
            });
        },
        [playbackType, setSettings],
    );

    // navi-connect: the slider shows its own value only while it is being dragged, and once let
    // go until the level it asked for is observed (or 2.5 s pass); the rest of the time it shows
    // `volume`. It used to be a copy of `volume`, kept in step by one effect while a second
    // effect sent every change of the copy. On a remote device `volume` is the hub's echo of
    // what was sent, so each echo overwrote the drag and was then sent back, anything changed
    // elsewhere was sent back once, and mounting sent one too. Now the slider is the only thing
    // that sends, and only when it is moved (volume-hold.ts).
    const [sliderHold, setSliderHold] = useState<null | SliderHold>(null);
    const sendVolume = useThrottledCallback(setVolume, 100);

    useEffect(() => {
        if (!sliderHold) return undefined;
        const left = sliderHoldRemaining(sliderHold, volumeScope, volume, Date.now());
        if (left === 0) {
            setSliderHold(null);
            return undefined;
        }
        const timer = setTimeout(() => setSliderHold(null), left);
        return () => clearTimeout(timer);
    }, [sliderHold, volume, volumeScope]);

    // A hold made on another device's volume is not shown for even one frame.
    const sliderValue = sliderHold && sliderHold.scope === volumeScope ? sliderHold.value : volume;

    const handleVolumeDown = useCallback(() => {
        decreaseVolume(volumeWheelStep);
    }, [decreaseVolume, volumeWheelStep]);

    const handleVolumeUp = useCallback(() => {
        increaseVolume(volumeWheelStep);
    }, [increaseVolume, volumeWheelStep]);

    const handleVolumeSlider = useCallback(
        (e: number) => {
            setSliderHold({
                dragging: true,
                scope: volumeScope,
                until: Date.now() + VOLUME_HOLD_MS,
                value: e,
            });
            sendVolume(e);
        },
        [sendVolume, volumeScope],
    );

    // The value itself was sent by the change before it - the throttle always delivers the last.
    const handleVolumeSliderEnd = useCallback(
        (e: number) => {
            setSliderHold({
                dragging: false,
                scope: volumeScope,
                until: Date.now() + VOLUME_HOLD_MS,
                value: e,
            });
        },
        [volumeScope],
    );

    const handleMute = useCallback(() => {
        mediaToggleMute();
    }, [mediaToggleMute]);

    // navi-connect: through the player context, like the hotkeys below. On this machine that is
    // the same step from the same volume as before. On a remote device it steps from the level
    // last asked for instead of a `devices` frame that has not caught up, so notches inside one
    // round trip add up rather than each repeating the first.
    const handleVolumeWheel = useCallback(
        (e: WheelEvent<HTMLButtonElement | HTMLDivElement>) => {
            if (e.deltaY > 0 || e.deltaX > 0) {
                handleVolumeDown();
            } else {
                handleVolumeUp();
            }
        },
        [handleVolumeDown, handleVolumeUp],
    );

    const handleVolumeDownThrottled = useThrottledCallback(handleVolumeDown, 100);
    const handleVolumeUpThrottled = useThrottledCallback(handleVolumeUp, 100);

    useHotkeys([
        [bindings.volumeDown.isGlobal ? '' : bindings.volumeDown.hotkey, handleVolumeDownThrottled],
        [bindings.volumeUp.isGlobal ? '' : bindings.volumeUp.hotkey, handleVolumeUpThrottled],
        [bindings.volumeMute.isGlobal ? '' : bindings.volumeMute.hotkey, handleMute],
    ]);

    return (
        <>
            <ContextMenu>
                <ContextMenu.Target>
                    {/*
                     * ActionIcon renders a Mantine Tooltip wrapper, which does not
                     * forward the onContextMenu/ref that Radix injects via asChild to
                     * the underlying button. Wrap in a real DOM node so right-click
                     * reliably opens the menu.
                     */}
                    <div style={{ alignItems: 'center', display: 'flex' }}>
                        <ActionIcon
                            icon={muted ? 'volumeMute' : volume > 50 ? 'volumeMax' : 'volumeNormal'}
                            iconProps={{
                                color: muted ? 'muted' : undefined,
                                size: 'xl',
                            }}
                            onClick={(e) => {
                                e.stopPropagation();
                                handleMute();
                            }}
                            onWheel={handleVolumeWheel}
                            size="sm"
                            tooltip={{
                                label: muted ? t('player.muted') : volume,
                                openDelay: 0,
                            }}
                            variant="subtle"
                        />
                    </div>
                </ContextMenu.Target>
                <ContextMenu.Content>
                    <ContextMenu.Item
                        isSelected={!currentAudioDeviceId}
                        onSelect={() => handleSelectAudioDevice(null)}
                    >
                        {t('setting.audioDeviceDefault', { defaultValue: 'System default' })}
                    </ContextMenu.Item>
                    {audioDevices.length > 0 && <ContextMenu.Divider />}
                    {audioDevices.map((device) => (
                        <ContextMenu.Item
                            isSelected={device.value === currentAudioDeviceId}
                            key={device.value}
                            onSelect={() => handleSelectAudioDevice(device.value)}
                        >
                            {device.label || device.value}
                        </ContextMenu.Item>
                    ))}
                </ContextMenu.Content>
            </ContextMenu>
            {!isMinWidth ? (
                <CustomPlayerbarSlider
                    max={100}
                    min={0}
                    onChange={handleVolumeSlider}
                    onChangeEnd={handleVolumeSliderEnd}
                    onClick={(e) => {
                        e.stopPropagation();
                    }}
                    onWheel={handleVolumeWheel}
                    size={6}
                    value={sliderValue}
                    w={volumeWidth}
                />
            ) : null}
        </>
    );
};
