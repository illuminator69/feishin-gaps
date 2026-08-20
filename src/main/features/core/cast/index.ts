import { Bonjour } from 'bonjour-service';
import log from 'electron-log/main';

interface CastBrowser {
    on(event: 'down' | 'up', listener: (service: CastService) => void): void;
    stop(): void;
    /** Re-send the mDNS PTR query. See REQUERY_* below. */
    update(): void;
}

interface CastService {
    addresses?: string[];
    name: string;
    txt?: Record<string, string>;
}
import { Client, DefaultMediaReceiver } from 'castv2-client';
import { ipcMain } from 'electron';
import net from 'net';
import { WebSocket } from 'ws';

import { getHubConfig, getHubDeviceId, getHubDevices, hubEvents, isHubConnected } from '../hub';

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
// Hub close code for "another socket registered this same device id" (protocol
// §3). Two clients that both see a speaker register the same `cast-<id>`, so
// each supersedes the other; reconnecting on the normal backoff makes that an
// endless register/evict war, and because `open` resets the backoff it never
// even slows down. PROTOCOL §12.2's circuit breaker: the superseded bridge stays
// down long enough for the winner to keep the speaker. Navic already does this.
const SUPERSEDED_CODE = 4003;
const STAND_DOWN_MS = 5 * 60 * 1000;
// PROTOCOL §12.2 step 3: two clients starting at the same moment both see an empty
// registry and both claim. A random pause before claiming, then a re-check, settles
// that without exchanging a single frame.
const CLAIM_JITTER_MS = 3000;
// An empty registry is ambiguous: nobody is bridging this speaker, OR the main hub
// client hasn't delivered `welcome` yet. Claiming during that window is how the desktop
// would steal a speaker Navic was already serving on every single launch. Wait for the
// registry, but not forever — a hub that never connects must not disable casting.
const REGISTRY_WAIT_MS = 10_000;
// How long a hub connection must survive before it counts as "working" and the
// reconnect backoff resets. Resetting it in `open` meant a socket that was accepted
// and immediately evicted looked like a success every time, so the exponential backoff
// could never engage and two bridges fought at full speed indefinitely.
const BACKOFF_RESET_AFTER_MS = 60_000;

// appId of the Default Media Receiver — used to spot an already-running cast
// session to re-join (vs. launching a fresh one) after a bridge restart.
const DEFAULT_MEDIA_RECEIVER_APP_ID = 'CC1AD845';

// Reachability (PROTOCOL §3.2 / §12.2). `online` on a cast row means THIS process holds
// the hub socket — it says nothing about the speaker, which may be off, asleep, or on a
// network nobody here is on. The bridge is the only party that can tell the difference,
// so it probes and reports. The probe is a bare TCP connect: asking the receiver app
// would mean LAUNCHing it, and launching seizes the speaker's audio output.
const CAST_PORT = 8009;
const PROBE_TIMEOUT_MS = 2000;
const REACHABILITY_INTERVAL_MS = 30_000;
// Consecutive failed probes before we call a speaker down. One miss is a dropped packet;
// two spread over a minute is a speaker that has genuinely gone away. A phantom receiver
// for a minute is much cheaper than dropping a live one.
const REACHABILITY_FAILS_BEFORE_DOWN = 2;
// A Chromecast that is unplugged emits no mDNS goodbye, so `down` never fires and the
// bridge would advertise a dead speaker forever. Sweep instead: gone from mDNS this long
// AND failing the probe means tear the bridge down.
const MISSING_GRACE_MS = 90_000;
const BRIDGE_SWEEP_MS = 30_000;

class CastDeviceBridge {
    /** Last time mDNS said this speaker exists. Drives the missing-device sweep. */
    lastSeenAt = Date.now();

    /** The id this bridge registers with the hub (matches activeDeviceId). */
    get hubDeviceId(): string {
        return `cast-${this.deviceId}`;
    }

    /** Whether this bridge currently holds its hub socket — i.e. whether this
     *  process, rather than some other client, is the one driving the speaker. */
    get isRegistered(): boolean {
        return !this.destroyed && this.ws?.readyState === WebSocket.OPEN;
    }

    /** True while the speaker is believed present — used by the missing-device sweep. */
    get looksReachable(): boolean {
        return this.reachable !== false;
    }

    // Whether we've already tried to re-adopt a running cast session for the
    // current hub connection (reset on each fresh `welcome`).
    private adopted = false;

    private backoffMs = INITIAL_BACKOFF_MS;

