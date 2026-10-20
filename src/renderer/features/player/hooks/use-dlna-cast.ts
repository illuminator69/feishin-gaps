import type { DlnaDevice, GroupMember } from '/@/renderer/features/player/components/dlna/types';

import isElectron from 'is-electron';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { playerHandoff } from '/@/renderer/features/player/audio-player/engine/player-handoff';
import {
    usePlaybackSettings,
    usePlayerActions,
    usePlayerStore,
    usePlayerVolume,
    useSettingsStoreActions,
} from '/@/renderer/store';
import { useTimestampStoreBase } from '/@/renderer/store/timestamp.store';
import { toast } from '/@/shared/components/toast/toast';
import { PlayerStatus, PlayerType } from '/@/shared/types/types';

const dlnaPlayer = isElectron() ? window.api.dlnaPlayer : null;
const dlnaPlayerListener = isElectron() ? window.api.dlnaPlayerListener : null;

type Screen = 'connected' | 'connecting' | 'expand-group' | 'group' | 'group-build' | 'idle';

export function isSonosDevice(device: DlnaDevice): boolean {
    return device.id.toUpperCase().includes('RINCON');
}

/**
 * The DLNA cast feature's state: discovery, the connection, Sonos groups, and the listeners for
 * the main process's DLNA events. Mounted by the player bar's More control whether or not its
 * panel is open, so the listeners keep running (F1). `visible`: the panel is on screen (the
 * Shift key is watched only then); `onClose`: called when a disconnect should close it.
 */
