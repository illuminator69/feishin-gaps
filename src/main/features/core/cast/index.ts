import log from 'electron-log/main';

import { Bonjour } from 'bonjour-service';

interface CastService {
    addresses?: string[];
    name: string;
    txt?: Record<string, string>;
}

interface CastBrowser {
    on(event: 'down' | 'up', listener: (service: CastService) => void): void;
    stop(): void;
}
import { Client, DefaultMediaReceiver } from 'castv2-client';
import { WebSocket } from 'ws';

import { getHubConfig, hubEvents } from '../hub';

/**
 * Chromecast ⇄ navi-connect bridge (the "full virtual receiver" model).
 *
 * Every Chromecast discovered via mDNS is registered with the hub as a
 * first-class receiver device — so it appears in EVERY client's device picker
 * (Feishin and Navic alike), and transfer-with-resume just works. The hub
 * needs no changes: a virtual receiver is simply another connection.
 *
 * Audio: published track metadata carries `streamUrl` (+ `mime`), so the
 * bridge hands the Chromecast direct Navidrome URLs — audio flows
 * server → Chromecast, never through this process.
 */

interface HubTrack {
    album?: string;
    artist?: string;
    durationMs?: number;
    id: string;
    imageUrl?: null | string;
    mime?: string;
    streamUrl?: string;
    title?: string;
}

const noop = () => {};

// Hub reconnect: capped exponential backoff with jitter (protocol §3) so every
// bridge doesn't hammer a down hub in lockstep.
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
// WS heartbeat so a half-open hub socket is detected + force-closed instead of
// leaving the bridge dead-but-registered with readyState === OPEN.
const HEARTBEAT_MS = 10000;

// appId of the Default Media Receiver — used to spot an already-running cast
// session to re-join (vs. launching a fresh one) after a bridge restart.
const DEFAULT_MEDIA_RECEIVER_APP_ID = 'CC1AD845';

class CastDeviceBridge {
    // Whether we've already tried to re-adopt a running cast session for the
    // current hub connection (reset on each fresh `welcome`).
    private adopted = false;

    private castClient: Client | null = null;

    private castPlayer: import('castv2-client').CastPlayer | null = null;

    private destroyed = false;

    private index = 0;

    private lastPositionMs = 0;

    private playing = false;

    private releasing = false;

    private reconnectingCast = false;

    private statusInFlight = false;

    private reconnectTimer: NodeJS.Timeout | null = null;

    private heartbeatTimer: NodeJS.Timeout | null = null;

    private hubAlive = false;

    private backoffMs = INITIAL_BACKOFF_MS;

    private ticker: NodeJS.Timeout | null = null;

    private tracks: HubTrack[] = [];

    private ws: null | WebSocket = null;

    constructor(
        private readonly deviceId: string,
        private readonly friendlyName: string,
        private readonly host: string,
        private readonly hubUrl: string,
        private readonly token: string,
    ) {
        this.connectHub();
    }

    /** The id this bridge registers with the hub (matches activeDeviceId). */
    private get hubDeviceId(): string {
        return `cast-${this.deviceId}`;
    }

    destroy(): void {
        this.destroyed = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.stopHeartbeat();
        this.stopTicker();
        this.teardownCast();
        try {
            this.ws?.close();
        } catch {
            /* ignore */
        }
        this.ws = null;
    }

    // ----------------------------------------------------------------- hub