    private backoffResetTimer: NodeJS.Timeout | null = null;

    private castClient: Client | null = null;

    private castPlayer: import('castv2-client').CastPlayer | null = null;

    private claimTimer: NodeJS.Timeout | null = null;

    private readonly createdAt = Date.now();

    private destroyed = false;

    private heartbeatTimer: NodeJS.Timeout | null = null;

    private hubAlive = false;

    private index = 0;

    private lastPositionMs = 0;

    private playing = false;

    private probeFailures = 0;

    private reachabilityTimer: NodeJS.Timeout | null = null;

    /** Our last asserted verdict on the speaker; null until the first probe lands. */
    private reachable: boolean | null = null;

    private reconnectingCast = false;

    private reconnectTimer: NodeJS.Timeout | null = null;

    private releasing = false;

    // Saved-queue identity of the session we adopted, so re-claiming it refreshes that
    // history record instead of forking a near-duplicate of music that never stopped.
    private sessionMeta: {
        savedQueueId?: string;
        sourceKind?: string;
        sourceName?: string;
    } = {};

    /** Set until the §12.2 stand-down expires; blocks re-claiming before then. */
    private standDownUntil = 0;

    /** True while another client holds this speaker and we are deliberately idle. */
    private standingDown = false;

    private statusInFlight = false;

    // True while teardownCast() is closing our own socket — see onCastSocketClosed.
    private tearingDown = false;

    private ticker: NodeJS.Timeout | null = null;

    private tracks: HubTrack[] = [];

    private ws: null | WebSocket = null;

    constructor(
        private readonly deviceId: string,
        private readonly friendlyName: string,
        private host: string,
        private readonly hubUrl: string,
        private readonly token: string,
    ) {
        this.scheduleClaim();
    }

    destroy(): void {
        this.destroyed = true;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.claimTimer) clearTimeout(this.claimTimer);
        if (this.backoffResetTimer) clearTimeout(this.backoffResetTimer);
        this.stopReachability();
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

    /**
     * The hub's device list changed — PROTOCOL §12.2 step 2. A bridging client quitting
     * is what frees the speaker, and nothing else would ever tell us.
     */
    reevaluate(): void {
        if (this.destroyed || this.ws || !this.standingDown) return;
        if (this.claimedElsewhere()) return;
        log.info(`[cast-bridge] ${this.friendlyName}: speaker was released — claiming it`);
        this.standingDown = false;
        this.scheduleClaim();
    }

    /**
     * mDNS re-announced this device at a different address. Discovery only ever told us
     * once, so without this the bridge kept dialling wherever the speaker used to live and
     * every connect timed out — permanently, since re-discovery is skipped for a device we
     * already have a bridge for.
     */
    updateHost(host: string): void {
        if (!host || host === this.host) return;
        log.info(`[cast-bridge] ${this.friendlyName}: address changed ${this.host} → ${host}`);
        this.host = host;
        const wasPlaying = this.playing;
        this.teardownCast();
        // Whatever we held pointed at the old address; pick playback back up at the new one.
        if (wasPlaying && this.tracks.length) void this.loadCurrent(this.lastPositionMs, true);
    }

