import type { SignInPair } from '/@/shared/utils/hub-signin';

import { randomBytes } from 'crypto';
import { app, ipcMain, powerMonitor, safeStorage } from 'electron';
import log from 'electron-log/main';
import { EventEmitter } from 'events';
import { WebSocket } from 'ws';

import { store } from '../settings';
import { createHubAuth, httpBaseOf } from './auth';
import { kickAction } from './kick';

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
    /** The typed token, for older servers. Read only through `hubAuth` (bearer / hello). */
    legacyToken: string;
    name: string;
    url: string;
}

// Reconnect uses capped exponential backoff with jitter (protocol §3) — a fixed
// retry made every client hammer a down hub in lockstep.
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
// WS-level heartbeat so a half-open socket (Wi-Fi drop, NAT timeout) is detected
// and force-closed instead of sitting dead with readyState === OPEN.
const HEARTBEAT_MS = 10000;
// How long an opening handshake may go unanswered. `ws` sets no deadline of its own, so an
// attempt made while the network was still coming up (straight after a wake) could sit in
// CONNECTING until the OS gave up on the TCP connect - minutes - with no retry queued behind it.
const HANDSHAKE_TIMEOUT_MS = 10000;
// A kicked OPEN socket has this long to answer a ping before it is dropped (see kick()).
const KICK_PONG_DEADLINE_MS = 3000;
// PROTOCOL §3: bad or missing token - "stop; do not retry until settings change".
const CLOSE_BAD_TOKEN = 4001;
// Worbus P2: the device secret is unknown or revoked (`error {code:"signed_out"}` first). The
// renderer makes one silent sign-in; until a sign-in works the transport stands down.
const CLOSE_SIGNED_OUT = 4005;

const config: HubConfig = { enabled: false, legacyToken: '', name: 'Feishin', url: '' };

/**
 * Whether this machine can encrypt the secret at rest. On Linux with no keyring Electron falls
 * back to `basic_text`, a hard-coded key: that is plain text with extra steps, so it counts as no
 * encryption and the secret stays in memory (R7).
 */
const canEncrypt = (): boolean => {
    try {
        if (!safeStorage.isEncryptionAvailable()) return false;
        return !(
            process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text'
        );
    } catch {
        return false;
    }
};

/**
 * Worbus P2: the one place this device's hub credential is read. Every main client (lb-bot,
 * preview, AudioMuse, moods, stations) and the cast bridge take their bearer or hello from it.
 */
export const hubAuth = createHubAuth({
    device: () => ({
        id: deviceId(),
        kind: 'computer',
        name: config.name || 'Feishin',
        platform: 'desktop',
    }),
    fetch: (url, init) => fetch(url, init),
    httpBase: () => httpBaseOf(config.url),
    legacyToken: () => config.legacyToken,
    log,
    setDeviceId: (id) => store.set('hub.deviceId', id),
    store: {
        delete: (key) => store.delete(key),
        get: (key) => store.get(key),
        set: (key, value) => store.set(key, value),
    },
    vault: {
        available: canEncrypt,
        decrypt: (hex) => safeStorage.decryptString(Buffer.from(hex, 'hex')),
        encrypt: (text) => safeStorage.encryptString(text).toString('hex'),
    },
});

// safeStorage answers only once the app is ready (on Linux it says "unavailable" before).
void app.whenReady().then(() => hubAuth.load());

