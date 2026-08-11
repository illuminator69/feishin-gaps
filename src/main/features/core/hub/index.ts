import { randomBytes } from 'crypto';
import { ipcMain } from 'electron';
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
                caps: ['receiver', 'controller'],
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
        getMainWindow()?.webContents.send('hub-message', data.toString());
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
    }
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

export const getHubConfig = (): { enabled: boolean; token: string; url: string } => ({
    enabled: config.enabled,
    token: config.token,
    url: config.url,
});

export const shutdownHub = (): void => stop();