    private connectHub(): void {
        if (this.destroyed) return;
        try {
            this.ws = new WebSocket(this.hubUrl);
        } catch {
            this.scheduleReconnect();
            return;
        }

        this.ws.on('open', () => {
            log.info(`[cast-bridge] ${this.friendlyName}: registered with hub`);
            this.backoffMs = INITIAL_BACKOFF_MS;
            this.hubAlive = true;
            this.startHeartbeat();
            this.send({
                device: {
                    caps: ['receiver'],
                    id: `cast-${this.deviceId}`,
                    name: `📺 ${this.friendlyName}`,
                    platform: 'chromecast',
                },
                t: 'hello',
                token: this.token,
            });
        });
        this.ws.on('pong', () => {
            this.hubAlive = true;
        });
        this.ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.t === 'do') {
                    void this.handleDo(msg);
                } else if (msg.t === 'welcome') {
                    // Fresh connection: allow one re-adoption attempt, then
                    // evaluate the session the hub just handed us.
                    this.adopted = false;
                    this.maybeAdopt(msg.session);
                } else if (msg.t === 'session') {
                    this.maybeAdopt(msg);
                }
            } catch {
                /* bad frame */
            }
        });
        this.ws.on('close', (code) => {
            log.warn(`[cast-bridge] ${this.friendlyName}: hub connection closed (${code})`);
            this.scheduleReconnect();
        });
        this.ws.on('error', (err) => {
            log.error(`[cast-bridge] ${this.friendlyName}: hub connection error`, err.message);
        });
    }

    private async handleDo(msg: any): Promise<void> {
        try {
            switch (msg.cmd) {
                case 'jump':
                    this.index = msg.index ?? 0;
                    await this.loadCurrent(0, true);
                    break;
                case 'load':
                    this.releasing = false;
                    this.tracks = msg.tracks ?? [];
                    this.index = msg.index ?? 0;
                    await this.loadCurrent(msg.positionMs ?? 0, msg.play !== false);
                    break;
                case 'pause':
                    this.castPlayer?.pause(noop);
                    this.playing = false;
                    this.report();
                    break;
                case 'play':
                    if (this.castPlayer) {
                        this.castPlayer.play(noop);
                        this.playing = true;
                        this.report();
                    } else if (this.tracks.length) {
                        await this.loadCurrent(this.lastPositionMs, true);
                    }
                    break;
                case 'queueChanged': {
                    const currentId = this.tracks[this.index]?.id;
                    this.tracks = msg.tracks ?? [];
                    const newIndex = this.tracks.findIndex((track) => track.id === currentId);
                    this.index = newIndex >= 0 ? newIndex : (msg.index ?? 0);
                    break;
                }
                case 'release':
                    // Freeze all reporting first: the stop() below makes the
                    // device emit IDLE/CANCELLED with currentTime=0, and a
                    // late ticker/status report of 0 racing the hub's device
                    // switch is what reset transfers to the beginning.
                    this.releasing = true;
                    this.stopTicker();
                    await this.capturePosition();
                    this.playing = false;
                    this.report();
                    // The released frame carries the authoritative final
                    // position — the hub applies it atomically.
                    this.send({
                        index: this.index,
                        positionMs: this.lastPositionMs,
                        t: 'released',
                    });
                    // stop() throws synchronously inside castv2 if no media
                    // session is active (e.g. the last load failed → IDLE/ERROR,
                    // so mediaSessionId is undefined). Isolate it so the throw
                    // doesn't skip resetting `releasing` (which would freeze all
                    // future reporting on this bridge).
                    try {
                        this.castPlayer?.stop(noop);
                    } catch (stopError) {
                        log.warn(
                            `[cast-bridge] ${this.friendlyName}: stop on release skipped (no active media session)`,
                            stopError,
                        );
                    }
                    this.releasing = false;
                    break;
                case 'seek':
                    this.castPlayer?.seek((msg.positionMs ?? 0) / 1000, noop);
                    this.lastPositionMs = msg.positionMs ?? 0;
                    break;
                case 'setVolume':
                    this.castClient?.setVolume({ level: (msg.level ?? 100) / 100 }, noop);
                    break;
                default:
                    break;
            }
        } catch (error) {
            log.error(`[cast-bridge] ${this.friendlyName}: ${msg.cmd} failed`, error);
        }
    }

    private report(extra?: Record<string, unknown>): void {
        this.send({
            index: this.index,
            isPlaying: this.playing,
            positionMs: this.lastPositionMs,
            t: 'report',
            ...extra,
        });
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            // No pong since the last tick → half-open socket; kill it so the close
            // handler reconnects instead of the bridge sitting dead-but-registered.
            if (!this.hubAlive) {
                try {
                    this.ws?.terminate();
                } catch {
                    /* ignore */
                }
                return;
            }
            this.hubAlive = false;
            try {
                this.ws?.ping();
            } catch {
                /* ignore */
            }
        }, HEARTBEAT_MS);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private scheduleReconnect(): void {
        this.ws = null;
        this.stopHeartbeat();
        if (this.destroyed || this.reconnectTimer) return;
        const jitter = Math.random() * 0.3 * this.backoffMs;
        const delay = this.backoffMs + jitter;
        this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connectHub();
        }, delay);
    }

    private send(obj: unknown): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
        }
    }

    // ---------------------------------------------------------------- cast

    private capturePosition(): Promise<void> {
        return new Promise((resolve) => {
            if (!this.castPlayer) {
                resolve();
                return;
            }
            try {
                this.castPlayer.getStatus((_err, status) => {
                    // Keep the last good position if the device returns 0/undefined
                    // mid-transition — a 0 here is what reset transfers back to 0.
                    if (typeof status?.currentTime === 'number' && status.currentTime > 0) {
                        this.lastPositionMs = Math.round(status.currentTime * 1000);
                    }
                    resolve();
                });
            } catch {
                // castv2 throws synchronously ("reading 'send'" of null) when the
                // cast socket has died — keep the last known position.
                resolve();
            }
        });
    }

    private ensureCast(): Promise<import('castv2-client').CastPlayer> {
        return new Promise((resolve, reject) => {
            if (this.castPlayer) {
                resolve(this.castPlayer);
                return;
            }
            const client = new Client();
            let settled = false;
            const fail = (err: Error) => {
                this.teardownCast();
                if (!settled) {
                    settled = true;
                    reject(err);
                }
            };
            const timeout = setTimeout(() => fail(new Error('cast connect timeout')), 8000);
            client.on('error', (err) => {
                log.error(`[cast-bridge] ${this.friendlyName}: cast error`, err);
                fail(err);
            });
            log.info(`[cast-bridge] ${this.friendlyName}: connecting to ${this.host}`);
            client.connect(this.host, () => {
                client.launch(DefaultMediaReceiver, (err, player) => {
                    clearTimeout(timeout);
                    if (err || !player) {
                        fail(err ?? new Error('launch failed'));
                        return;
                    }
                    log.info(`[cast-bridge] ${this.friendlyName}: media receiver launched`);
                    this.castClient = client;
                    this.castPlayer = player;
                    // castv2-client leaks request listeners on slow channels.
                    (player as unknown as { media?: { setMaxListeners?: (n: number) => void } })
                        .media?.setMaxListeners?.(50);
                    player.on('status', (status) => this.onCastStatus(status));
                    settled = true;
                    resolve(player);
                });
            });
        });
    }

    /**
     * If the hub says THIS cast device is the active receiver but we hold no
     * cast session (e.g. Feishin was restarted while the Chromecast kept
     * playing on its own), try to re-join the running session instead of
     * leaving the device orphaned. Bootstraps the queue/index from the hub
     * session so auto-advance, release/stop and live reporting all work again.
     */
    private maybeAdopt(session: any): void {
        if (!session || this.adopted || this.castPlayer) return;
        if (session.activeDeviceId !== this.hubDeviceId) return;
        this.adopted = true;
        this.tracks = session.queue ?? [];
        this.index = session.index ?? 0;
        this.lastPositionMs = session.positionMs ?? 0;
        void this.adoptRunningSession();
    }

    private adoptRunningSession(): Promise<void> {
        return new Promise((resolve) => {
            const client = new Client();
            let settled = false;
            const finish = () => {
                if (!settled) {
                    settled = true;
                    resolve();
                }
            };
            const timeout = setTimeout(() => {
                log.warn(`[cast-bridge] ${this.friendlyName}: adoption timed out`);
                try {
                    client.close();
                } catch {
                    /* ignore */
                }
                finish();
            }, 8000);
            client.on('error', (err) => {
                log.warn(`[cast-bridge] ${this.friendlyName}: adoption error`, err.message);
                clearTimeout(timeout);
                try {
                    client.close();
                } catch {
                    /* ignore */
                }
                finish();
            });
            log.info(`[cast-bridge] ${this.friendlyName}: checking for a running session to adopt`);
            client.connect(this.host, () => {
                client.getSessions((err, sessions) => {
                    const running = (sessions ?? []).find(
                        (s) => s.appId === DEFAULT_MEDIA_RECEIVER_APP_ID,
                    );
                    if (err || !running) {
                        clearTimeout(timeout);
                        log.info(`[cast-bridge] ${this.friendlyName}: no running session to adopt`);
                        try {
                            client.close();
                        } catch {
                            /* ignore */
                        }
                        finish();
                        return;
                    }
                    client.join(running, DefaultMediaReceiver, (joinErr, player) => {
                        clearTimeout(timeout);
                        if (joinErr || !player) {
                            log.warn(
                                `[cast-bridge] ${this.friendlyName}: join failed`,
                                joinErr?.message,
                            );
                            try {
                                client.close();
                            } catch {
                                /* ignore */
                            }
                            finish();
                            return;
                        }
                        this.castClient = client;
                        this.castPlayer = player;
                        (
                            player as unknown as {
                                media?: { setMaxListeners?: (n: number) => void };
                            }
                        ).media?.setMaxListeners?.(50);
                        player.on('status', (status) => this.onCastStatus(status));
                        player.getStatus((_e, status) => {
                            if (status) {
                                if (
                                    typeof status.currentTime === 'number' &&
                                    status.currentTime > 0
                                ) {
                                    this.lastPositionMs = Math.round(status.currentTime * 1000);
                                }
                                this.playing = status.playerState === 'PLAYING';
                                // Re-sync the index from whatever is actually loaded.
                                const contentId = status.media?.contentId;
                                if (contentId) {
                                    const idx = this.tracks.findIndex(
                                        (tk) => tk.streamUrl === contentId,
                                    );
                                    if (idx >= 0) this.index = idx;
                                }
                            }
                            log.info(
                                `[cast-bridge] ${this.friendlyName}: adopted running session ` +
                                    `(playing=${this.playing}, index=${this.index}, ` +
                                    `${this.lastPositionMs}ms)`,
                            );
                            // Report so the hub flips the session back to playing
                            // and every client's bar reflects live truth again.
                            this.report();
                            if (this.playing) this.startTicker();
                            finish();
                        });
                    });
                });
            });
        });
    }

    private async loadCurrent(positionMs: number, play: boolean): Promise<void> {
        const track = this.tracks[this.index];
        if (!track) return;
        if (!track.streamUrl) {
            log.error(
                `[cast-bridge] ${this.friendlyName}: track "${track.title}" has no streamUrl — ` +
                    'the queue was published by an older client; start playback again on the ' +
                    'sending device to republish it',
            );
            return;
        }
        log.info(
            `[cast-bridge] ${this.friendlyName}: loading "${track.title}" ` +
                `(${track.mime ?? 'audio/mpeg'}) @ ${positionMs}ms`,
        );
        log.info(`[cast-bridge] contentId: ${track.streamUrl}`);
        const player = await this.ensureCast();
        const media = {
            contentId: track.streamUrl,
            contentType: track.mime || 'audio/mpeg',
            metadata: {
                albumName: track.album ?? '',
                artist: track.artist ?? '',
                images: track.imageUrl ? [{ url: track.imageUrl }] : [],
                metadataType: 3,
                title: track.title ?? '',
                type: 0,
            },
            streamType: 'BUFFERED',
        };
        const loadOnce = (target: import('castv2-client').CastPlayer): Promise<void> =>
            new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(
                    () => reject(new Error('load timed out after 10s')),
                    10_000,
                );
                target.load(
                    media,
                    { autoplay: play, currentTime: positionMs / 1000 },
                    (err, status) => {
                        clearTimeout(timeout);
                        if (err) {
                            reject(err);
                        } else {
                            log.info(
                                `[cast-bridge] ${this.friendlyName}: load ok → ` +
                                    `${status?.playerState ?? 'no status'}`,
                            );
                            resolve();
                        }
                    },
                );
            });

        try {
            await loadOnce(player);
        } catch (error) {
            // The previous media session may be dead (e.g. after release/stop)
            // — retry once with a completely fresh cast session.
            log.warn(
                `[cast-bridge] ${this.friendlyName}: load failed (${(error as Error).message}), ` +
                    'retrying with a fresh session',
            );
            this.teardownCast();
            const freshPlayer = await this.ensureCast();
            await loadOnce(freshPlayer);
        }
        this.lastPositionMs = positionMs;
        this.playing = play;
        this.report();
        this.startTicker();
    }

    private onCastStatus(status: import('castv2-client').CastMediaStatus): void {
        if (this.releasing) return;
        log.info(
            `[cast-bridge] ${this.friendlyName}: status ${status.playerState ?? '?'}` +
                `${status.idleReason ? `/${status.idleReason}` : ''}` +
                ` t=${status.currentTime ?? '?'} dur=${status.media?.duration ?? '?'}`,
        );
        if (status.playerState === 'IDLE' && status.idleReason === 'ERROR') {
            log.error(
                `[cast-bridge] ${this.friendlyName}: playback error (likely unsupported ` +
                    'format or unreachable streamUrl)',
            );
        }
        // Adopt the device's real position, but ignore currentTime=0 — Cast
        // devices transiently report 0 while (re)buffering, and a 0 landing
        // just before a pause is what intermittently reset the progress bar.
        if (typeof status.currentTime === 'number' && status.currentTime > 0) {
            this.lastPositionMs = Math.round(status.currentTime * 1000);
        }
        if (status.playerState === 'PLAYING') {
            this.playing = true;
            this.report();
        } else if (status.playerState === 'PAUSED') {
            this.playing = false;
            this.report();
        } else if (status.playerState === 'IDLE' && status.idleReason === 'FINISHED') {
            // Local auto-advance, like any real receiver.
            if (this.index < this.tracks.length - 1) {
                this.index += 1;
                void this.loadCurrent(0, true);
            } else {
                this.playing = false;
                this.lastPositionMs = 0;
                this.report({ ended: true });
            }
        }
    }

    private startTicker(): void {
        if (this.ticker) return;
        this.ticker = setInterval(() => {
            if (!this.playing || !this.castPlayer || this.statusInFlight) return;
            this.statusInFlight = true;
            try {
                this.castPlayer.getStatus((_err, status) => {
                    this.statusInFlight = false;
                    if (this.releasing) return;
                    // Ignore transient 0 readings during rebuffering (see onCastStatus).
                    if (typeof status?.currentTime === 'number' && status.currentTime > 0) {
                        this.lastPositionMs = Math.round(status.currentTime * 1000);
                        this.report();
                    }
                });
            } catch (error) {
                // castv2 throws SYNCHRONOUSLY ("reading 'send'" of null) when the
                // cast socket has died — previously this surfaced as an uncaught
                // main-process exception and froze live reporting. Drop the dead
                // session and try to re-join the (usually still-playing) cast so
                // the progress bar keeps updating.
                this.statusInFlight = false;
                log.warn(
                    `[cast-bridge] ${this.friendlyName}: status poll failed, dropping dead cast session`,
                    (error as Error).message,
                );
                // teardownCast() clears `playing`, so capture it first to decide
                // whether to try resuming.
                const wasPlaying = this.playing;
                this.teardownCast();
                if (wasPlaying) this.tryReadoptAfterDrop();
            }
        }, 1000);
    }

    // Re-join a Chromecast session that's still playing after our socket dropped,
    // to resume live reporting/control. Guarded so overlapping attempts (and the
    // ticker that adoption restarts) can't spiral; if the cast is truly gone,
    // adoptRunningSession finds no session and quietly does nothing.
    private tryReadoptAfterDrop(): void {
        if (this.reconnectingCast || this.destroyed) return;
        this.reconnectingCast = true;
        void this.adoptRunningSession().finally(() => {
            this.reconnectingCast = false;
        });
    }

    private stopTicker(): void {
        if (this.ticker) clearInterval(this.ticker);
        this.ticker = null;
    }

    private teardownCast(): void {
        this.stopTicker();
        try {
            this.castClient?.close();
        } catch {
            /* ignore */
        }
        this.castClient = null;
        this.castPlayer = null;
        this.playing = false;
    }
}

