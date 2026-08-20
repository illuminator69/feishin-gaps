import { randomBytes } from 'crypto';
import { ipcMain } from 'electron';
import log from 'electron-log/main';
import { EventEmitter } from 'events';
import { WebSocket } from 'ws';

import { store } from '../settings';

import { getMainWindow } from '/@/main/index';

/**
 * navi-connect hub client (transport only).
 *
 * This process is a dumb pipe: it owns the outbound WebSocket to the hub, the
 * auth handshake, reconnect, and a persisted device id. All protocol semantics
 * (handling `do`, building `report`, resolving songs) live in the renderer,
 * which owns the player — see src/renderer/features/hub/hooks/use-hub.tsx.
 *
 *   renderer --(ipc 'hub-send')-->  hub-client  --(ws)-->  hub
 *   renderer <--(ipc 'hub-message')-- hub-client <--(ws)-- hub
 */
interface HubConfig {
    enabled: boolean;
    name: string;
    token: string;
    url: string;
}

// Reconnect uses capped exponential backoff with jitter (protocol §3) — a fixed
// retry made every client hammer a down hub in lockstep.
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
// WS-level heartbeat so a half-open socket (Wi-Fi drop, NAT timeout) is detected
// and force-closed instead of sitting dead with readyState === OPEN.
const HEARTBEAT_MS = 10000;

const config: HubConfig = { enabled: false, name: 'Feishin', token: '', url: '' };

let ws: undefined | WebSocket;

/** Shape of a hub `DeviceInfo` row (PROTOCOL §3.2) — only the fields we arbitrate on. */
export interface HubDeviceInfo {
    bridgedBy?: null | string;
    id: string;
    online: boolean;
    reachable?: boolean | null;
}

let knownDevices: HubDeviceInfo[] = [];
let reconnectTimer: NodeJS.Timeout | undefined;
let heartbeatTimer: NodeJS.Timeout | undefined;
let backoffMs = INITIAL_BACKOFF_MS;
let isAlive = false;
let shouldRun = false;

function connect(): void {
    if (!shouldRun || !config.url) return;
    try {
        ws = new WebSocket(config.url);
    } catch {
        scheduleReconnect();
        return;
    }

    ws.on('open', () => {
        // The link is up — reset the backoff so the NEXT drop starts fast again.
        backoffMs = INITIAL_BACKOFF_MS;
        isAlive = true;
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
            // No pong since the last tick → the socket is half-open; kill it so
            // the close handler can reconnect instead of blocking forever.
            if (!isAlive) {
                try {
                    ws?.terminate();
                } catch {
                    /* ignore */
                }
                return;
            }
            isAlive = false;
            try {
                ws?.ping();
            } catch {
                /* ignore */
            }
        }, HEARTBEAT_MS);
        send({
            device: {
                // `loadAck` (PROTOCOL §7.1): the renderer answers every transfer's
                // do:load with a `loaded` frame, so a transfer here that can't start
                // hands the session back instead of reading as playing everywhere.
                caps: ['receiver', 'controller', 'loadAck'],
                id: deviceId(),
                name: config.name || 'Feishin',
                platform: 'desktop',
            },
            t: 'hello',
            token: config.token,
        });
    });
    ws.on('pong', () => {
        isAlive = true;
    });
    ws.on('message', (data) => {
        const text = data.toString();
        // Snoop the device registry on the way past. The cast bridge needs it to
        // arbitrate ownership of a speaker BEFORE it registers (PROTOCOL §12.2 steps
        // 1-3), and it can't read it from its own socket — that socket *is* the device
        // being claimed, so by the time it has one the claim has already happened.
        try {
            const msg = JSON.parse(text);
            if (msg?.t === 'welcome' || msg?.t === 'devices') {
                if (Array.isArray(msg.devices)) {
                    knownDevices = msg.devices;
                    hubEvents.emit('devices', knownDevices);
                }
            }
        } catch {
            /* not our problem — the renderer owns protocol semantics */
        }
        getMainWindow()?.webContents.send('hub-message', text);
    });
    ws.on('close', () => {
        emitStatus('disconnected');
        scheduleReconnect();
    });
    ws.on('error', () => {
        // 'close' fires after 'error'; reconnect is handled there.
    });
}

function deviceId(): string {
    let id = store.get('hub.deviceId') as string | undefined;
    if (!id) {
        id = randomBytes(8).toString('hex');
        store.set('hub.deviceId', id);
    }
    return id;
}

/**
 * Tell the renderer the transport state changed. The renderer only ever heard
 * hub frames, so a dropped socket left it stuck `connected: true` — routing
 * `act`s into a dead socket and freezing the player bar on stale remote state.
 * Synthetic frames ride the same `hub-message` channel so use-hub can react.
 */
function emitStatus(status: 'disconnected'): void {
    getMainWindow()?.webContents.send('hub-message', JSON.stringify({ t: status }));
}

function scheduleReconnect(): void {
    ws = undefined;
    stopHeartbeat();
    if (!shouldRun || reconnectTimer) return;
    const jitter = Math.random() * 0.3 * backoffMs;
    const delay = backoffMs + jitter;
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
    }, delay);
}

function send(obj: unknown): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
        return;
    }
    // Silently doing nothing on a closed socket is how an `act` the user definitely performed
    // vanished with no trace anywhere — the renderer's remoteAct still reported success. Log it,
    // so "the button did nothing" has something to find. Reports are excluded: they fire at 1 Hz
    // and a disconnect would drown the log in them.
    const t = (obj as { t?: string })?.t;
    if (t && t !== 'report') log.warn(`[hub] dropped "${t}" — socket not open`);
}

function start(): void {
    shouldRun = true;
    backoffMs = INITIAL_BACKOFF_MS;
    if (!ws) connect();
}

function stop(): void {
    shouldRun = false;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
    }
    stopHeartbeat();
    try {
        ws?.close();
    } catch {
        /* ignore */
    }
    ws = undefined;
}

function stopHeartbeat(): void {
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
    }
}

ipcMain.on('hub-send', (_event, obj: unknown) => send(obj));

ipcMain.handle(
    'hub-settings',
    (_event, enabled: boolean, url: string, token: string, name: string) => {
        config.enabled = enabled;
        config.url = url;
        config.token = token;
        config.name = name || 'Feishin';
        // Recreate the connection so url/token/name changes take effect.
        stop();
        if (enabled) start();
        hubEvents.emit('settings', { enabled, token, url });
        return null;
    },
);

/** Lets sibling features (the Cast bridge) follow the hub configuration. */
export const hubEvents = new EventEmitter();

/**
 * Last device registry the hub broadcast. Empty until the first `welcome`, which the
 * cast bridge treats as "unknown, don't claim yet" rather than "nobody is bridging".
 */
export const getHubDevices = (): HubDeviceInfo[] => knownDevices;

export const getHubConfig = (): { enabled: boolean; token: string; url: string } => ({
    enabled: config.enabled,
    token: config.token,
    url: config.url,
});

export const shutdownHub = (): void => stop();

/** Whether this client's own hub connection is currently up. */
export const isHubConnected = (): boolean => ws?.readyState === WebSocket.OPEN;

/**
 * This client's own hub device id. The cast bridge stamps it as `bridgedBy` on every
 * speaker it registers, so the hub (and every picker) can say which client is holding
 * a given virtual receiver — PROTOCOL §3.2.
 */
export const getHubDeviceId = (): string => deviceId();