export const useDlnaCast = (visible: boolean, onClose: () => void) => {
    const { setSettings } = useSettingsStoreActions();
    const { t } = useTranslation();
    const { mediaPause, setVolume } = usePlayerActions();
    const volume = usePlayerVolume();
    const settings = usePlaybackSettings();

    const [screen, setScreen] = useState<Screen>('idle');
    const [devices, setDevices] = useState<DlnaDevice[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [connectedDeviceName, setConnectedDeviceName] = useState('');
    const [groupMemberList, setGroupMemberList] = useState<GroupMember[]>([]);
    const [isShiftDown, setIsShiftDown] = useState(false);
    const coordinatorRef = useRef<DlnaDevice | null>(null);

    const previousPlayerTypeRef = useRef<PlayerType>(
        settings.type === PlayerType.DLNA ? PlayerType.WEB : settings.type,
    );

    const isConnected = settings.type === PlayerType.DLNA;
    const hasSonosDevices = devices.some(isSonosDevice);
    useEffect(() => {
        if (!visible) return;
        const onKey = (e: KeyboardEvent) => setIsShiftDown(e.shiftKey);
        window.addEventListener('keydown', onKey);
        window.addEventListener('keyup', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('keyup', onKey);
            setIsShiftDown(false);
        };
    }, [visible]);
    useEffect(() => {
        if (!dlnaPlayerListener) return;
        const handler = (
            _: unknown,
            payload: { message: string; type: 'error' | 'info' | 'warning' },
        ) => {
            if (payload.type === 'error') {
                toast.error({ message: payload.message });
            } else if (payload.type === 'warning') {
                toast.warn?.({ message: payload.message });
            } else {
                toast.info?.({ message: payload.message });
            }
        };
        return dlnaPlayerListener.rendererDlnaToast(handler);
    }, []);

    useEffect(() => {
        if (!dlnaPlayerListener) return;
        const handleGroupState = (_: unknown, state: GroupMember[]) => {
            setGroupMemberList(state);
            if (state.length > 1) {
                setScreen('group');
                setConnectedDeviceName(t('dlna.castingToGroup', { count: state.length }));
            } else if (state.length === 1) {
                setScreen('connected');
                setConnectedDeviceName(state[0].device.name);
                coordinatorRef.current = state[0].device as DlnaDevice;
            } else {
                if (coordinatorRef.current) {
                    setScreen('connected');
                    setConnectedDeviceName(coordinatorRef.current.name);
                    setGroupMemberList([
                        { device: coordinatorRef.current, isCoordinator: true, volume: 50 },
                    ]);
                }
            }
        };
        return dlnaPlayerListener.rendererDlnaGroupState(handleGroupState);
    }, [t]);
    useEffect(() => {
        if (!dlnaPlayerListener) return;
        const handleDiscoveryUpdate = (_: unknown, updated: DlnaDevice[]) => {
            setDevices((current) => {
                if (screen !== 'idle') return current;
                const hasNewGroups = updated.some((d) => d.groupMembers);
                if (!hasNewGroups) return current;
                return updated;
            });
        };
        return dlnaPlayerListener.rendererDlnaDiscoveryUpdate(handleDiscoveryUpdate);
    }, [screen]);

    const handleDiscover = useCallback(async () => {
        if (!dlnaPlayer) return;
        setDevices([]);
        setIsLoading(true);
        try {
            setDevices(await dlnaPlayer.discover());
        } catch {
            setDevices([]);
        } finally {
            setIsLoading(false);
        }
    }, []);

    const refreshGroupState = useCallback(async () => {
        if (!dlnaPlayer) return;
        try {
            setGroupMemberList(await dlnaPlayer.getGroupState());
        } catch {
            // Catch
        }
    }, []);

    const handleSelect = useCallback(
        async (device: DlnaDevice) => {
            if (!dlnaPlayer) return;
            const currentTimestamp = useTimestampStoreBase.getState().timestamp;
            const localWasPlaying =
                usePlayerStore.getState().player.status === PlayerStatus.PLAYING;
            playerHandoff.pendingDlnaSeek = localWasPlaying ? currentTimestamp : -1;
            playerHandoff.deviceAlreadyPlaying = false;
            playerHandoff.deviceWasPaused = false;
            if (settings.type !== PlayerType.DLNA) {
                previousPlayerTypeRef.current = settings.type;
            }
            setScreen('connecting');
            const result = await dlnaPlayer.connect(device);
            if (result.success) {
                coordinatorRef.current = device;
                setVolume(result.volume);
                if (
                    !localWasPlaying &&
                    result.currentUri &&
                    result.currentTransportState !== 'STOPPED'
                ) {
                    if (result.currentTransportState === 'PAUSED_PLAYBACK') {
                        playerHandoff.deviceAlreadyPlaying = true;
                        playerHandoff.deviceWasPaused = true;
                    } else {
                        playerHandoff.pendingDlnaSeek = -1;
                        playerHandoff.deviceAlreadyPlaying = true;
                        playerHandoff.deviceWasPaused = false;
                    }
                }
                setSettings({
                    playback: {
                        ...settings,
                        previousLocalVolume: volume,
                        previousPlayerType:
                            settings.type !== PlayerType.DLNA ? settings.type : PlayerType.WEB,
                        type: PlayerType.DLNA,
                    },
                });
                if (device.groupMembers && device.groupMembers.length > 1) {
                    const initialMembers: GroupMember[] = device.groupMembers.map((m) => ({
                        device: m as DlnaDevice,
                        isCoordinator: m.id === device.id,
                        volume: m.id === device.id ? result.volume : 50,
                    }));
                    setGroupMemberList(initialMembers);
                    setConnectedDeviceName(
                        t('dlna.castingToGroup', { count: initialMembers.length }),
                    );
                    setScreen('group');
                } else {
                    setConnectedDeviceName(device.name);
                    setGroupMemberList([{ device, isCoordinator: true, volume: result.volume }]);
                    setScreen('connected');
                }
            } else {
                playerHandoff.pendingDlnaSeek = -1;
                setScreen('idle');
            }
        },
        [setSettings, setVolume, settings, volume, t],
    );

    const handleGroupConfirm = useCallback(
        async (selected: DlnaDevice[], coordinator: DlnaDevice) => {
            if (!dlnaPlayer || selected.length < 2) return;
            const currentTimestamp = useTimestampStoreBase.getState().timestamp;
            const localWasPlaying =
                usePlayerStore.getState().player.status === PlayerStatus.PLAYING;
            playerHandoff.pendingDlnaSeek = localWasPlaying ? currentTimestamp : -1;
            playerHandoff.deviceAlreadyPlaying = false;
            playerHandoff.deviceWasPaused = false;
            if (settings.type !== PlayerType.DLNA) {
                previousPlayerTypeRef.current = settings.type;
            }
            setScreen('connecting');
            const result = await dlnaPlayer.connect(coordinator);
            if (!result.success) {
                playerHandoff.pendingDlnaSeek = -1;
                setScreen('group-build');
                return;
            }
            if (
                !localWasPlaying &&
                result.currentUri &&
                result.currentTransportState !== 'STOPPED'
            ) {
                if (result.currentTransportState === 'PAUSED_PLAYBACK') {
                    playerHandoff.deviceAlreadyPlaying = true;
                    playerHandoff.deviceWasPaused = true;
                } else {
                    playerHandoff.pendingDlnaSeek = -1;
                    playerHandoff.deviceAlreadyPlaying = true;
                    playerHandoff.deviceWasPaused = false;
                }
            }
            coordinatorRef.current = coordinator;
            setVolume(result.volume);
            setSettings({
                playback: {
                    ...settings,
                    previousLocalVolume: volume,
                    previousPlayerType:
                        settings.type !== PlayerType.DLNA ? settings.type : PlayerType.WEB,
                    type: PlayerType.DLNA,
                },
            });
            const initialMembers: GroupMember[] = [
                { device: coordinator, isCoordinator: true, volume: result.volume },
            ];
            for (const member of selected.filter((d) => d.id !== coordinator.id)) {
                const r = await dlnaPlayer.addGroupMember(member);
                if (r.success) {
                    initialMembers.push({ device: member, isCoordinator: false, volume: 50 });
                } else {
                    toast.error({
                        message: t('dlna.group.failedToAddMessage', { name: member.name }),
                        title: t('dlna.group.failedToAddTitle'),
                    });
                }
            }
            setGroupMemberList(initialMembers);
            setConnectedDeviceName(t('dlna.castingToGroup', { count: initialMembers.length }));
            setScreen('group');
        },
        [setSettings, setVolume, settings, volume, t],
    );

    const handleExpandGroupConfirm = useCallback(
        async (selected: DlnaDevice[], coordinator: DlnaDevice) => {
            if (!dlnaPlayer) return;
            const toAdd = selected.filter((d) => d.id !== coordinator.id);
            const newMembers = [...groupMemberList];
            for (const member of toAdd) {
                const r = await dlnaPlayer.addGroupMember(member);
                if (r.success) {
                    newMembers.push({ device: member, isCoordinator: false, volume: 50 });
                } else {
                    toast.error({
                        message: t('dlna.group.failedToAddMessage', { name: member.name }),
                        title: t('dlna.group.failedToAddTitle'),
                    });
                }
            }
            setGroupMemberList(newMembers);
            setConnectedDeviceName(t('dlna.castingToGroup', { count: newMembers.length }));
            setScreen('group');
        },
        [groupMemberList, t],
    );

    const handleRemoveMember = useCallback(
        async (deviceId: string) => {
            if (!dlnaPlayer) return;
            await dlnaPlayer.removeGroupMember(deviceId);
            setGroupMemberList((prev) => {
                const next = prev.filter((m) => m.device.id !== deviceId);
                if (next.length === 1) {
                    setConnectedDeviceName(next[0].device.name);
                    setScreen('connected');
                } else {
                    setConnectedDeviceName(t('dlna.castingToGroup', { count: next.length }));
                }
                return next;
            });
        },
        [t],
    );

    const handleDisconnect = useCallback(async () => {
        if (!dlnaPlayer) return;
        const position = await dlnaPlayer.getPosition();
        if (position > 0) playerHandoff.pendingLocalSeek = position;

        if (isShiftDown) {
            await dlnaPlayer.disconnectPassive();
            mediaPause?.();
        } else {
            await dlnaPlayer.disconnect();
        }

        setScreen('idle');
        setConnectedDeviceName('');
        setGroupMemberList([]);
        coordinatorRef.current = null;
        onClose();
        const nextType =
            previousPlayerTypeRef.current === PlayerType.DLNA
                ? PlayerType.WEB
                : previousPlayerTypeRef.current;
        setSettings({ playback: { ...settings, type: nextType } });
        if (settings.previousLocalVolume !== undefined) setVolume(settings.previousLocalVolume);
        setDevices([]);
        void handleDiscover();
    }, [setSettings, setVolume, settings, handleDiscover, mediaPause, isShiftDown, onClose]);

    useEffect(() => {
        if (settings.previousLocalVolume !== undefined) {
            const typeToRestore =
                settings.previousPlayerType === PlayerType.DLNA
                    ? PlayerType.WEB
                    : (settings.previousPlayerType ?? previousPlayerTypeRef.current);
            setSettings({
                playback: {
                    ...settings,
                    previousLocalVolume: undefined,
                    previousPlayerType: undefined,
                    type: typeToRestore,
                },
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /** Run when the panel opens: list devices, or refresh the group being cast to. */
    const onOpen = useCallback(() => {
        if (!isConnected) {
            setScreen('idle');
            void handleDiscover();
        } else {
            void refreshGroupState();
        }
    }, [handleDiscover, isConnected, refreshGroupState]);

    const expandGroupDevices = devices.filter(
        (d) =>
            d.id === coordinatorRef.current?.id ||
            (isSonosDevice(d) &&
                !d.groupMembers &&
                !groupMemberList.some((m) => m.device.id === d.id)),
    );

    return {
        connectedDeviceName,
        coordinatorRef,
        devices,
        expandGroupDevices,
        groupMemberList,
        handleDisconnect,
        handleDiscover,
        handleExpandGroupConfirm,
        handleGroupConfirm,
        handleRemoveMember,
        handleSelect,
        hasSonosDevices,
        isConnected,
        isLoading,
        isShiftDown,
        onOpen,
        screen,
        setScreen,
    };
};