// ------------------------------------------------------------------ manager

const bridges = new Map<string, CastDeviceBridge>();
let bonjour: InstanceType<typeof Bonjour> | null = null;
let browser: CastBrowser | null = null;
// Last hub config applied to the bridge manager. The renderer re-pushes saved
// hub settings on every (re)connect; without this guard each push tore down and
// recreated mDNS discovery on a REUSED Bonjour socket, which then failed to send
// the initial active query — so discovery fell back to the device's periodic
// passive announcement (~2 min) instead of finding it in ~1s.
let lastBridgeConfig: { enabled: boolean; token: string; url: string } | null = null;

function serviceToDevice(service: CastService): null | { host: string; id: string; name: string } {
    const txt = (service.txt ?? {}) as Record<string, string>;
    const host =
        service.addresses?.find((address) => address.includes('.')) ?? service.addresses?.[0];
    if (!host) return null;
    return {
        host,
        id: txt.id || service.name,
        name: txt.fn || service.name,
    };
}

function startBridging(): void {
    const config = getHubConfig();
    if (!config.enabled || !config.url) {
        log.info('[cast-bridge] not starting (hub disabled or no url)');
        return;
    }
    if (browser) return;

    log.info('[cast-bridge] starting mDNS discovery for cast devices');
    // Always discover on a FRESH Bonjour instance. Reusing one whose browser was
    // previously stopped left the mDNS socket unable to send the initial query,
    // so discovery silently waited for the device's next passive announcement.
    bonjour = new Bonjour();
    browser = bonjour.find({ type: 'googlecast' }) as unknown as CastBrowser;

    browser.on('up', (service) => {
        const device = serviceToDevice(service);
        log.info(
            `[cast-bridge] mDNS up: ${service.name} → ` +
                (device ? `${device.name} @ ${device.host}` : 'unusable (no IPv4 address)'),
        );
        if (!device || bridges.has(device.id)) return;
        bridges.set(
            device.id,
            new CastDeviceBridge(device.id, device.name, device.host, config.url, config.token),
        );
    });
    browser.on('down', (service) => {
        const device = serviceToDevice(service);
        log.info(`[cast-bridge] mDNS down: ${service.name}`);
        if (!device) return;
        bridges.get(device.id)?.destroy();
        bridges.delete(device.id);
    });
}

function stopBridging(): void {
    browser?.stop();
    browser = null;
    bridges.forEach((bridge) => bridge.destroy());
    bridges.clear();
    // Fully release the mDNS socket so the next start gets a clean one.
    bonjour?.destroy();
    bonjour = null;
}

hubEvents.on('settings', (settings: { enabled: boolean; token: string; url: string }) => {
    const changed =
        !lastBridgeConfig ||
        lastBridgeConfig.enabled !== settings.enabled ||
        lastBridgeConfig.url !== settings.url ||
        lastBridgeConfig.token !== settings.token;
    lastBridgeConfig = settings;
    if (!changed) {
        log.info('[cast-bridge] hub settings unchanged — keeping current discovery');
        return;
    }
    log.info(
        `[cast-bridge] hub settings changed (enabled=${settings.enabled}) — restarting discovery`,
    );
    stopBridging();
    if (settings.enabled) startBridging();
});

export const shutdownCastBridge = (): void => {
    stopBridging();
};
