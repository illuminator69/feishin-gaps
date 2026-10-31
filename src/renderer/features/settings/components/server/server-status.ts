/**
 * The Server tab's words (F2). Pure and import-free so `server-status.harness.ts` can run it.
 *
 * Everything here is read from state the app already holds: the settings (`hub.*`), the hub store
 * (`connected`, the refusal flag, the attempt time), `welcome.lb` through `useLbBotAvailable`, the
 * CLAP probe the sidebar already runs, and the station mode. Nothing asks the server anything.
 */

export const DEFAULT_HUB_URL = 'ws://localhost:4790';

/** How long after switching on (or changing the address or token) "connecting" is still true. */
export const CONNECT_GRACE_MS = 8000;

export type HubLink =
    | 'connected'
    | 'connecting'
    | 'notConfigured'
    | 'off'
    | 'refused'
    | 'unreachable';

export interface HubLinkInput {
    /** When this client last pushed its hub settings to the transport (start or any change). */
    attemptAt: number;
    /** The server answered the token with an `auth` error; cleared by the next welcome. */
    authRefused: boolean;
    connected: boolean;
    enabled: boolean;
    now: number;
    token: string;
    url: string;
}

/**
 * Whether anything was ever set. The stored address defaults to localhost, which looks like a
 * value but is not one, so a profile with the switch off, no token and the default address is
 * "not configured".
 */
export const isHubConfigured = (s: { enabled: boolean; token: string; url: string }): boolean =>
    s.enabled || s.token.trim() !== '' || (s.url.trim() !== '' && s.url !== DEFAULT_HUB_URL);

export const hubLink = (i: HubLinkInput): HubLink => {
    if (i.enabled && i.connected) return 'connected';
    if (!i.enabled) return isHubConfigured(i) ? 'off' : 'notConfigured';
    // The untouched default shows as an empty field, so with no token it is not an address yet.
    if (i.url.trim() === '' || (i.url === DEFAULT_HUB_URL && i.token.trim() === '')) {
        return 'notConfigured';
    }
    if (i.authRefused) return 'refused';
    return i.now - i.attemptAt < CONNECT_GRACE_MS ? 'connecting' : 'unreachable';
};

export const statusSentence = (link: HubLink, address: string): string => {
    switch (link) {
        case 'connected':
            return `Connected to ${address}`;
        case 'connecting':
            return `Connecting to ${address}...`;
        case 'notConfigured':
            return "Not set up. Enter your Worbus Server's address and access token, with Connect on.";
        case 'off':
            return 'Connect is off.';
        case 'refused':
            return 'The server refused the access token. Check it below.';
        case 'unreachable':
            return `Can't reach ${address}. This app keeps trying in the background.`;
    }
};

export interface CapabilityInput {
    /** The CLAP probe's cached answer; undefined until it has answered. */
    clap: boolean | undefined;
    /** `welcome.lb.available` (or the probe's answer for an older server), not refused. */
    libraryTools: boolean;
    /** The library tools answered 401: they refused this device. */
    libraryToolsRefused: boolean;
    /** Cast speakers the server lists (devices a client is bridging). */
    speakers: number;
    stations: 'fallback' | 'pending' | 'stations';
}

export interface CapabilityLine {
    id: 'audiomuse' | 'casting' | 'library' | 'stations';
    text: string;
}

export const capabilityLines = (i: CapabilityInput): CapabilityLine[] => [
    {
        id: 'library',
        text: i.libraryToolsRefused
            ? 'Library tools: the server refused this device'
            : i.libraryTools
              ? 'Library tools: ready'
              : 'Library tools: not set up on this server',
    },
    {
        id: 'audiomuse',
        text:
            i.clap === undefined
                ? 'AudioMuse: checking'
                : i.clap
                  ? 'AudioMuse: mood search is ready'
                  : 'AudioMuse: mood search is not available',
    },
    {
        id: 'stations',
        text:
            i.stations === 'pending'
                ? 'Stations: checking'
                : i.stations === 'stations'
                  ? 'Stations: ready'
                  : 'Stations: not available on this server. Autoplay runs on this computer instead.',
    },
    {
        id: 'casting',
        text:
            i.speakers > 0
                ? `Casting: ${i.speakers} ${i.speakers === 1 ? 'speaker' : 'speakers'} on your network`
                : 'Casting: no speakers found yet',
    },
];

/** What the Address field shows: the untouched default is an empty field with a placeholder. */
export const addressFieldValue = (url: string, configured: boolean): string =>
    !configured && url === DEFAULT_HUB_URL ? '' : url;

/**
 * What gets stored for a typed address. Empty is the default; `http(s)://` and a bare `host:port`
 * become `ws(s)://`, since the transport speaks WebSocket and a user pastes what they know.
 */
export const normaliseHubAddress = (input: string): string => {
    const value = input.trim();
    if (value === '') return DEFAULT_HUB_URL;
    if (/^wss?:\/\//i.test(value)) return value.replace(/^wss?/i, (s) => s.toLowerCase());
    if (/^https:\/\//i.test(value)) return value.replace(/^https/i, 'wss');
    if (/^http:\/\//i.test(value)) return value.replace(/^http/i, 'ws');
    if (value.includes('://')) return value;
    return `ws://${value}`;
};
