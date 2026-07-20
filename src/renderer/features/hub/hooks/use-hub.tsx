import isElectron from 'is-electron';
import { useCallback, useEffect, useRef } from 'react';

import { api } from '/@/renderer/api';
import { getItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { usePlayerEvents } from '/@/renderer/features/player/audio-player/hooks/use-player-events';
import { toast } from '/@/shared/components/toast/toast';
import {
    useCurrentServerId,
    useHubSettings,
    useHubStore,
    usePlayerActions,
    usePlayerStore,
} from '/@/renderer/store';
import { LibraryItem, QueueSong, Song } from '/@/shared/types/domain-types';
import { PlayerRepeat, PlayerShuffle, PlayerStatus } from '/@/shared/types/types';

const hub = isElectron() ? window.api.hub : null;

/**
 * navi-connect receiver/controller glue.
 *
 * Receives `do` directives from the hub and drives the player; emits `report`
 * (position/index/playing) ~1 Hz, but ONLY while this device is the active
 * receiver. State is tracked via refs fed by player events so the event-handler
 * sends never read stale React state. Transport lives in the main process
 * (src/main/features/core/hub/index.ts).
 */
export const useHub = () => {
    const settings = useHubSettings();
    const serverId = useCurrentServerId();
    const {
        mediaPause,
        mediaPlay,
        mediaPlayByIndex,
        mediaSeekToTimestamp,
        setQueue,
        setRepeat,
        setShuffle,
        setVolume,
    } = usePlayerActions();

    // Identity + live playback mirror, kept in refs (read from event handlers).
    const myId = useRef<null | string>(null);
    const activeId = useRef<null | string>(null);
    const serverIdRef = useRef(serverId);
    const positionMs = useRef(0);
    const index = useRef(usePlayerStore.getState().player.index);
    const playing = useRef(false);
    const lastQueueSig = useRef('');
    // Throttle the progress-path report to the ~1 Hz contract — the audio engine
    // fires progress several times a second, which multiplied hub traffic.
    const lastProgressReportAt = useRef(0);
    // Memoize resolved stream URLs by track id so a queue-membership change
    // doesn't re-resolve getStreamUrl for every track that didn't change.
    const streamUrlCache = useRef<Map<string, string | undefined>>(new Map());
    // Seek armed during a do:load that changes track: applied once the player
    // reports the new song, because seeking during the source reload is lost.
    // `pause` re-asserts the paused state after the seek — mediaPlayByIndex
    // starts async playback that an immediate mediaPause() loses the race to.
    const pendingSeek = useRef<null | { index: number; pause: boolean; sec: number }>(null);
    // Wall-clock until which local player events are treated as hub-driven
    // (not user-initiated) — prevents do:load side effects from being
    // misinterpreted as "user started new local playback".
    const hubDrivenUntil = useRef(0);

    const publicUrlRef = useRef('');
    publicUrlRef.current = settings.publicServerUrl?.trim().replace(/\/$/, '') ?? '';

    serverIdRef.current = serverId;

    const isActive = () => myId.current !== null && activeId.current === myId.current;

    const isRemoteActiveNow = () =>
        myId.current !== null && activeId.current !== null && activeId.current !== myId.current;

    // When the hub tells us another device is the active receiver while our
    // local player is (auto)playing — e.g. Feishin restored its queue and
    // started playing on launch before the `welcome` arrived — silence the
    // local audio. Otherwise it runs away invisibly: the bar shows the remote
    // session and there's no local pause control reachable.
    const reconcileRemoteActive = useCallback(() => {
        if (isRemoteActiveNow() && playing.current && Date.now() >= hubDrivenUntil.current) {
            mediaPause();
            // Auto-resume starts the audio engine asynchronously, so a single
            // pause can lose the race and the audio keeps going. Re-assert it
            // shortly after; the onPlayerProgress watchdog below is the ongoing
            // safety net if even this is beaten.
            setTimeout(() => {
                if (isRemoteActiveNow() && Date.now() >= hubDrivenUntil.current) mediaPause();
            }, 150);
        }
    }, [mediaPause]);

    const report = useCallback((overrides?: Record<string, unknown>) => {
        if (!hub || !isActive()) return;
        hub.send({
            index: index.current,
            isPlaying: playing.current,
            positionMs: positionMs.current,
            t: 'report',
            ...overrides,
        });
    }, []);

    // Track metadata published to the hub. streamUrl/mime let URL-based
    // receivers (the Chromecast bridge) play without speaking Subsonic; the
    // direct URL resolves instantly (no transcode-decision round trip).
    const rewriteToPublic = useCallback((url: null | string | undefined) => {
        const base = publicUrlRef.current;
        if (!url || !base) return url ?? undefined;
        try {
            const parsed = new URL(url);
            return `${base}${parsed.pathname}${parsed.search}`;
        } catch {
            return url;
        }
    }, []);

    const buildHubTracks = useCallback(async (items: QueueSong[]) => {
        const sid = serverIdRef.current;
        return Promise.all(
            items.map(async (item) => {
                let streamUrl: string | undefined;
                if (sid) {
                    const cache = streamUrlCache.current;
                    if (cache.has(item.id)) {
                        streamUrl = cache.get(item.id);
                    } else {
                        try {
                            streamUrl = (await api.controller.getStreamUrl({
                                apiClientProps: { serverId: sid },
                                query: { id: item.id, skipAutoTranscode: true, transcode: false },
                            })) as string;
                        } catch {
                            streamUrl = undefined;
                        }
                        cache.set(item.id, streamUrl);
                    }
                }
                return {
                    album: item.album ?? undefined,
                    artist: item.artistName,
                    durationMs: item.duration ?? undefined,
                    favorite: item.userFavorite,
                    id: item.id,
                    imageUrl:
                        rewriteToPublic(
                            getItemImageUrl({
                                id: item.id,
                                imageUrl: item.imageUrl,
                                itemType: LibraryItem.SONG,
                                serverId: item._serverId,
                                type: 'itemCard',
                                useRemoteUrl: true,
                            }),
                        ) || undefined,
                    mime: item.container ? `audio/${item.container === 'mp3' ? 'mpeg' : item.container}` : undefined,
                    rating: item.userRating,
                    streamUrl: rewriteToPublic(streamUrl),
                    title: item.name,
                };
            }),
        );
    }, [rewriteToPublic]);

    // Publish our local queue to the hub when it changes. This is how the hub
    // learns what's playing (and claims us as the active device) when the user
    // starts playback in Feishin directly. Gated so we never hijack playback
    // from another active device — only publish when we're active or nothing is.
    const publishQueue = useCallback(() => {
        if (!hub) return;
        // A do:load fires onCurrentSongChange → publishQueue while we're now the
        // active device; without this gate we'd echo an act:setQueue back to the
        // hub carrying the PREVIOUS track's position, overwriting the resume point.
        if (Date.now() < hubDrivenUntil.current) return;
        if (!(activeId.current === null || activeId.current === myId.current)) return;
        const items = usePlayerStore.getState().getQueue().items;
        const sig = items.map((item) => item.id).join(',');
        if (sig === lastQueueSig.current) return;
        lastQueueSig.current = sig;
        if (!items.length) return;
        void (async () => hub.send({
            action: 'setQueue',
            index: index.current,
            play: playing.current,
            positionMs: positionMs.current,
            t: 'act',
            tracks: await buildHubTracks(items),
        }))();
    }, [buildHubTracks]);

    // Spotify semantics: if the user starts playback locally while another
    // device is active, the music belongs to the session — send the local
    // queue to the hub (which loads it on the ACTIVE remote device) and keep
    // local audio silent. Hub-driven events are exempt via hubDrivenUntil.
    const lastRoutedAt = useRef(0);
    const routeLocalPlayToRemote = useCallback(() => {
        if (!hub || !playing.current) return;
        if (Date.now() < hubDrivenUntil.current) return;
        if (Date.now() - lastRoutedAt.current < 1000) return;
        const remoteActive =
            myId.current !== null &&
            activeId.current !== null &&
            activeId.current !== myId.current;
        if (!remoteActive) return;

        const state = usePlayerStore.getState();
        const items = state.getQueue().items;
        if (!items.length) return;
        lastRoutedAt.current = Date.now();
        void (async () => hub.send({
            action: 'setQueue',
            index: state.player.index,
            play: true,
            positionMs: 0,
            t: 'act',
            tracks: await buildHubTracks(items),
        }))();
        // Keep the sig in sync so publishQueue doesn't re-send this queue later.
        lastQueueSig.current = items.map((item) => item.id).join(',');
        // The session plays it remotely — silence the local player.
        mediaPause();
    }, [buildHubTracks, mediaPause]);

    const resolveSongs = useCallback(async (tracks: Array<any>): Promise<Song[]> => {
        const sid = serverIdRef.current;
        if (!sid || !tracks?.length) return [];
        const results = await Promise.all(
            tracks.map((track) =>
                api.controller
                    .getSongDetail({ apiClientProps: { serverId: sid }, query: { id: track.id } })
                    .catch(() => null),
            ),
        );
        // Keep the resolved queue STRICTLY 1:1 with the hub's. Filtering out songs
        // missing from this server's library (or a transient getSongDetail failure)
        // shortened the queue and shifted the index → the hub's `index` then pointed
        // at the wrong track, which read as the queue "resetting" after a transfer.
        // Mirror Navic's resolveQueue: synthesize a placeholder Song from the hub
        // track meta for any id we couldn't resolve (the id is a valid Navidrome id
        // on this single-server setup, so playback by id still works).
        return results.map((song, i) => {
            if (song) return song;
            const t = tracks[i];
            return {
                _serverId: sid,
                album: t.album ?? '',
                albumArtists: [],
                albumId: undefined,
                artistName: t.artist ?? '',
                artists: t.artist ? [{ id: '', name: t.artist }] : [],
                duration: t.durationMs ?? 0,
                id: t.id,
                // The song id doubles as the cover-art id across this system; build
                // the cover with our own server creds (imageUrl left unset).
                imageId: t.id,
                imageUrl: undefined,
                name: t.title ?? '',
                userFavorite: t.favorite ?? false,
                userRating: t.rating ?? null,
            } as unknown as Song;
        });
    }, []);

    const handleDo = useCallback(
        async (msg: any) => {
            // Local player events caused by this directive are hub-driven, not
            // user actions (window covers async engine events).
            hubDrivenUntil.current = Date.now() + 2000;
            switch (msg.cmd) {
                case 'jump':
                    mediaPlayByIndex(msg.index);
                    break;
                case 'load': {
                    const targetSec = (msg.positionMs ?? 0) / 1000;
                    const incomingIds: string[] = (msg.tracks ?? []).map((t: any) => t.id);
                    // We become the active device once this queue loads, so pre-set the
                    // publish signature to the loaded queue — otherwise onCurrentSongChange
                    // republishes it back to the hub with a stale position.
                    if (incomingIds.length) lastQueueSig.current = incomingIds.join(',');
                    const state = usePlayerStore.getState();
                    const currentIds = state.getQueue().items.map((item) => item.id);
                    const sameQueue =
                        incomingIds.length > 0 &&
                        incomingIds.length === currentIds.length &&
                        incomingIds.every((id, n) => id === currentIds[n]);

                    const wantPause = msg.play === false;
                    if (sameQueue) {
                        // Queue is already loaded locally (e.g. transfer back to
                        // this device). Reloading would reinitialise the audio
                        // engine to 0 and lose the seek — instead just position
                        // and play. The hub's position is authoritative.
                        if ((msg.index ?? 0) !== state.player.index) {
                            // Changing track reloads the source; an immediate
                            // seek would be lost. Arm it for onCurrentSongChange.
                            pendingSeek.current = {
                                index: msg.index ?? 0,
                                pause: wantPause,
                                sec: targetSec,
                            };
                            mediaPlayByIndex(msg.index ?? 0);
                        } else {
                            mediaSeekToTimestamp(targetSec);
                        }
                    } else {
                        const songs = await resolveSongs(msg.tracks);
                        if (!songs.length) return;
                        pendingSeek.current = {
                            index: msg.index ?? 0,
                            pause: wantPause,
                            sec: targetSec,
                        };
                        setQueue(songs, msg.index ?? 0, targetSec);
                    }
                    if (wantPause) mediaPause();
                    else mediaPlay();
                    break;
                }
                case 'pause':
                    mediaPause();
                    break;
                case 'play':
                    mediaPlay();
                    break;
                case 'queueChanged': {
                    const songs = await resolveSongs(msg.tracks);
                    if (songs.length) setQueue(songs, msg.index ?? 0);
                    break;
                }
                case 'release': {
                    // Final position report, THEN released — order matters so the
                    // hub captures our exact spot before handing off.
                    mediaPause();
                    report({ isPlaying: false });
                    hub?.send({
                        index: index.current,
                        positionMs: positionMs.current,
                        t: 'released',
                    });
                    break;
                }
                case 'seek':
                    mediaSeekToTimestamp((msg.positionMs ?? 0) / 1000);
                    break;
                case 'setRepeat':
                    setRepeat(msg.mode as PlayerRepeat);
                    break;
                case 'setShuffle':
                    setShuffle(msg.on ? PlayerShuffle.TRACK : PlayerShuffle.NONE);
                    break;
                case 'setVolume':
                    setVolume(msg.level);
                    break;
                default:
                    break;
            }
        },
        [
            mediaPause,
            mediaPlay,
            mediaPlayByIndex,
            mediaSeekToTimestamp,
            report,
            resolveSongs,
            setQueue,
            setRepeat,
            setShuffle,
            setVolume,
        ],
    );

    // Hub-authoritative startup/reconnect: adopt the hub's session as our local queue
    // instead of publishing our own (possibly stale) restored queue over it. Runs on
    // `welcome` and every `session` frame. Only adopts when there is NO live receiver
    // (activeId === null); another active device is a display-mirror concern, and when
    // we're active the reporter owns publishing. Adopted queues load PAUSED — a
    // launching/taking-over client stays a controller until the user hits play.
    const adoptIfNoLiveReceiver = useCallback(
        async (session: any) => {
            if (!session || activeId.current !== null) return;
            const hubTracks: Array<any> = session.queue ?? [];
            const hubSig = hubTracks.map((track) => track.id).join(',');
            const state = usePlayerStore.getState();
            const localSig = state
                .getQueue()
                .items.map((item) => item.id)
                .join(',');

            // We're the live player of this exact queue (our socket blipped and
            // reconnected while we kept playing locally): the hub cleared active on our
            // drop, so RE-CLAIM it by republishing (play=true) — don't reload or pause.
            if (hubSig && hubSig === localSig && playing.current) {
                lastQueueSig.current = '';
                publishQueue();
                return;
            }
            // Empty hub session: keep our local queue as the offline fallback; allow the
            // first real user play to publish it.
            if (!hubSig) {
                lastQueueSig.current = '';
                return;
            }
            // Already adopted this exact queue — nothing to do (repeated session frames).
            if (hubSig === lastQueueSig.current && hubSig === localSig) return;

            const songs = await resolveSongs(hubTracks);
            if (!songs.length) return;
            const targetSec = (session.positionMs ?? 0) / 1000;
            const targetIndex = session.index ?? 0;
            hubDrivenUntil.current = Date.now() + 2000;
            // Seek is armed for onCurrentSongChange (a source reload loses an immediate
            // seek); `pause: true` re-asserts the paused state after the async load.
            pendingSeek.current = { index: targetIndex, pause: true, sec: targetSec };
            lastQueueSig.current = hubSig;
            setQueue(songs, targetIndex, targetSec);
            mediaPause();
        },
        [mediaPause, publishQueue, resolveSongs, setQueue],
    );

    // Push config to the main-process transport on mount + whenever it changes.
    useEffect(() => {
        hub?.setSettings(settings.enabled, settings.url, settings.token, settings.name).catch(
            () => undefined,
        );
    }, [settings.enabled, settings.name, settings.token, settings.url]);

    // Wire the inbound hub stream.
    useEffect(() => {
        if (!hub) return undefined;
        const { setStore } = useHubStore.getState().actions;
        const dispose = hub.onMessage((msg: any) => {
            if (msg.t === 'welcome') {
                myId.current = msg.deviceId ?? null;
                activeId.current = msg.session?.activeDeviceId ?? null;
                setStore({
                    activeDeviceId: activeId.current,
                    connected: true,
                    devices: msg.devices ?? [],
                    myDeviceId: myId.current,
                    remoteIsPlaying: msg.session?.isPlaying ?? false,
                    remotePositionAt: Date.now(),
                    remotePositionMs: msg.session?.positionMs ?? 0,
                    remoteQueue: msg.session?.queue ?? [],
                    remoteQueueIndex: msg.session?.index ?? 0,
                    remoteRepeat: msg.session?.repeat ?? 'none',
                    remoteShuffle: msg.session?.shuffle ?? false,
                });
                reconcileRemoteActive();
                // Hub is authoritative: adopt its session rather than pushing ours.
                void adoptIfNoLiveReceiver(msg.session);
            } else if (msg.t === 'session') {
                activeId.current = msg.activeDeviceId ?? null;
                setStore({
                    activeDeviceId: activeId.current,
                    remoteIsPlaying: msg.isPlaying ?? false,
                    remotePositionAt: Date.now(),
                    remotePositionMs: msg.positionMs ?? 0,
                    remoteQueue: msg.queue ?? [],
                    remoteQueueIndex: msg.index ?? 0,
                    remoteRepeat: msg.repeat ?? 'none',
                    remoteShuffle: msg.shuffle ?? false,
                });
                reconcileRemoteActive();
                // Active device may have just dropped (activeId → null): adopt the
                // last-known queue locally, paused, so we're not stranded mirroring it.
                void adoptIfNoLiveReceiver(msg);
            } else if (msg.t === 'progress') {
                setStore({
                    remoteIsPlaying: msg.isPlaying ?? false,
                    remotePositionAt: Date.now(),
                    remotePositionMs: msg.positionMs ?? 0,
                    remoteQueueIndex: msg.index ?? 0,
                });
            } else if (msg.t === 'devices') {
                setStore({ devices: msg.devices ?? [] });
            } else if (msg.t === 'do') {
                void handleDo(msg);
            } else if (msg.t === 'disconnected') {
                // The main process lost the socket. Clear active/connected so
                // isRemoteSessionActive() releases the player bar and the local
                // watchdog stops force-pausing local audio; reset the guards so a
                // reconnect republishes cleanly.
                activeId.current = null;
                hubDrivenUntil.current = 0;
                lastQueueSig.current = '';
                setStore({ activeDeviceId: null, connected: false });
            } else if (msg.t === 'error') {
                // Surface hub-side failures (bad token, target offline, …) — they
                // were silent, so a wrong token just looked like "never connects".
                const message =
                    msg.code === 'target_offline'
                        ? 'That device is offline.'
                        : msg.code === 'auth'
                          ? 'The hub rejected the token — check your navi-connect settings.'
                          : (msg.message ?? 'Hub error');
                toast.warn({ message });
            }
        });
        return () => dispose();
    }, [adoptIfNoLiveReceiver, handleDo, publishQueue, reconcileRemoteActive]);

    // Feed the refs from player events; publish queue changes + report when active.
    usePlayerEvents(
        {
            onCurrentSongChange: (properties) => {
                index.current = properties.index;
                const pending = pendingSeek.current;
                if (pending && properties.index === pending.index) {
                    pendingSeek.current = null;
                    hubDrivenUntil.current = Date.now() + 2000;
                    // Small delay so the engine finishes loading the new source
                    // before the seek (same approach as use-queue-restore).
                    setTimeout(() => {
                        mediaSeekToTimestamp(pending.sec);
                        if (pending.pause) {
                            // mediaPlayByIndex/setQueue start playback async; the
                            // earlier mediaPause loses that race. Re-assert it
                            // after the seek so a paused transfer STAYS paused.
                            setTimeout(() => mediaPause(), 100);
                        }
                    }, 150);
                }
                routeLocalPlayToRemote();
                publishQueue();
                report({ index: properties.index });
            },
            onPlayerProgress: (properties) => {
                positionMs.current = Math.round(properties.timestamp * 1000);
                // Watchdog: while another device is the active receiver, the
                // local engine must stay silent. Startup auto-resume can begin
                // (and keep) playing past the one-shot reconcile, so re-pause any
                // local playback that's still progressing. Fires only while local
                // audio actually advances, so it self-stops once truly paused.
                if (isRemoteActiveNow() && playing.current && Date.now() >= hubDrivenUntil.current) {
                    mediaPause();
                    return;
                }
                // ~1 Hz per protocol §5 — the engine fires this several times a second.
                const now = Date.now();
                if (now - lastProgressReportAt.current < 1000) return;
                lastProgressReportAt.current = now;
                report();
            },
            onPlayerStatus: (properties) => {
                playing.current = properties.status === PlayerStatus.PLAYING;
                routeLocalPlayToRemote();
                publishQueue();
                report({ isPlaying: playing.current });
            },
        },
        [mediaPause, mediaSeekToTimestamp, publishQueue, report, routeLocalPlayToRemote],
    );
};

export const HubHook = () => {
    useHub();
    return null;
};
