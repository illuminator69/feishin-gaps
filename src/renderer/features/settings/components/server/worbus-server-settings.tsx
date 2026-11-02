import { useQuery } from '@tanstack/react-query';
import { memo, useEffect, useState } from 'react';

import {
    DEFAULT_DEVICE_NAME,
    hostOf,
    resolveDeviceName,
    resolvePublicServerUrl,
} from './hub-fields';
import {
    addressFieldValue,
    capabilityLines,
    CONNECT_GRACE_MS,
    hubLink,
    isHubConfigured,
    normaliseHubAddress,
    serverStatus,
    serverStatusSentence,
    showTokenField,
} from './server-status';

import { clapAvailableKey } from '/@/renderer/features/discover/use-discover-capabilities';
import {
    signInWithCurrentServer,
    signOutOfServer,
} from '/@/renderer/features/hub/utils/hub-signin-actions';
import { useLbBotAvailable } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { useStationMode } from '/@/renderer/features/player/station/station-store';
import { KEYWORDS } from '/@/renderer/features/settings/components/settings-keywords';
import { SettingsSection } from '/@/renderer/features/settings/components/settings-section';
import {
    useAudioMuseSettings,
    useAuthStore,
    useHubSettings,
    useHubStore,
    useSettingsStoreActions,
} from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { PasswordInput } from '/@/shared/components/password-input/password-input';
import { Stack } from '/@/shared/components/stack/stack';
import { Switch } from '/@/shared/components/switch/switch';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { parseSubsonicPair } from '/@/shared/utils/hub-signin';

/** The current music server's account name, or null when there is no pair to sign in with. */
const useSignInUsername = (): null | string =>
    useAuthStore((s) => parseSubsonicPair(s.currentServer?.credential)?.username ?? null);

/** A clock that ticks once when the "connecting" window ends, so the line can change by itself. */
const useNowAfter = (attemptAt: number, running: boolean): number => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        setNow(Date.now());
        if (!running) return undefined;
        const wait = attemptAt + CONNECT_GRACE_MS - Date.now() + 50;
        if (wait <= 0) return undefined;
        const timer = setTimeout(() => setNow(Date.now()), wait);
        return () => clearTimeout(timer);
    }, [attemptAt, running]);
    return now;
};

/**
 * The status line and, once connected, one line for each thing the connection offers. Read from
 * state the app already holds; nothing here asks the server anything.
 */
const ServerStatus = memo(() => {
    const settings = useHubSettings();
    const audioMuse = useAudioMuseSettings();
    const connected = useHubStore((s) => s.connected);
    const authRefused = useHubStore((s) => s.authRefused);
    const attemptAt = useHubStore((s) => s.attemptAt);
    const libraryRefused = useHubStore((s) => s.lbRefused);
    const speakers = useHubStore((s) => s.devices.filter((d) => d.bridgedBy).length);
    const libraryTools = useLbBotAvailable();
    const stations = useStationMode();
    // Reads the probe's cached answer only (enabled: false): no request is made here. Another
    // screen (Library chips, Discover) runs the probe; until it has, `clap.data` is undefined and
    // the AudioMuse line is left out.
    const clap = useQuery<boolean>({
        enabled: false,
        queryFn: () => Promise.resolve(false),
        queryKey: clapAvailableKey(audioMuse),
    });

    const signedIn = useHubStore((s) => s.authSignedIn);
    const signedOut = useHubStore((s) => s.signedOut);
    const signingIn = useHubStore((s) => s.signingIn);
    const signInResult = useHubStore((s) => s.signInResult);
    const user = useHubStore((s) => s.user);
    const username = useSignInUsername();

    const now = useNowAfter(attemptAt, settings.enabled && !connected);
    const link = hubLink({
        attemptAt,
        authRefused,
        connected,
        enabled: settings.enabled,
        now,
        token: settings.token,
        url: settings.url,
    });
    // Worbus P2: what the last sign-in said, and who the connection acts for (design §6.2, §6.5).
    const sign = {
        hasToken: settings.token.trim() !== '',
        result: signInResult,
        signedIn,
        signedOut,
        signingIn,
        user,
        username,
    };
    const status = serverStatus(link, sign);

    const lines =
        link === 'connected'
            ? capabilityLines({
                  clap: clap.data,
                  libraryTools,
                  libraryToolsRefused: libraryRefused,
                  speakers,
                  stations,
              })
            : [];

    return (
        <Stack aria-live="polite" gap="xs">
            <Text size="sm">{serverStatusSentence(status, settings.url, sign)}</Text>
            {lines.map((line) => (
                <Text isMuted key={line.id} size="sm">
                    {line.text}
                </Text>
            ))}
        </Stack>
    );
});

/**
 * Settings, Server: the connection to a Worbus Server. Only writes to the store; use-hub.tsx
 * watches these values and pushes them to the main-process transport.
 */