/** Moves whenever the credential changes, so the cast bridges rebuild with the new one. */
let credentialGeneration = 0;

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
/** Wall-clock ms of the last kick that did something (see kick()). */
let lastKickAt = 0;

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
    // Worbus P2: nothing to connect with (never signed in and no token, signed out by the user,
    // or signed out by the server). A hello without a credential is only refused (4005), and a
    // refusal would read as "signed out" and set off a silent sign-in the user did not ask for:
    // the Server tab says "Not signed in" and its Sign in starts the transport again.
    if (!hubAuth.bearer()) return;
    const gen = ++generation;
    let socket: WebSocket;
    try {
        socket = new WebSocket(config.url, { handshakeTimeout: HANDSHAKE_TIMEOUT_MS });
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
                // `cmdEcho` (§5.2-5.3): the renderer puts `applied` in every report, the
                // `seq` of the last stamped directive it has carried out, and reads the
                // report from the player after that. The hub then drops a report read
                // before a directive took effect instead of timing it out. The cast
                // bridge's own hello does not take this cap.
                // `idleVolume`: the renderer applies `do:setVolume` whenever it arrives,
                // also while another device is playing, so the hub may send this device a
                // level somebody set on its row in a picker (`act:volume` with `target`).
                caps: [
                    'receiver',
                    'controller',
                    'loadAck',
                    'transferAckV2',
                    'cmdEcho',
                    'idleVolume',
                ],
                id: deviceId(),
                // What this device is, for the icon its row gets in every picker. An older
                // hub ignores the key.
                kind: 'computer',
                name: config.name || 'Feishin',
                platform: 'desktop',
            },
            t: 'hello',
            // Worbus P2: the device secret (`auth.deviceSecret`), else the typed token.
            ...hubAuth.helloCredential(),
        });
    });
    socket.on('pong', () => {
        alive = true;
    });
    // The hub sends `error {code:"signed_out"}` and then closes 4005; either one is the signal.
    let signedOutSeen = false;
    socket.on('message', (data) => {
        if (!isCurrent(socket, gen)) return;
        const text = data.toString();
        // Snoop the device registry on the way past. The cast bridge needs it to
        // arbitrate ownership of a speaker BEFORE it registers (PROTOCOL §12.2 steps
        // 1-3), and it can't read it from its own socket — that socket *is* the device
        // being claimed, so by the time it has one the claim has already happened.
        try {
            const msg = JSON.parse(text);
            if (msg?.t === 'error' && msg?.code === 'signed_out') signedOutSeen = true;
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
    socket.on('close', (code) => {
        // Always stop this connection's own heartbeat; only the CURRENT connection gets
        // to tell the renderer the transport went down and to schedule a reconnect.
        stopBeat();
        if (!isCurrent(socket, gen)) return;
        if (code === CLOSE_SIGNED_OUT || signedOutSeen) {
            // The secret is dead. Forget it and stand down (a reconnect would only be refused
            // again); the renderer makes the one silent sign-in, and a sign-in restarts us.
            shouldRun = false;
            hubAuth.signedOutByServer();
            credentialGeneration += 1;
            log.warn('[hub] signed out of the Worbus Server (close 4005) - waiting for a sign-in');
            emitStatus('disconnected');
            emitStatus('signedOut');
            scheduleReconnect(socket, gen);
            hubEvents.emit('settings', settingsEvent());
            return;
        }
        if (code === CLOSE_BAD_TOKEN) {
            // The same token gets the same answer, so retrying is a refusal (and a toast in
            // the renderer, from the hub's `error` frame) every backoff step, forever. Stand
            // down as if switched off: scheduleReconnect below then queues nothing and a kick
            // does nothing. `hub-settings` - any change to the hub settings, the on/off
            // switch included - goes through start() and tries again.
            shouldRun = false;
            log.warn(
                '[hub] the hub refused the token (close 4001) - not reconnecting until the hub settings change',
            );
        }
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
function emitStatus(status: 'disconnected' | 'signedOut'): void {
    getMainWindow()?.webContents.send('hub-message', JSON.stringify({ t: status }));
}

/**
 * Look at the link now, instead of when the backoff or the heartbeat gets round to it.
 *
 * Called when the machine wakes (powerMonitor `resume`) and when the renderer's network comes
 * back (`hub-kick`). After either, the client could otherwise sit disconnected for up to ~39 s:
 * a backoff parked at its 30 s cap plus jitter, or two heartbeat ticks to notice a socket that
 * died with the network adapter. What a kick does is decided in kick.ts:
 *   - waiting out the backoff: connect now, and start the backoff over;
 *   - a handshake in flight: abandon it for a fresh one - it was begun on the old network;
 *   - OPEN: ask (probe), and drop the socket only if it stays silent. A socket that answers is
 *     NEVER recycled: if this client is the active player, closing its socket makes the hub
 *     clear the active device and pause the session (PROTOCOL §7), for nothing;
 *   - switched off, or refused by the hub (4001): nothing.
 *
 * The cast bridge (../cast) keeps its own socket, backoff and single-bridge arbitration, where a
 * reconnect is a claim (PROTOCOL §12.2). It is deliberately not kicked.
 */
function kick(reason: string): void {
    const now = Date.now();
    const action = kickAction({
        readyState: ws?.readyState,
        shouldRun,
        sinceLastKick: now - lastKickAt,
    });
    if (action === 'none') return;
    lastKickAt = now;
    log.info(`[hub] kick (${reason}): ${action}`);
    if (action === 'probe') {
        if (ws) probe(ws);
        return;
    }
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
    }
    backoffMs = INITIAL_BACKOFF_MS;
    // connect() first: it moves `generation` on, so the abandoned attempt's error and close -
    // which terminate() raises on a later tick - are a superseded socket's and touch nothing.
    const abandoned = ws;
    connect();
    try {
        abandoned?.terminate();
    } catch {
        /* ignore */
    }
}

/**
 * Ask an OPEN socket whether it is still there, and end it only if nothing comes back. The
 * close that follows reconnects through the usual path, so the renderer is told `disconnected`
 * and the backoff (reset when this socket opened) starts at its shortest.
 */
function probe(socket: WebSocket): void {
    let answered = false;
    const onPong = () => {
        answered = true;
    };
    socket.once('pong', onPong);
    try {
        socket.ping();
    } catch {
        /* ignore */
    }
    setTimeout(() => {
        socket.off('pong', onPong);
        if (answered || socket.readyState !== WebSocket.OPEN) return;
        log.warn(
            `[hub] no pong within ${KICK_PONG_DEADLINE_MS} ms of a kick - dropping the socket`,
        );
        try {
            socket.terminate();
        } catch {
            /* ignore */
        }
    }, KICK_PONG_DEADLINE_MS);
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
    // The close handler stays silent for a socket of an older generation, so a socket closed
    // here on purpose (navi-connect switched off, or its settings changed) is reported here:
    // without it the renderer went on believing it was connected, with every hub feature,
    // the station chips included, still showing as available (I-041).
    if (closing) emitStatus('disconnected');
}

ipcMain.on('hub-send', (_event, obj: unknown) => send(obj));

// The renderer saw the network come back (its window's `online` event).
ipcMain.on('hub-kick', () => kick('online'));

// The machine woke. Whatever socket there was has most likely died with the network adapter,
// and a reconnect that was already pending may be parked at the top of its backoff. Same hook
// as the mpv reconnect in ../player.
powerMonitor.on('resume', () => kick('resume'));

ipcMain.handle(
    'hub-settings',
    (_event, enabled: boolean, url: string, token: string, name: string) => {
        if (token !== config.legacyToken) credentialGeneration += 1;
        config.enabled = enabled;
        config.url = url;
        config.legacyToken = token;
        config.name = name || 'Feishin';
        // Recreate the connection so url/token/name changes take effect.
        stop();
        if (enabled) start();
        hubEvents.emit('settings', settingsEvent());
        return null;
    },
);

/** The new credential takes effect: a fresh socket, and the cast bridges rebuilt with it. */
function restartWithCredential(reconnect: boolean): void {
    credentialGeneration += 1;
    stop();
    if (reconnect && config.enabled) start();
    hubEvents.emit('settings', settingsEvent());
}

const isPair = (value: unknown): value is SignInPair => {
    const v = value as null | Record<string, unknown>;
    return (
        typeof v === 'object' &&
        v !== null &&
        typeof v.username === 'string' &&
        typeof v.salt === 'string' &&
        typeof v.token === 'string'
    );
};

// Worbus P2: sign in with the current Navidrome server's u/s/t. The answer handed back is the
// result alone; the secret stays in hubAuth.
ipcMain.handle('hub-signin', async (_event, pair: unknown) => {
    if (!isPair(pair)) return { kind: 'noAccount' };
    const result = await hubAuth.signIn({
        salt: pair.salt,
        token: pair.token,
        username: pair.username,
    });
    // Signed in: reconnect with the secret under the id the hub gave. An older server: the
    // secret (if any) was dropped and the typed token is the credential again.
    if (result.kind === 'signedIn' || result.kind === 'oldServer') restartWithCredential(true);
    // Refused, but the transport was left down by a sign-out (a logout, a server switch) and a
    // credential remains - a typed token: connect with it, as before the switch.
    else if (config.enabled && !shouldRun && hubAuth.bearer()) start();
    return result;
});

// Sign out of this server. The socket is closed first, so the 4005 the hub sends it for the
// revoked secret is a superseded socket's and does not trigger a silent sign-in.
ipcMain.handle('hub-signout', async (_event, opts?: { reconnect?: boolean }) => {
    stop();
    await hubAuth.signOut();
    restartWithCredential(opts?.reconnect !== false);
    return null;
});

ipcMain.handle('hub-auth-state', () => hubAuth.state());

function settingsEvent(): { credential: number; enabled: boolean; url: string } {
    return { credential: credentialGeneration, enabled: config.enabled, url: config.url };
}

/** Lets sibling features (the Cast bridge) follow the hub configuration. */
export const hubEvents = new EventEmitter();

/**
 * Last device registry the hub broadcast. Empty until the first `welcome`, which the
 * cast bridge treats as "unknown, don't claim yet" rather than "nobody is bridging".
 */
export const getHubDevices = (): HubDeviceInfo[] => knownDevices;

/** Whether the hub is switched on and where. The credential is `hubAuth`'s, never read here. */
export const getHubConfig = (): { enabled: boolean; url: string } => ({
    enabled: config.enabled,
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