    private adoptRunningSession(claim = false): Promise<void> {
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
                        player.getStatus((_e, status) => {
                            const contentId = status?.media?.contentId;
                            // Adopting a session means telling every client this speaker IS
                            // our session, so require proof: it must be playing a track from
                            // that very queue. Someone else's cast, or a receiver session
                            // left over from yesterday, matches nothing and is left alone.
                            // This check used to be skipped entirely when `claim` was false
                            // (the re-adopt-after-drop path), so a bridge would happily join
                            // an unrelated Default Media Receiver session and then drive it.
                            // Matching is on the Subsonic track id, not the whole URL — see
                            // streamIdentity().
                            const playingId = streamIdentity(contentId);
                            const matches =
                                !!playingId &&
                                this.tracks.some(
                                    (tk) => streamIdentity(tk.streamUrl) === playingId,
                                );
                            if (!matches) {
                                log.info(
                                    `[cast-bridge] ${this.friendlyName}: running session is not ` +
                                        'ours — leaving it alone',
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
                            player.on('status', (s) => this.onCastStatus(s));
                            client.on('close', () => this.onCastSocketClosed());
                            if (status) {
                                if (
                                    typeof status.currentTime === 'number' &&
                                    status.currentTime > 0
                                ) {
                                    this.lastPositionMs = Math.round(status.currentTime * 1000);
                                }
                                this.playing = status.playerState === 'PLAYING';
                                // Re-sync the index from whatever is actually loaded.
                                if (playingId) {
                                    const idx = this.tracks.findIndex(
                                        (tk) => streamIdentity(tk.streamUrl) === playingId,
                                    );
                                    if (idx >= 0) this.index = idx;
                                }
                            }
                            log.info(
                                `[cast-bridge] ${this.friendlyName}: adopted running session ` +
                                    `(playing=${this.playing}, index=${this.index}, ` +
                                    `${this.lastPositionMs}ms)`,
                            );
                            // Take the active slot back first when it's empty — until the hub
                            // considers us active, a report is discarded and the session stays
                            // "stopped" no matter how loudly the speaker is playing.
                            if (claim) this.claimActive();
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

    /**
     * Is the cast connection we hold still a connection? Weaker than castSessionAlive:
     * it asks whether the device answers at all, not whether media is loaded — a freshly
     * launched receiver with nothing playing is alive and must not be torn down.
     */
    private castLinkAlive(): Promise<boolean> {
        return new Promise((resolve) => {
            const player = this.castPlayer;
            if (!player) {
                resolve(false);
                return;
            }
            let settled = false;
            const done = (alive: boolean) => {
                if (!settled) {
                    settled = true;
                    resolve(alive);
                }
            };
            // A torn-down receiver doesn't refuse — it never answers. The timeout IS
            // the answer.
            const timer = setTimeout(() => done(false), 3000);
            try {
                player.getStatus((err) => {
                    clearTimeout(timer);
                    done(!err);
                });
            } catch {
                clearTimeout(timer);
                done(false);
            }
        });
    }

    /**
     * Is the media session we hold still real? `castPlayer` is just an object — it stays
     * valid-looking long after the device has closed the receiver app, so anything that
     * resumes playback has to ask rather than assume. A false negative is harmless: the
     * caller reloads from `lastPositionMs`, which is the right recovery either way.
     */
    private castSessionAlive(): Promise<boolean> {
        return new Promise((resolve) => {
            const player = this.castPlayer;
            if (!player) {
                resolve(false);
                return;
            }
            let settled = false;
            const done = (alive: boolean) => {
                if (!settled) {
                    settled = true;
                    resolve(alive);
                }
            };
            // A dead session usually answers nothing at all, so the timeout IS the answer.
            const timer = setTimeout(() => done(false), 3000);
            try {
                player.getStatus((err, status) => {
                    clearTimeout(timer);
                    done(!err && !!status?.media && status.playerState !== 'IDLE');
                });
            } catch {
                // castv2 throws synchronously on a dead socket.
                clearTimeout(timer);
                done(false);
            }
        });
    }

    /**
     * Re-take the active slot after adopting an orphaned session. A `report` from a device
     * the hub doesn't consider active is dropped on the floor, so the bridge has to speak
     * the one frame that promotes an idle slot: `setQueue`. It republishes the session's
     * own queue and saved-queue id (so no history record forks) at the position the speaker
     * is actually at.
     */
    private claimActive(): void {
        this.send({
            action: 'setQueue',
            index: this.index,
            play: this.playing,
            positionMs: this.lastPositionMs,
            savedQueueId: this.sessionMeta.savedQueueId,
            sourceKind: this.sessionMeta.sourceKind,
            sourceName: this.sessionMeta.sourceName,
            t: 'act',
            tracks: this.tracks,
        });
        log.info(
            `[cast-bridge] ${this.friendlyName}: claimed the idle active slot ` +
                `(index=${this.index}, ${this.lastPositionMs}ms)`,
        );
    }

    /**
     * Is another client already bridging this speaker? PROTOCOL §12.2 step 1.
     *
     * Read off the MAIN hub client's registry, not this bridge's own socket: the bridge
     * socket *is* the device being claimed, so by the time it could read `devices` the
     * claim has already happened and the hub has already evicted somebody. That
     * chicken-and-egg is why the desktop bridge used to register unconditionally while
     * Navic implemented the full rule — the two then took turns every second.
     */
    private claimedElsewhere(): boolean {
        const row = getHubDevices().find((d) => d.id === this.hubDeviceId);
        if (!row || !row.online) return false;
        // Our own previous socket doesn't count as a competitor.
        return row.bridgedBy !== getHubDeviceId();
    }

    /**
     * Run a castv2 command and report whether it actually reached the device.
     *
     * Every one of these used to be fire-and-forget (`castPlayer?.pause(noop)`), with the
     * bridge then reporting the new state as fact. Three ways that lies: the optional
     * chain swallows a null player entirely, castv2 throws *synchronously* on a dead
     * socket, and a live socket to a gone receiver simply never calls back. All three
     * produce "the hub thinks it happened" — the exact shape of the bug where the player
     * reads paused/seeked and the speaker is doing something else.
     */
    private commandLanded(invoke: (cb: (err?: Error | null) => void) => unknown): Promise<boolean> {
        return new Promise((resolve) => {
            let settled = false;
            const done = (ok: boolean) => {
                if (!settled) {
                    settled = true;
                    resolve(ok);
                }
            };
            const timer = setTimeout(() => done(false), 3000);
            try {
                const issued = invoke((err) => {
                    clearTimeout(timer);
                    done(!err);
                });
                // An optional-chained call on a null player returns undefined without
                // ever invoking the callback — that is a miss, not a pending command.
                if (issued === undefined && !this.castPlayer && !this.castClient) {
                    clearTimeout(timer);
                    done(false);
                }
            } catch {
                clearTimeout(timer);
                done(false);
            }
        });
    }

    private connectCast(): Promise<import('castv2-client').CastPlayer> {
        return new Promise((resolve, reject) => {
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
                // A connect that times out or is refused usually means the address we
                // cached at discovery is no longer where this device lives (DHCP moved it
                // while we held the old one — mDNS only ever told us once). Re-query so
                // the manager can hand us the new address; retrying this one can't work.
                requeryCastDevices();
                fail(err);
            });
            client.on('close', () => this.onCastSocketClosed());
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
                    (
                        player as unknown as { media?: { setMaxListeners?: (n: number) => void } }
                    ).media?.setMaxListeners?.(50);
                    player.on('status', (status) => this.onCastStatus(status));
                    settled = true;
                    resolve(player);
                });
            });
        });
    }

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
            // Reset the backoff only once the connection has PROVEN itself. Doing it here
            // unconditionally made an accept-then-evict cycle read as a success, so the
            // exponential backoff never engaged.
            if (this.backoffResetTimer) clearTimeout(this.backoffResetTimer);
            this.backoffResetTimer = setTimeout(() => {
                this.backoffResetTimer = null;
                this.backoffMs = INITIAL_BACKOFF_MS;
            }, BACKOFF_RESET_AFTER_MS);
            this.hubAlive = true;
            this.startHeartbeat();
            this.send({
                device: {
                    // `loadAck` opts this receiver into the transfer acknowledgement
                    // (§7.1): a cast load that fails is otherwise invisible for ~20 s,
                    // during which every client shows a playing bar over silence.
                    bridgedBy: getHubDeviceId(),
                    caps: ['receiver', 'loadAck'],
                    id: `cast-${this.deviceId}`,
                    name: `📺 ${this.friendlyName}`,
                    platform: 'chromecast',
                },
                t: 'hello',
                token: this.token,
            });
            this.startReachability();
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
            this.stopReachability();
            if (code === SUPERSEDED_CODE) {
                // Another client bridges this speaker. Stand down rather than
                // claim it back — whoever is holding it now is serving the user
                // just as well, and taking turns every second serves nobody.
                log.warn(
                    `[cast-bridge] ${this.friendlyName}: superseded by another bridge — ` +
                        `standing down for ${STAND_DOWN_MS / 60000} min`,
                );
                this.standingDown = true;
                this.standDownUntil = Date.now() + STAND_DOWN_MS;
                this.scheduleReconnect(STAND_DOWN_MS);
                return;
            }
            log.warn(`[cast-bridge] ${this.friendlyName}: hub connection closed (${code})`);
            this.scheduleReconnect();
        });
        this.ws.on('error', (err) => {
            log.error(`[cast-bridge] ${this.friendlyName}: hub connection error`, err.message);
        });
    }

    private async ensureCast(): Promise<import('castv2-client').CastPlayer> {
        // `castPlayer` is a plain object and stays valid-looking indefinitely — a
        // Chromecast closes its receiver app after a few idle minutes and nothing here
        // is told. Reusing it unasked is what made "cast to the TV" assume a session
        // that had been dead for days: the load went into the void, and the ~20 s of
        // stacked timeouts before it gave up were 20 s of every client showing a
        // playing bar over a silent TV.
        if (this.castPlayer) {
            if (await this.castLinkAlive()) return this.castPlayer;
            log.info(
                `[cast-bridge] ${this.friendlyName}: cached cast session is dead — relaunching`,
            );
            this.teardownCast();
        }
        return this.connectCast();
    }

    private async handleDo(msg: any): Promise<void> {
        try {
            switch (msg.cmd) {
                case 'jump':
                    this.index = msg.index ?? 0;
                    await this.loadCurrent(0, true);
                    break;
                case 'load': {
                    this.releasing = false;
                    this.tracks = msg.tracks ?? [];
                    this.index = msg.index ?? 0;
                    const ok = await this.loadCurrent(msg.positionMs ?? 0, msg.play !== false);
                    // PROTOCOL §7.1. Without this the hub commits the active slot and
                    // never learns the speaker didn't start, so a transfer to a TV that
                    // has been off for days reads as playing on every device until a
                    // human intervenes.
                    this.send({
                        error: ok ? undefined : 'the speaker did not start playback',
                        ok,
                        t: 'loaded',
                    });
                    break;
                }
                case 'pause':
                    // Only claim paused if the pause actually reached the device. Reporting
                    // it regardless told the hub — and every client — that a command had
                    // landed which may never have left this process.
                    if (await this.commandLanded((cb) => this.castPlayer?.pause(cb))) {
                        this.playing = false;
                        this.report();
                    } else {
                        log.warn(
                            `[cast-bridge] ${this.friendlyName}: pause did not reach the device`,
                        );
                        this.teardownCast();
                        this.playing = false;
                        this.report();
                    }
                    break;
                case 'play':
                    // A Chromecast tears its receiver app down after a few idle minutes,
                    // and our player object happily survives that: play() went into the
                    // void while we reported playback that made no sound, with no way back
                    // short of switching devices. Prove the session is still there first,
                    // and rebuild it from the last known position when it isn't.
                    if (this.castPlayer && (await this.castSessionAlive())) {
                        this.castPlayer.play(noop);
                        this.playing = true;
                        this.report();
                    } else if (this.tracks.length) {
                        if (this.castPlayer) {
                            log.info(
                                `[cast-bridge] ${this.friendlyName}: cast session went away while ` +
                                    'paused — reloading from the last position',
                            );
                            this.teardownCast();
                        }
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
                case 'seek': {
                    const target = msg.positionMs ?? 0;
                    // The position used to be recorded whether or not the seek landed, so
                    // the hub could hold — and hand to the next device — a position the
                    // speaker had never been at. If it didn't land, reload there instead:
                    // that IS where the user asked to be.
                    if (
                        await this.commandLanded((cb) => this.castPlayer?.seek(target / 1000, cb))
                    ) {
                        this.lastPositionMs = target;
                    } else {
                        log.warn(
                            `[cast-bridge] ${this.friendlyName}: seek did not reach the device — reloading`,
                        );
                        this.teardownCast();
                        await this.loadCurrent(target, this.playing);
                    }
                    break;
                }
                case 'setVolume':
                    if (
                        !(await this.commandLanded((cb) =>
                            this.castClient?.setVolume({ level: (msg.level ?? 100) / 100 }, cb),
                        ))
                    ) {
                        log.warn(
                            `[cast-bridge] ${this.friendlyName}: volume did not reach the device`,
                        );
                    }
                    break;
                default:
                    break;
            }
        } catch (error) {
            log.error(`[cast-bridge] ${this.friendlyName}: ${msg.cmd} failed`, error);
        }
    }

    /** @returns whether the speaker actually started (PROTOCOL §7.1's `loaded.ok`). */
    private async loadCurrent(positionMs: number, play: boolean): Promise<boolean> {
        const track = this.tracks[this.index];
        if (!track) return false;
        if (!track.streamUrl) {
            log.error(
                `[cast-bridge] ${this.friendlyName}: track "${track.title}" has no streamUrl — ` +
                    'the queue was published by an older client; start playback again on the ' +
                    'sending device to republish it',
            );
            return false;
        }
        log.info(
            `[cast-bridge] ${this.friendlyName}: loading "${track.title}" ` +
                `(${track.mime ?? 'audio/mpeg'}) @ ${positionMs}ms`,
        );
        log.info(`[cast-bridge] contentId: ${track.streamUrl}`);
        let player: import('castv2-client').CastPlayer;
        try {
            player = await this.ensureCast();
        } catch (error) {
            // Nothing to load into. This used to throw to a caller that only logged,
            // leaving `playing` true — a playing bar over a speaker we could not even
            // connect to.
            log.error(
                `[cast-bridge] ${this.friendlyName}: cannot reach the device ` +
                    `(${(error as Error).message})`,
            );
            this.playing = false;
            this.report();
            return false;
        }
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
            try {
                // Breathe before retrying: a failed connect kicks off an mDNS re-query, and
                // if the device has moved this is the window in which its new address lands
                // (updateHost). Retrying instantly would just dial the stale one again.
                await new Promise((r) => setTimeout(r, 1200));
                const freshPlayer = await this.ensureCast();
                await loadOnce(freshPlayer);
            } catch (retryError) {
                // Out of options — the device is unreachable (asleep, moved to another
                // address, off the network). Say so instead of throwing to a caller that
                // only logs: leaving `playing` true made every client show a playing bar
                // for a speaker that was silent, and the scrubber ran on a ghost.
                log.error(
                    `[cast-bridge] ${this.friendlyName}: giving up on this load ` +
                        `(${(retryError as Error).message})`,
                );
                this.teardownCast();
                this.playing = false;
                this.report();
                return false;
            }
        }
        this.lastPositionMs = positionMs;
        this.playing = play;
        this.report();
        this.startTicker();
        return true;
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
        const stillOurs = session.activeDeviceId === this.hubDeviceId;
        // No live receiver at all. This is the ordinary shape of "Feishin restarted while
        // the speaker kept playing": the bridge lives IN Feishin's main process, so its
        // socket died with the app, and the hub relinquishes the active slot whenever the
        // active device drops. Gating adoption on the hub still naming us active therefore
        // never fired in the one case it was written for — the session was left orphaned
        // and every client treated a speaker that was audibly still playing as stopped.
        // Claiming from the orphan slot has to be earned, though: we only take it if the
        // device is really playing a track from THIS session (see the contentId check).
        const orphaned = session.activeDeviceId == null && (session.queue?.length ?? 0) > 0;
        if (!stillOurs && !orphaned) return;
        this.adopted = true;
        this.tracks = session.queue ?? [];
        this.index = session.index ?? 0;
        this.lastPositionMs = session.positionMs ?? 0;
        this.sessionMeta = {
            savedQueueId: session.savedQueueId ?? undefined,
            sourceKind: session.sourceKind ?? undefined,
            sourceName: session.sourceName ?? undefined,
        };
        void this.adoptRunningSession(!stillOurs);
    }

    // ---------------------------------------------------------------- cast

    /**
     * The device closed our connection (idle timeout, receiver app replaced by another
     * sender, network blip). Drop the stale session so nothing talks into the void, and if
     * we were playing, try to re-join — the speaker may well still be playing, either on
     * its own or because someone resumed it from the Google Home app.
     */
    private onCastSocketClosed(): void {
        if (this.destroyed || this.tearingDown || this.releasing || !this.castClient) return;
        log.warn(`[cast-bridge] ${this.friendlyName}: cast connection closed by the device`);
        const wasPlaying = this.playing;
        this.teardownCast();
        if (wasPlaying) this.tryReadoptAfterDrop();
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

    private async probeReachability(): Promise<void> {
        if (this.destroyed) return;
        const ok = await this.speakerReachable();
        if (this.destroyed) return;
        if (ok) {
            this.probeFailures = 0;
        } else {
            this.probeFailures += 1;
        }
        // An open cast socket is proof enough on its own — don't let a probe that lost a
        // packet contradict a speaker we are actively talking to.
        const reachable =
            ok || !!this.castClient || this.probeFailures < REACHABILITY_FAILS_BEFORE_DOWN;
        if (reachable !== this.reachable) {
            log.info(`[cast-bridge] ${this.friendlyName}: reachable → ${reachable}`);
        }
        this.reachable = reachable;
        // Re-asserted every tick, not only on change: the hub expires a verdict whose
        // bridge has gone quiet rather than keep speaking for it (§3.2).
        this.send({
            appRunning: !!this.castPlayer,
            reachable,
            t: 'deviceState',
        });
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

    /**
     * Wait out the jitter, re-check, then claim — or stay down and wait for the next
     * `devices` frame to tell us the holder let go.
     */
    private scheduleClaim(delayMs?: number): void {
        if (this.destroyed || this.claimTimer || this.ws) return;
        const wait = delayMs ?? Math.random() * CLAIM_JITTER_MS;
        this.claimTimer = setTimeout(() => {
            this.claimTimer = null;
            if (this.destroyed || this.ws) return;
            if (Date.now() < this.standDownUntil) return;
            // Don't decide on a registry we haven't been given yet (see REGISTRY_WAIT_MS).
            if (!isHubConnected() && Date.now() - this.createdAt < REGISTRY_WAIT_MS) {
                this.scheduleClaim(1000);
                return;
            }
            if (this.claimedElsewhere()) {
                if (!this.standingDown) {
                    log.info(
                        `[cast-bridge] ${this.friendlyName}: already bridged by another ` +
                            'client — standing down',
                    );
                }
                this.standingDown = true;
                return;
            }
            this.standingDown = false;
            this.connectHub();
        }, wait);
    }

    /** `delayMs` overrides the backoff — used by the superseded stand-down. */
    private scheduleReconnect(delayMs?: number): void {
        this.ws = null;
        this.stopHeartbeat();
        if (this.destroyed || this.reconnectTimer) return;
        const jitter = Math.random() * 0.3 * this.backoffMs;
        const delay = delayMs ?? this.backoffMs + jitter;
        this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            // Back through arbitration, not straight to connectHub: while we were away
            // another client may have taken the speaker, and reclaiming it blindly is
            // exactly the war the stand-down exists to end.
            this.scheduleClaim(0);
        }, delay);
    }

    private send(obj: unknown): void {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(obj));
            return;
        }
        // A `loaded` or `released` lost here leaves the hub waiting on an answer that will
        // never arrive, so it is worth a line. Reports and heartbeats are not.
        const t = (obj as { t?: string })?.t;
        if (t && t !== 'report' && t !== 'deviceState') {
            log.warn(`[cast-bridge] ${this.friendlyName}: dropped "${t}" — hub socket not open`);
        }
    }

    /**
     * Can we open a TCP connection to the speaker right now? Deliberately the weakest
     * possible question: it proves the hardware is powered on and on a network we can
     * reach, without touching whatever it happens to be doing. Probing at the castv2
     * level would mean LAUNCHing the receiver app, which would silence a speaker that
     * is happily playing over Bluetooth.
     */
    private speakerReachable(): Promise<boolean> {
        return new Promise((resolve) => {
            const socket = new net.Socket();
            let settled = false;
            const done = (ok: boolean) => {
                if (settled) return;
                settled = true;
                socket.destroy();
                resolve(ok);
            };
            socket.setTimeout(PROBE_TIMEOUT_MS);
            socket.once('connect', () => done(true));
            socket.once('timeout', () => done(false));
            socket.once('error', () => done(false));
            try {
                socket.connect(CAST_PORT, this.host);
            } catch {
                done(false);
            }
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

    private startReachability(): void {
        this.stopReachability();
        void this.probeReachability();
        this.reachabilityTimer = setInterval(
            () => void this.probeReachability(),
            REACHABILITY_INTERVAL_MS,
        );
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

    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private stopReachability(): void {
        if (this.reachabilityTimer) clearInterval(this.reachabilityTimer);
        this.reachabilityTimer = null;
    }

    private stopTicker(): void {
        if (this.ticker) clearInterval(this.ticker);
        this.ticker = null;
    }

    private teardownCast(): void {
        this.stopTicker();
        // close() fires the socket's own 'close' — flagged so onCastSocketClosed treats it
        // as ours and doesn't chase a re-adoption of the session we're deliberately dropping.
        this.tearingDown = true;
        try {
            this.castClient?.close();
        } catch {
            /* ignore */
        }
        this.tearingDown = false;
        this.castClient = null;
        this.castPlayer = null;
        this.playing = false;
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
}

/**
 * Identity of a track inside a stream URL, for comparing against a Chromecast's
 * `contentId`.
 *
 * Comparing whole URLs looked equivalent and was not: the URL carries a salted auth
 * token and transcoding parameters, so rotating credentials, changing the bitrate
 * setting or publishing from a different client all produce a different string for the
 * same song — and every ownership check that depended on it silently answered "not
 * ours". The Subsonic id is the part that actually identifies the track.
 */
function streamIdentity(url: null | string | undefined): null | string {
    if (!url) return null;
    try {
        const id = new URL(url).searchParams.get('id');
        if (id) return id;
    } catch {
        /* not a parseable URL — fall through */
    }
    return url;
}

// ------------------------------------------------------------------ manager

const bridges = new Map<string, CastDeviceBridge>();
let bonjour: InstanceType<typeof Bonjour> | null = null;
let browser: CastBrowser | null = null;
let requeryTimer: NodeJS.Timeout | null = null;
let requeryCount = 0;
let sweepTimer: NodeJS.Timeout | null = null;

// bonjour-service sends ONE query when the browser is created and then relies on the device's own
// periodic announcements, which a Chromecast makes only every couple of minutes. So a single lost
// or too-early query (the Wi-Fi interface not up yet, a switch that drops the first multicast) cost
// ~90s before the speaker appeared. Re-query instead: fast while we're likely still missing
// devices, then a slow keepalive that also picks up anything powered on later. Queries are tiny
// multicast packets and re-discovery is idempotent (`bridges.has` below).
const REQUERY_FAST_MS = 3_000;
const REQUERY_FAST_TRIES = 10;
const REQUERY_SLOW_MS = 60_000;
// Last hub config applied to the bridge manager. The renderer re-pushes saved
// hub settings on every (re)connect; without this guard each push tore down and
// recreated mDNS discovery on a REUSED Bonjour socket, which then failed to send
// the initial active query — so discovery fell back to the device's periodic
// passive announcement (~2 min) instead of finding it in ~1s.
let lastBridgeConfig: null | { enabled: boolean; token: string; url: string } = null;

/**
 * Ask the network to re-announce itself, now. Called when a bridge can't reach the address
 * it has: the answer carries the device's current address, which is what a bridge that has
 * gone stale needs to hear.
 */
function requeryCastDevices(): void {
    try {
        browser?.update();
    } catch {
        /* discovery is best-effort */
    }
}

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
        if (!device) return;
        const existing = bridges.get(device.id);
        if (existing) {
            // Re-discovery is otherwise ignored, which froze each bridge at the address it
            // first saw. Every announcement is a chance to notice the device moved.
            existing.lastSeenAt = Date.now();
            existing.updateHost(device.host);
            return;
        }
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

    // A bridge used to live until mDNS said `down` — which an unplugged Chromecast never
    // says, because it isn't there to say it. So a speaker seen once on any network kept a
    // healthy hub socket forever, and every client's picker offered it as an online
    // receiver from anywhere in the world. Two independent signals have to agree before we
    // give up on one: mDNS hasn't mentioned it for a while AND it doesn't answer a probe.
    sweepTimer = setInterval(() => {
        const cutoff = Date.now() - MISSING_GRACE_MS;
        bridges.forEach((bridge, id) => {
            if (bridge.lastSeenAt > cutoff || bridge.looksReachable) return;
            log.info(
                `[cast-bridge] ${id}: gone from mDNS for ${MISSING_GRACE_MS / 1000}s and not ` +
                    'answering — dropping the bridge',
            );
            bridge.destroy();
            bridges.delete(id);
        });
    }, BRIDGE_SWEEP_MS);

    requeryCount = 0;
    const requery = (): void => {
        if (!browser) return;
        requeryCount += 1;
        browser.update();
        requeryTimer = setTimeout(
            requery,
            requeryCount < REQUERY_FAST_TRIES ? REQUERY_FAST_MS : REQUERY_SLOW_MS,
        );
    };
    requeryTimer = setTimeout(requery, REQUERY_FAST_MS);
}

function stopBridging(): void {
    if (requeryTimer) clearTimeout(requeryTimer);
    requeryTimer = null;
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
    browser?.stop();
    browser = null;
    bridges.forEach((bridge) => bridge.destroy());
    bridges.clear();
    // Fully release the mDNS socket so the next start gets a clean one.
    bonjour?.destroy();
    bonjour = null;
}

// §12.2 step 2: re-evaluate ownership whenever the registry changes, so a speaker
// released by a client that quit is picked back up without waiting for a restart.
hubEvents.on('devices', () => {
    bridges.forEach((bridge) => bridge.reevaluate());
});

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

/**
 * The hub ids of the cast speakers **this process** is currently bridging.
 *
 * Asked by the renderer to answer one question: when playback is on a Chromecast,
 * is this client the one driving it? Ownership is arbitrated (§12.2 of the
 * protocol — one bridging client per speaker), so the answer designates exactly
 * one client, which is what makes it safe for that client to scrobble on the
 * speaker's behalf. A Chromecast holds no Navidrome credentials and cannot
 * scrobble for itself, and every other client is only watching.
 */
ipcMain.handle('cast-bridged-devices', (): string[] =>
    [...bridges.values()]
        .filter((bridge) => bridge.isRegistered)
        .map((bridge) => bridge.hubDeviceId),
);