export const WorbusServerSettings = memo(() => {
    const settings = useHubSettings();
    const { setSettings } = useSettingsStoreActions();

    const signedIn = useHubStore((s) => s.authSignedIn);
    const signingIn = useHubStore((s) => s.signingIn);
    const signInResult = useHubStore((s) => s.signInResult);
    const username = useSignInUsername();
    // The token field exists only after a sign-in found an older server (R6).
    const showToken = showTokenField(signInResult);

    const configured = isHubConfigured(settings);
    const [address, setAddress] = useState(addressFieldValue(settings.url, configured));
    const [name, setName] = useState(settings.name);

    // Reset to default (or anything else that writes these) must show in the fields.
    useEffect(() => {
        setAddress(addressFieldValue(settings.url, configured));
    }, [settings.url, configured]);
    useEffect(() => setName(settings.name), [settings.name]);

    const options = [
        {
            control: (
                <Switch
                    aria-label="Connect to a Worbus Server"
                    checked={settings.enabled}
                    onChange={(e) => setSettings({ hub: { enabled: e.currentTarget.checked } })}
                />
            ),
            description:
                'Control playback on other devices and move the queue between them, ' +
                'continuing from the same spot.',
            keywords: KEYWORDS.serverConnect,
            title: 'Connect to a Worbus Server',
        },
        {
            control: <></>,
            description: <ServerStatus />,
            keywords: KEYWORDS.serverStatus,
            title: 'Status',
        },
        {
            control: (
                <TextInput
                    aria-label="Server address"
                    onBlur={() => {
                        const url = normaliseHubAddress(address);
                        if (url !== settings.url) setSettings({ hub: { url } });
                        setAddress(addressFieldValue(url, isHubConfigured({ ...settings, url })));
                    }}
                    onChange={(e) => setAddress(e.currentTarget.value)}
                    placeholder="ws://192.168.1.10:4790"
                    value={address}
                />
            ),
            description: 'The address of your Worbus Server, for example ws://192.168.1.10:4790.',
            keywords: KEYWORDS.serverAddress,
            title: 'Server address',
        },
        {
            control: (
                <Button
                    aria-label={`Sign in as ${username}`}
                    loading={signingIn}
                    onClick={() => void signInWithCurrentServer()}
                    variant="filled"
                >
                    Sign in
                </Button>
            ),
            description:
                'Uses the account this app is signed in to your music server with. Nothing to type.',
            // Absent once signed in, and with no music server account to sign in with.
            isHidden: signedIn || !username,
            keywords: KEYWORDS.serverSignIn,
            title: `Sign in as ${username}`,
        },
        {
            control: (
                <Button
                    aria-label="Sign out of this server"
                    onClick={() => void signOutOfServer({ reconnect: true })}
                    variant="default"
                >
                    Sign out
                </Button>
            ),
            description:
                'This computer forgets its sign-in to the Worbus Server. Your music server stays signed in.',
            isHidden: !signedIn,
            keywords: KEYWORDS.serverSignOut,
            title: 'Sign out of this server',
        },
        {
            control: (
                <TextInput
                    aria-label="This device's name"
                    onBlur={() => {
                        const result = resolveDeviceName(name, settings.name);
                        setName(result.draft);
                        if (result.changed) setSettings({ hub: { name: result.name } });
                    }}
                    onChange={(e) => setName(e.currentTarget.value)}
                    placeholder={DEFAULT_DEVICE_NAME}
                    value={name}
                />
            ),
            description: 'Shown in the device list on your other devices.',
            keywords: KEYWORDS.serverDeviceName,
            title: "This device's name",
        },
    ];

    const tokenOptions = [
        {
            control: (
                <PasswordInput
                    aria-label="Server token, for older servers"
                    defaultValue={settings.token}
                    onBlur={(e) => {
                        const token = e.currentTarget.value.trim();
                        if (token !== settings.token) setSettings({ hub: { token } });
                    }}
                />
            ),
            description:
                'This Worbus Server is older and has no sign-in. Enter the access token its owner gave you.',
            keywords: KEYWORDS.serverToken,
            title: 'Server token, for older servers',
        },
    ];

    return (
        <>
            <SettingsSection options={options} title="Worbus Server" />
            {showToken && <SettingsSection options={tokenOptions} title="Advanced" />}
        </>
    );
});

/**
 * The one address a cast speaker needs: it fetches the stream itself, from exactly this base,
 * so it must be a music server address the speaker can reach (never the Worbus Server's own).
 */
export const CastingSettings = memo(() => {
    const settings = useHubSettings();
    const { setSettings } = useSettingsStoreActions();
    const [publicUrl, setPublicUrl] = useState(settings.publicServerUrl);
    useEffect(() => setPublicUrl(settings.publicServerUrl), [settings.publicServerUrl]);

    const hubHost = hostOf(settings.url);
    const pointsAtHub =
        Boolean(settings.publicServerUrl) &&
        hubHost !== null &&
        hostOf(settings.publicServerUrl) === hubHost;

    const options = [
        {
            control: (
                <TextInput
                    aria-label="Music server address for speakers"
                    onBlur={() => {
                        const result = resolvePublicServerUrl(
                            publicUrl,
                            settings.publicServerUrl,
                            settings.url,
                        );
                        setPublicUrl(result.draft);
                        if (result.error) {
                            toast.error({
                                message:
                                    result.error === 'hub'
                                        ? "That is the Worbus Server's address, not your music " +
                                          'server. Use the address your music server can be ' +
                                          'reached at from the internet.'
                                        : 'That is not a web address. Use something like ' +
                                          'https://music.example.com.',
                                title: 'Music server address for speakers',
                            });
                            return;
                        }
                        if (result.changed) {
                            setSettings({ hub: { publicServerUrl: result.value } });
                        }
                    }}
                    onChange={(e) => setPublicUrl(e.currentTarget.value)}
                    placeholder="https://music.example.com"
                    value={publicUrl}
                />
            ),
            description: pointsAtHub ? (
                <Text c="red" isNoSelect size="sm">
                    This is the Worbus Server&apos;s address, which cannot serve audio. Casting will
                    fail until it is your music server&apos;s address.
                </Text>
            ) : (
                'Chromecasts on your network are offered to your other devices while connected. ' +
                "Set this if speakers can't play but this computer can."
            ),
            keywords: KEYWORDS.castingAddress,
            title: 'Music server address for speakers',
        },
    ];

    return <SettingsSection options={options} title="Casting" />;
});
