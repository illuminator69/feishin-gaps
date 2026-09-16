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
let backoffMs = INITIAL_BACKOFF_MS;
let shouldRun = false;

/**
 * Which connection attempt is current.
 *
 * Every listener below used to close over the module-level `ws` rather than the socket
 * its own connect() created, so a socket that died slowly could still act on its
 * replacement: socket A's late close ran scheduleReconnect(), which set the global `ws`
 * to undefined and stopped the shared heartbeat — orphaning a perfectly healthy socket
 * B. From then on send() dropped every frame and isHubConnected() said false, with
 * nothing in the log to say why. Changing settings (stop(); start()) is the easy way to
 * hit it, because it guarantees an old socket is closing while a new one opens.
 *
 * So each attempt captures its own socket and generation, and touches shared state only
 * while it is still the current one.
 */
let generation = 0;

const isCurrent = (socket: WebSocket, gen: number): boolean => gen === generation && socket === ws;

function connect(): void {
    if (!shouldRun || !config.url) return;
    const gen = ++generation;
    let socket: WebSocket;
    try {
        socket = new WebSocket(config.url);
    } catch {
        scheduleReconnect(undefined, gen);
        return;
    }
    ws = socket;
    // Per-connection, so a dying socket's heartbeat can never ping or terminate its
    // successor — and so the successor's cannot be cleared out from under it.
    let heartbeat: NodeJS.Timeout | undefined;
    let alive = false;
    const stopBeat = () => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = undefined;
    };

    socket.on('open', () => {
        if (!isCurrent(socket, gen)) {
            // Superseded while connecting. Close quietly: this socket has no business
            // registering a device id its replacement is already claiming, and the hub
            // treats any re-registration as a claim (PROTOCOL §12.2).
            try {
                socket.close();
            } catch {
                /* ignore */
            }
            return;
        }
        // The link is up — reset the backoff so the NEXT drop starts fast again.
        backoffMs = INITIAL_BACKOFF_MS;
        alive = true;
        heartbeat = setInterval(() => {
            // No pong since the last tick → the socket is half-open; kill it so
            // the close handler can reconnect instead of blocking forever.
            if (!alive) {
                try {
                    socket.terminate();
                } catch {
                    /* ignore */
                }
                return;
            }
            alive = false;
            try {
                socket.ping();
            } catch {
                /* ignore */
            }
        }, HEARTBEAT_MS);
        sendOn(socket, {
            device: {
                // `loadAck` (PROTOCOL §7.1): the renderer answers every transfer's
                // do:load with a `loaded` frame, so a transfer here that can't start
                // hands the session back instead of reading as playing everywhere.
                // `transferAckV2` (§7.2): that answer echoes the directive's transferId,
                // so a reply the renderer took 10 s to produce can't satisfy the NEXT
                // transfer to this device.
                caps: ['receiver', 'controller', 'loadAck', 'transferAckV2'],
                id: deviceId(),
                name: config.name || 'Feishin',
                platform: 'desktop',
            },
            t: 'hello',
            token: config.token,
        });
    });
    socket.on('pong', () => {
        alive = true;
    });
    socket.on('message', (data) => {
        if (!isCurrent(socket, gen)) return;
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
    socket.on('close', () => {
        // Always stop this connection's own heartbeat; only the CURRENT connection gets
        // to tell the renderer the transport went down and to schedule a reconnect.
        stopBeat();
        if (!isCurrent(socket, gen)) return;
        emitStatus('disconnected');
        scheduleReconnect(socket, gen);
    });
    socket.on('error', () => {
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

/**
 * Retire a connection and queue the next attempt — but only if it was still the live one.
 *
 * A socket that closes after being replaced has nothing left to clean up. Clearing the
 * globals from there is what used to orphan its successor.
 */
function scheduleReconnect(socket: undefined | WebSocket, gen: number): void {
    if (gen !== generation) return;
    if (socket !== undefined && socket !== ws) return;
    ws = undefined;
    // The registry we snooped belongs to a connection that no longer exists. Cast
    // arbitration reads it to decide whether a speaker is already bridged (§12.2), and an
    // empty list is the "unknown, do not claim yet" state — which is the truth here. Left
    // stale, it would let the bridge claim a speaker on the strength of a device list
    // that could be minutes old.
    knownDevices = [];
    hubEvents.emit('devices', knownDevices);
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
    sendOn(ws, obj);
}

/** Send on a specific socket, regardless of which one is current (used by the handshake). */
function sendOn(socket: undefined | WebSocket, obj: unknown): void {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(obj));
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
    // Bump the generation before closing: the close fires asynchronously, and by then this
    // socket must already be unable to speak for whatever start() has since created.
    generation += 1;
    const closing = ws;
    ws = undefined;
    knownDevices = [];
    try {
        closing?.close();
    } catch {
        /* ignore */
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
