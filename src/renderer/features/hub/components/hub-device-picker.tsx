import isElectron from 'is-electron';
import { useState } from 'react';

import {
    HubDevice,
    useHubActiveDeviceId,
    useHubDevices,
    useHubMyDeviceId,
    useHubSettings,
    useSettingsStoreActions,
} from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Text } from '/@/shared/components/text/text';

const hub = isElectron() ? window.api.hub : null;

const platformLabel = (platform: string): string => {
    switch (platform) {
        case 'android':
            return 'Android';
        case 'chromecast':
            return 'Cast';
        case 'desktop':
            return 'Desktop';
        default:
            return platform ? platform[0].toUpperCase() + platform.slice(1) : 'Device';
    }
};

/**
 * Spotify-style "Connect to a device" picker. Lists hub devices and transfers
 * playback to the chosen one (the hub resumes it from the same spot). Each row
 * shows the device name + platform + status so two clients are distinguishable.
 * Offline devices auto-hide and manually-hidden ones are tucked behind a toggle.
 * Hidden unless navi-connect is enabled.
 */
export const HubDevicePicker = () => {
    const settings = useHubSettings();
    const devices = useHubDevices();
    const activeId = useHubActiveDeviceId();
    const myId = useHubMyDeviceId();
    const { setSettings } = useSettingsStoreActions();
    const [showExtra, setShowExtra] = useState(false);

    if (!hub || !settings.enabled) return null;

    const hidden = new Set(settings.hiddenDeviceIds ?? []);

    // No `play` flag: the hub preserves the current play/pause state.
    const transfer = (id: string) => {
        hub.send({ action: 'transfer', t: 'act', target: id });
    };

    const setDeviceHidden = (id: string, hide: boolean) => {
        const next = new Set(settings.hiddenDeviceIds ?? []);
        if (hide) next.add(id);
        else next.delete(id);
        setSettings({ hub: { hiddenDeviceIds: Array.from(next) } });
    };

    // Visible by default = online AND not manually hidden. Offline (auto-hidden)
    // and manually-hidden devices live behind the "Show offline & hidden" toggle.
    const visible = devices.filter((d) => d.online && !hidden.has(d.id));
    const extra = devices.filter((d) => !d.online || hidden.has(d.id));
    const hasActive = devices.some((d) => d.id === activeId);

    const renderRow = (device: HubDevice) => {
        const statusText =
            device.id === activeId
                ? 'playing'
                : device.id === myId
                  ? 'this device'
                  : device.online
                    ? 'online'
                    : 'offline';
        const isHidden = hidden.has(device.id);
        return (
            <DropdownMenu.Item
                closeMenuOnClick={false}
                disabled={!device.online || device.id === activeId}
                key={device.id}
                onClick={() => transfer(device.id)}
                rightSection={
                    <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
                        <Text isMuted size="xs">
                            {platformLabel(device.platform)} · {statusText}
                        </Text>
                        <ActionIcon
                            icon={isHidden ? 'visibility' : 'visibilityOff'}
                            iconProps={{ size: 'sm' }}
                            onClick={(e) => {
                                e.stopPropagation();
                                setDeviceHidden(device.id, !isHidden);
                            }}
                            size="xs"
                            tooltip={{ label: isHidden ? 'Unhide' : 'Hide', openDelay: 0 }}
                            variant="subtle"
                        />
                    </div>
                }
            >
                {device.name}
            </DropdownMenu.Item>
        );
    };

    return (
        <DropdownMenu position="top-end">
            <DropdownMenu.Target>
                <ActionIcon
                    icon="radio"
                    iconProps={{ size: 'xl' }}
                    size="sm"
                    tooltip={{ label: hasActive ? 'Connected' : 'Connect to a device', openDelay: 0 }}
                    variant="subtle"
                />
            </DropdownMenu.Target>
            <DropdownMenu.Dropdown>
                <DropdownMenu.Label>Connect to a device</DropdownMenu.Label>
                {visible.length === 0 && (
                    <DropdownMenu.Item disabled>No devices found</DropdownMenu.Item>
                )}
                {visible.map(renderRow)}
                {extra.length > 0 && (
                    <>
                        <DropdownMenu.Divider />
                        <DropdownMenu.Item
                            closeMenuOnClick={false}
                            onClick={() => setShowExtra((v) => !v)}
                        >
                            {showExtra ? 'Hide' : 'Show'} offline & hidden ({extra.length})
                        </DropdownMenu.Item>
                        {showExtra && extra.map(renderRow)}
                    </>
                )}
            </DropdownMenu.Dropdown>
        </DropdownMenu>
    );
};
