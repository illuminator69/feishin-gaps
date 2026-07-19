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

const RECONNECT_MS = 3000;

const config: HubConfig = { enabled: false, name: 'Feishin', token: '', url: '' };

let ws: undefined | WebSocket;
let reconnectTimer: NodeJS.Timeout | undefined;
let shouldRun = false;

function deviceId(): string {
    let id = store.get('hub.deviceId') as string | undefined;
    if (!id) {
        id = randomBytes(8).toString('hex');
        store.set('hub.deviceId', id);
    }
    return id;
}

function send(obj: unknown): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
    }
}

function scheduleReconnect(): void {
    ws = undefined;
    if (!shouldRun || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connect();
    }, RECONNECT_MS);
}

function connect(): void {
    if (!shouldRun || !config.url) return;
    try {
        ws = new WebSocket(config.url);
    } catch {
        scheduleReconnect();
        return;
    }

    ws.on('open', () => {
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
    ws.on('message', (data) => {
        getMainWindow()?.webContents.send('hub-message', data.toString());
    });
    ws.on('close', () => scheduleReconnect());
    ws.on('error', () => {
        // 'close' fires after 'error'; reconnect is handled there.
    });
}

function start(): void {
    shouldRun = true;
    if (!ws) connect();
}

function stop(): void {
    shouldRun = false;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
    }
    try {
        ws?.close();
    } catch {
        /* ignore */
    }
    ws = undefined;
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
