import isElectron from 'is-electron';
import { memo } from 'react';

import { SettingsSection } from '/@/renderer/features/settings/components/settings-section';
import { useHubSettings, useSettingsStoreActions } from '/@/renderer/store';
import { Switch } from '/@/shared/components/switch/switch';
import { Text } from '/@/shared/components/text/text';
import { TextInput } from '/@/shared/components/text-input/text-input';

/**
 * Settings panel for navi-connect (Spotify-Connect-style remote control).
 * Only writes to the store; use-hub.tsx watches these values and pushes them to
 * the main-process transport.
 */
export const HubSettings = memo(() => {
    const settings = useHubSettings();
    const { setSettings } = useSettingsStoreActions();

    const isHidden = !isElectron();

    const controlOptions = [
        {
            control: (
                <Switch
                    defaultChecked={settings.enabled}
                    onChange={(e) => setSettings({ hub: { enabled: e.currentTarget.checked } })}
                />
            ),
            description: (
                <Text isMuted isNoSelect size="sm">
                    Control playback on other devices and transfer the queue between them,
                    continuing from the same spot.
                </Text>
            ),
            isHidden,
            title: 'Enable navi-connect',
        },
        {
            control: (
                <TextInput
                    defaultValue={settings.url}
                    onBlur={(e) => {
                        const url = e.currentTarget.value.trim();
                        if (url !== settings.url) setSettings({ hub: { url } });
                    }}
                />
            ),
            description: 'WebSocket URL of the hub, e.g. ws://192.168.1.10:4790',
            isHidden,
            title: 'Hub URL',
        },
        {
            control: (
                <TextInput
                    defaultValue={settings.token}
                    onBlur={(e) => {
                        const token = e.currentTarget.value;
                        if (token !== settings.token) setSettings({ hub: { token } });
                    }}
                />
            ),
            description: 'Shared secret (HUB_TOKEN) configured on the hub.',
            isHidden,
            title: 'Token',
        },
        {
            control: (
                <TextInput
                    defaultValue={settings.name}
                    onBlur={(e) => {
                        const name = e.currentTarget.value.trim();
                        if (name && name !== settings.name) setSettings({ hub: { name } });
                    }}
                />
            ),
            description: 'Name shown in the device picker on other devices.',
            isHidden,
            title: 'Device name',
        },
        {
            control: (
                <TextInput
                    defaultValue={settings.publicServerUrl}
                    onBlur={(e) => {
                        const publicServerUrl = e.currentTarget.value.trim();
                        if (publicServerUrl !== settings.publicServerUrl) {
                            setSettings({ hub: { publicServerUrl } });
                        }
                    }}
                    placeholder="https://music.example.com"
                />
            ),
            description:
                'Optional. Rewrites stream/cover URLs sent to the hub to this base, so cast ' +
                'devices can reach them when this machine uses a VPN address for the server.',
            isHidden,
            title: 'Public server URL',
        },
    ];

    return <SettingsSection options={controlOptions} title="navi-connect" />;
});
