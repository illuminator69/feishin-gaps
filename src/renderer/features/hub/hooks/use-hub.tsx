import isElectron from 'is-electron';
import { useCallback, useEffect, useRef } from 'react';

import { api } from '/@/renderer/api';
import { getItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { placeholderSong, resolveHubTracks } from '/@/renderer/features/hub/utils/resolve-songs';
import { useLbBotLibraryRefresh } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { usePlayerEvents } from '/@/renderer/features/player/audio-player/hooks/use-player-events';
import {
    consumeQueueSession,
    findMatchingSavedQueueId,
    isNewQueueSessionPending,
    onQueueSessionReset,
    resolveQueueSource,
} from '/@/renderer/features/player/utils/saved-queue-source';
import {
    SavedQueue,
    SavedQueueKind,
    useCurrentServerId,
    useHubSettings,
    useHubStore,
    usePlayerActions,
    usePlayerStore,
    usePlayerStoreBase,
    useSavedQueuesStore,
    useTimestampStoreBase,
} from '/@/renderer/store';
import { toast } from '/@/shared/components/toast/toast';
import { LibraryItem, QueueSong, Song } from '/@/shared/types/domain-types';
import { PlayerRepeat, PlayerShuffle, PlayerStatus } from '/@/shared/types/types';

/** Coerce a hub saved-queue record (wire shape) into the local SavedQueue store shape. Songs are
 *  minimal (id + display metadata); a cross-client restore re-resolves them by id. */
const mapHubSavedQueue = (rec: any, serverId: null | string): SavedQueue => ({
    // A record minted by the other client may carry no cover URL; the queue's FIRST
    // track image stands in. Deliberately not the current track's art — the card's
    // artwork is frozen at the queue's origin so it doesn't change as playback moves.
    coverImageUrl: rec.coverImageUrl ?? rec.songs?.[0]?.imageUrl ?? null,
    createdAt: rec.createdAt ?? Date.now(),
    currentIndex: rec.currentIndex ?? 0,
    currentSongId: rec.songs?.[rec.currentIndex ?? 0]?.id,
    currentSongName: rec.currentSongName ?? rec.songs?.[rec.currentIndex ?? 0]?.title,
    id: rec.id,
    name: rec.name ?? undefined,
    positionSeconds: Math.round((rec.positionMs ?? 0) / 1000),
    repeat: (rec.repeat as PlayerRepeat) ?? PlayerRepeat.NONE,
    serverId: rec.serverId ?? serverId ?? '',
    // The session only knows shuffle as a bool, so ALBUM shuffle would degrade to TRACK
    // on every round trip — `shuffleMode` carries the real mode when the record has one.
    shuffle:
        (rec.shuffleMode as PlayerShuffle) ??
        (rec.shuffle ? PlayerShuffle.TRACK : PlayerShuffle.NONE),
    songCount: rec.songCount ?? rec.songs?.length ?? 0,
    // Full placeholder Songs, NOT bare metadata: `_serverId` is what gates the
    // stream-URL query (use-stream-url), so a stub without it restores into a player
    // that sits in PLAYING with no source — the "loads forever" bug.
    songs: (rec.songs ?? []).map(
        (t: any): QueueSong =>
            placeholderSong(t, rec.serverId ?? serverId ?? '') as unknown as QueueSong,
    ),
    sourceKind: (rec.sourceKind as SavedQueueKind) ?? 'manual',
    sourceName: rec.sourceName ?? undefined,
    updatedAt: rec.updatedAt ?? Date.now(),
});

/** Convert a local SavedQueue into the hub wire record shape (wire track fields, so the other
 *  client can render titles/artists) for syncSavedQueues. */
const savedQueueToHubRecord = (q: SavedQueue): Record<string, unknown> => ({
    coverImageUrl: q.coverImageUrl ?? undefined,
    createdAt: q.createdAt,
    currentIndex: q.currentIndex,
    id: q.id,
    name: q.name ?? undefined,
    positionMs: Math.round((q.positionSeconds ?? 0) * 1000),
    repeat: q.repeat,
    serverId: q.serverId,
    shuffle: q.shuffle !== PlayerShuffle.NONE,
    shuffleMode: q.shuffle,
    songCount: q.songCount,
    songs: q.songs.map((s) => ({
        album: s.album ?? undefined,
        artist: s.artistName,
        durationMs: s.duration ?? undefined,
        id: s.id,
        imageUrl: s.imageUrl ?? undefined,
        title: s.name,
    })),
    sourceKind: q.sourceKind,
    sourceName: q.sourceName ?? undefined,
    updatedAt: q.updatedAt,
});

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
        clearQueue,
        mediaPause,
        mediaPlay,
        mediaPlayByIndex,
        mediaSeekToTimestamp,
        mediaStop,
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
    // Stable saved-queue history identity for what we publish — see resolveSavedQueueId.
    // It survives every edit to the queue we're listening to; only a new play (or an
    // adopt/transfer-in, which reuses the hub's own record id) changes it.
    const savedQueueId = useRef<null | string>(null);
    const savedQueuePrevIds = useRef<string[]>([]);
    // The queue's origin track, captured at mint — its art is the card's (frozen) cover.
    const savedQueueCoverSong = useRef<null | QueueSong>(null);
    const savedQueueKind = useRef<SavedQueueKind>('manual');
    const savedQueueName = useRef<string | undefined>(undefined);
    // Throttle the progress-path report to the ~1 Hz contract — the audio engine
    // fires progress several times a second, which multiplied hub traffic.
    const lastProgressReportAt = useRef(0);
    // Throttles the unclaimed-session escape in publishQueue (see there).
    const lastUnclaimedPublishAt = useRef(0);
    // Have we ever published a non-empty queue? Gates the "queue cleared" publish so the
    // momentarily-empty queue at startup can't wipe the hub session.
    const sawNonEmptyQueue = useRef(false);
    // Memoize resolved stream URLs by track id so a queue-membership change
    // doesn't re-resolve getStreamUrl for every track that didn't change.
    const streamUrlCache = useRef<Map<string, string | undefined>>(new Map());
    // Seek armed during a do:load that changes track: applied once the player
    // reports the new song, because seeking during the source reload is lost.
    // `pause` re-asserts the paused state after the seek — mediaPlayByIndex
    // starts async playback that an immediate mediaPause() loses the race to.
    const pendingSeek = useRef<null | {
        armedAt: number;
        index: number;
        pause: boolean;
        sec: number;
    }>(null);
    // Wall-clock until which local player events are treated as hub-driven
    // (not user-initiated) — prevents do:load side effects from being
    // misinterpreted as "user started new local playback".
    const hubDrivenUntil = useRef(0);
    // Wall-clock until which local playback is force-paused after adopting an orphaned
    // (no active device) session — see the onPlayerProgress watchdog.
    const adoptPauseGuardUntil = useRef(0);
    // When the engine's own clock started advancing without a break. Lets the watchdogs
    // ask "is audio ACTUALLY rolling?" instead of trusting the store — see hardPause.
    const advancingSince = useRef(0);
    // Throttles hardPause so a pause that never takes can't turn into a play/pause loop.
    const lastHardPauseAt = useRef(0);

    const publicUrlRef = useRef('');
    publicUrlRef.current = settings.publicServerUrl?.trim().replace(/\/$/, '') ?? '';

    serverIdRef.current = serverId;

    const isActive = () => myId.current !== null && activeId.current === myId.current;

    const noteActive = (id: null | string) => {
        activeId.current = id;
    };

    const isRemoteActiveNow = () =>
        myId.current !== null && activeId.current !== null && activeId.current !== myId.current;

    // When the hub tells us another device is the active receiver while our
    // local player is (auto)playing — e.g. Feishin restored its queue and
    // started playing on launch before the `welcome` arrived — silence the
    // local audio. Otherwise it runs away invisibly: the bar shows the remote
    // session and there's no local pause control reachable.
    // A pause that actually reaches the audio engine, even when the store already reads
    // PAUSED. The engines act on status *changes* (`subscribePlayerStatus` fires only when
    // the value differs), so `mediaPause()` against an already-PAUSED store is inert —
    // nothing is sent anywhere. That is precisely the state a runaway lands in: `setQueue`
    // forces status PLAYING, the pause right after puts it back to PAUSED, and the engine's
    // async play() lands *after* both. Audio then runs under a bar that reads "paused", and
    // every later pause — ours or the user's click — is swallowed, so the only way out is
    // killing the app. When the store is wrong, correct it first (the audio really IS
    // playing) and then pause for real. The transient PLAYING is marked hub-driven so our
    // own status handler can't mistake it for the user starting local playback.
    // Is audio ACTUALLY rolling? `playing.current` only mirrors the store's status, and a
    // runaway contradicts the store by definition, so a watchdog that trusts it alone goes
    // blind exactly when it's needed. The engine's own clock is the ground truth: a run of
    // small forward steps means it's really playing (a single jump is a seek, a backwards
    // step a track change). 1 s of unbroken advance — long enough that a pause fade-out's
    // trailing ticks can't trip it.
    const audioIsRolling = () =>
        playing.current ||
        (advancingSince.current ? Date.now() - advancingSince.current >= 1000 : false);

    const hardPause = useCallback(() => {
        const now = Date.now();
        if (now - lastHardPauseAt.current < 2000) return;
        lastHardPauseAt.current = now;
        if (usePlayerStore.getState().player.status !== PlayerStatus.PLAYING) {
            hubDrivenUntil.current = Math.max(hubDrivenUntil.current, now + 1000);
            mediaPlay();
        }
        mediaPause();
    }, [mediaPause, mediaPlay]);

    const reconcileRemoteActive = useCallback(() => {
        if (isRemoteActiveNow() && playing.current && Date.now() >= hubDrivenUntil.current) {
            mediaPause();
            // Auto-resume starts the audio engine asynchronously, so a single
            // pause can lose the race and the audio keeps going. Re-assert it
            // shortly after; the onPlayerProgress watchdog below is the ongoing
            // safety net if even this is beaten.
            setTimeout(() => {
                if (isRemoteActiveNow() && Date.now() >= hubDrivenUntil.current) hardPause();
            }, 150);
        }
    }, [hardPause, mediaPause]);

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

    const buildHubTracks = useCallback(
        async (items: QueueSong[]) => {
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
                                    query: {
                                        id: item.id,
                                        skipAutoTranscode: true,
                                        transcode: false,
                                    },
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
                        mime: item.container
                            ? `audio/${item.container === 'mp3' ? 'mpeg' : item.container}`
                            : undefined,
                        rating: item.userRating,
                        streamUrl: rewriteToPublic(streamUrl),
                        title: item.name,
                    };
                }),
            );
        },
        [rewriteToPublic],
    );

    // Decide the saved-queue history id to publish for the current queue.
    //
    // Identity is a SESSION, not a track list: once we're listening to something, every
    // edit to it (reorder, remove, play-next, Auto DJ top-up, shuffle) keeps the same id,
    // so the hub refreshes that one record. A new id is minted only when a play call site
    // announced a new session (beginQueueSession) or we don't have one yet. The previous
    // rule — "same id while the old ids are an ordered prefix of the new ones" — failed on
    // every reorder and insert, forking a near-duplicate history card each time.
    const resolveSavedQueueId = useCallback((ids: string[]): string => {
        const startNew = isNewQueueSessionPending();
        if (savedQueueId.current && !startNew) {
            savedQueuePrevIds.current = ids;
            return savedQueueId.current;
        }
        if (!startNew) {
            // No session of our own: adopt the hub's current record when our queue is
            // substantially the same one (transfer/adopt-in), rather than duplicating it.
            const hub = useHubStore.getState();
            const hubIds = new Set(hub.remoteQueue.map((t) => t.id));
            const overlap = hubIds.size
                ? ids.filter((id) => hubIds.has(id)).length / hubIds.size
                : 0;
            if (hub.savedQueueId !== null && overlap >= 0.5) {
                savedQueueId.current = hub.savedQueueId;
                savedQueuePrevIds.current = ids;
                // Inherit the record's identity too — republishing with our own defaults
                // ('manual', no name) would blank a "Mood Flow"/album queue we adopted.
                const rec = useSavedQueuesStore
                    .getState()
                    .queues.find((q) => q.id === hub.savedQueueId);
                // No `else`: keeping the PREVIOUS queue's kind/name here republished it
                // onto the adopted record and renamed someone else's queue.
                savedQueueKind.current = rec?.sourceKind ?? 'manual';
                savedQueueName.current = rec ? (rec.name ?? rec.sourceName) : undefined;
                return savedQueueId.current!;
            }
        }
        // Genuinely new session: mint an id (or reuse the one a resume announced) and
        // stamp its source kind/name — once, at birth.
        const items = usePlayerStore.getState().getQueue().items;
        const src = resolveQueueSource(items);
        consumeQueueSession();
        // ...unless the history already HAS this queue. Our session id lives in a ref, so it
        // dies with the renderer: without this, every relaunch republished the restored queue
        // under a new id and stacked another identical card.
        savedQueueId.current = src.id ?? findMatchingSavedQueueId(ids) ?? crypto.randomUUID();
        savedQueueKind.current = src.kind;
        savedQueueName.current = src.name;
        savedQueueCoverSong.current = items[0] ?? null;
        savedQueuePrevIds.current = ids;
        return savedQueueId.current;
    }, []);

    /** Public URL of the frozen origin cover, for the saved-queue record. */
    const savedQueueCoverUrl = useCallback((): string | undefined => {
        const song = savedQueueCoverSong.current;
        if (!song) return undefined;
        return (
            rewriteToPublic(
                getItemImageUrl({
                    id: song.id,
                    imageUrl: song.imageUrl,
                    itemType: LibraryItem.SONG,
                    serverId: song._serverId,
                    type: 'itemCard',
                    useRemoteUrl: true,
                }),
            ) || undefined
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
        // Not until the hub has told us what the session IS (`welcome` sets myId). The
        // persisted queue rehydrates a moment after launch and fires this — publishing it
        // then overwrote the live session with our stale copy at index 0 / position 0 AND
        // promoted us to active receiver (the hub promotes any setQueue sender while the
        // slot is empty, which it is right after a client restart). That is what lost a
        // running cast session and restarted the queue from its first track.
        if (myId.current === null) return;
        if (!(activeId.current === null || activeId.current === myId.current)) return;
        const state = usePlayerStore.getState();
        const items = state.getQueue().items;
        const sig = items.map((item) => item.id).join(',');
        // Unclaimed-session escape (mirrors Navic's publishQueueIfOurs): nobody is the
        // active receiver and WE are playing, so this client IS the live receiver — but
        // the signature dedupe would suppress the publish forever (adopting the hub's
        // queue pins the signature to it). Without a publish the hub never promotes us,
        // so we never report, so its cursor stays frozen at the adopt point and every
        // later `session` frame drags playback back there. The publish IS the claim.
        const unclaimed =
            activeId.current === null &&
            playing.current &&
            Date.now() - lastUnclaimedPublishAt.current > 2000;
        if (sig === lastQueueSig.current && !unclaimed) return;
        if (unclaimed) lastUnclaimedPublishAt.current = Date.now();
        lastQueueSig.current = sig;
        if (!items.length) {
            // Clearing the queue has to reach the hub, or the session keeps serving the
            // queue we just threw away — open Navic afterwards and the whole list is back.
            // Only once we've actually published something, though: the queue is empty for
            // a moment at startup before the persisted one hydrates, and publishing THAT
            // would wipe a session another device is happily playing.
            if (!sawNonEmptyQueue.current) return;
            sawNonEmptyQueue.current = false;
            savedQueueId.current = null;
            savedQueueCoverSong.current = null;
            savedQueuePrevIds.current = [];
            // `clear`, not an empty setQueue: the hub flushes our position into the history
            // record before detaching the session, so the cleared queue stays resumable.
            hub.send({ action: 'clear', t: 'act' });
            return;
        }
        sawNonEmptyQueue.current = true;
        // Both refs are fed by player EVENTS, which never fired for a queue restored at
        // launch — index would still be its mount-time 0 and position 0, publishing "first
        // track, from the top" for a queue we're parked in the middle of. Take the live
        // values instead; the timestamp store is where a restored position lives until the
        // engine's first progress tick.
        index.current = state.player.index;
        if (!positionMs.current) {
            positionMs.current = Math.round(
                (useTimestampStoreBase.getState().timestamp || 0) * 1000,
            );
        }
        const sqId = resolveSavedQueueId(items.map((item) => item.id));
        void (async () =>
            hub.send({
                action: 'setQueue',
                coverImageUrl: savedQueueCoverUrl(),
                index: index.current,
                play: playing.current,
                positionMs: positionMs.current,
                savedQueueId: sqId,
                serverId: serverIdRef.current ?? undefined,
                sourceKind: savedQueueKind.current,
                sourceName: savedQueueName.current,
                t: 'act',
                tracks: await buildHubTracks(items),
            }))();
    }, [buildHubTracks, resolveSavedQueueId, savedQueueCoverUrl]);

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
            myId.current !== null && activeId.current !== null && activeId.current !== myId.current;
        if (!remoteActive) return;

        const state = usePlayerStore.getState();
        const items = state.getQueue().items;
        if (!items.length) return;
        // The session ALREADY holds this queue: a stray local play event is not new
        // intent, it's noise (a watchdog pause losing a race with the audio engine, an
        // auto-resume, a media-key round trip). Re-sending setQueue here restarts the
        // remote device at positionMs 0 — with a Chromecast that reads as the current
        // track reloading every second or two, forever. Just silence the local player.
        const hubSig = useHubStore
            .getState()
            .remoteQueue.map((track) => track.id)
            .join(',');
        const localSig = items.map((item) => item.id).join(',');
        if (hubSig && hubSig === localSig) {
            mediaPause();
            return;
        }
        lastRoutedAt.current = Date.now();
        const sqId = resolveSavedQueueId(items.map((item) => item.id));
        void (async () =>
            hub.send({
                action: 'setQueue',
                coverImageUrl: savedQueueCoverUrl(),
                index: state.player.index,
                play: true,
                positionMs: 0,
                savedQueueId: sqId,
                serverId: serverIdRef.current ?? undefined,
                sourceKind: savedQueueKind.current,
                sourceName: savedQueueName.current,
                t: 'act',
                tracks: await buildHubTracks(items),
            }))();
        // Keep the sig in sync so publishQueue doesn't re-send this queue later.
        lastQueueSig.current = items.map((item) => item.id).join(',');
        // The session plays it remotely — silence the local player.
        mediaPause();
    }, [buildHubTracks, mediaPause, resolveSavedQueueId, savedQueueCoverUrl]);

    // A pending seek that never fires (the armed index never becomes current — a
    // superseded load, a queue that changed under us) would otherwise ambush the next
    // unrelated track change, seeking it to a stale offset. Expire them.
    const PENDING_SEEK_TTL = 10_000;

    // Arm a seek for when the player reports the target track. If that track is ALREADY
    // current, seeking now is both correct and necessary — nothing will re-arm it,
    // because onCurrentSongChange only fires on an actual change.
    const armSeek = useCallback(
        (targetIndex: number, sec: number, pause: boolean) => {
            if (targetIndex === usePlayerStore.getState().player.index) {
                mediaSeekToTimestamp(sec);
                if (pause) setTimeout(() => mediaPause(), 100);
                return;
            }
            pendingSeek.current = { armedAt: Date.now(), index: targetIndex, pause, sec };
        },
        [mediaPause, mediaSeekToTimestamp],
    );

    const resolveSongs = useCallback(
        (tracks: Array<any>): Promise<Song[]> => resolveHubTracks(tracks, serverIdRef.current),
        [],
    );

    const handleDo = useCallback(
        async (msg: any) => {
            // Local player events caused by this directive are hub-driven, not
            // user actions (window covers async engine events).
            hubDrivenUntil.current = Date.now() + 2000;
            switch (msg.cmd) {
                case 'clear':
                    // The other client emptied the session queue. Stop and drop ours too,
                    // otherwise this device keeps playing a queue the session no longer has.
                    mediaStop({ reset: true });
                    clearQueue();
                    break;
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
                                armedAt: Date.now(),
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
                        // Re-arm the hub-driven window: resolveSongs fans out one
                        // getSongDetail per track and can outlast the original 2 s, after
                        // which setQueue's own events read as a fresh user action.
                        hubDrivenUntil.current = Date.now() + 2000;
                        pendingSeek.current = {
                            armedAt: Date.now(),
                            index: msg.index ?? 0,
                            pause: wantPause,
                            sec: targetSec,
                        };
                        // Load straight into the requested state — see setQueue's `play`.
                        setQueue(songs, msg.index ?? 0, targetSec, !wantPause);
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
                    // PROTOCOL §5.2: a queue edit must not disturb playback. setQueue
                    // hard-codes PLAYING and restores from position 0, so carry the
                    // current status/position across when the playing track is unchanged
                    // (an enqueue/move/remove elsewhere in the queue).
                    const before = usePlayerStore.getState();
                    const wasPlaying = before.player.status === PlayerStatus.PLAYING;
                    const playingId = before.getQueue().items[before.player.index]?.id;
                    const songs = await resolveSongs(msg.tracks);
                    if (!songs.length) break;
                    hubDrivenUntil.current = Date.now() + 2000;
                    const nextIndex = msg.index ?? 0;
                    const sameSong = !!playingId && songs[nextIndex]?.id === playingId;
                    const keepSec = sameSong ? positionMs.current / 1000 : 0;
                    // PROTOCOL §5.2 again: a queue edit must not START playback either.
                    setQueue(songs, nextIndex, keepSec, wasPlaying);
                    if (sameSong) {
                        armSeek(nextIndex, keepSec, !wasPlaying);
                    }
                    break;
                }
                case 'release': {
                    // Final position report, THEN released — order matters so the
                    // hub captures our exact spot before handing off. positionMs is fed
                    // by every onPlayerProgress tick (only the 1 Hz *report* is
                    // throttled), so it's already the engine's live position.
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
            clearQueue,
            mediaPause,
            mediaPlay,
            mediaPlayByIndex,
            mediaSeekToTimestamp,
            mediaStop,
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

            // Empty hub session: keep our local queue as the offline fallback; allow the
            // first real user play to publish it.
            if (!hubSig) {
                lastQueueSig.current = '';
                return;
            }

            const targetSec = (session.positionMs ?? 0) / 1000;
            const targetIndex = session.index ?? 0;

            if (hubSig === localSig) {
                // We already hold this exact queue and audio is running here. With no
                // active device claimed, a playing local engine IS the live receiver —
                // re-claim at OUR live position. (This used to require having been the
                // active device a moment ago; anything else fell through to the rewind
                // branch below and yanked local playback back to the hub's frozen
                // cursor — which is what stopped auto-advance.)
                if (playing.current) {
                    lastQueueSig.current = '';
                    publishQueue();
                    return;
                }
                // Otherwise another device owned this session and went away (a
                // force-stop). The hub kept ITS final position, and that — not our stale
                // local cursor — is where playback should resume. Aligning here is what
                // makes "force-stop the phone, press play on the desktop" continue from
                // the phone's spot instead of wherever this client was last parked.
                const state2 = usePlayerStore.getState();
                const drift = Math.abs(positionMs.current - (session.positionMs ?? 0));
                if (targetIndex === state2.player.index && drift < 2000) {
                    // NOT pinned to hubSig: doing so made publishQueue's dedupe suppress
                    // every later publish, so a local play could never claim the session.
                    lastQueueSig.current = '';
                    return; // genuinely in sync
                }
                hubDrivenUntil.current = Date.now() + 2000;
                lastQueueSig.current = '';
                if (targetIndex !== state2.player.index) mediaPlayByIndex(targetIndex);
                armSeek(targetIndex, targetSec, true);
                adoptPauseGuardUntil.current = Date.now() + 3000;
                mediaPause();
                return;
            }

            const songs = await resolveSongs(hubTracks);
            if (!songs.length) return;
            hubDrivenUntil.current = Date.now() + 2000;
            // Seek is armed for onCurrentSongChange (a source reload loses an immediate
            // seek); `pause: true` re-asserts the paused state after the async load.
            pendingSeek.current = {
                armedAt: Date.now(),
                index: targetIndex,
                pause: true,
                sec: targetSec,
            };
            // Left empty (not pinned to hubSig) so the first local play republishes and
            // claims the session — the adopted queue is ours to own now.
            lastQueueSig.current = '';
            adoptPauseGuardUntil.current = Date.now() + 3000;
            // Loaded PAUSED outright. Loading it playing and pausing straight after was the
            // runaway: setQueue's PLAYING starts the engine asynchronously and the pause
            // could land first, so the audio arrived to a store that already read PAUSED —
            // and since the engines only act on status *changes*, every later pause (ours
            // and the user's click) was a no-op against it.
            setQueue(songs, targetIndex, targetSec, false);
            // Net for anything that still manages to start (an in-flight auto-resume, the
            // armed pendingSeek's own load). Only when audio is genuinely rolling — against
            // a truly silent player hardPause's play/pause correction would be the thing
            // making noise.
            setTimeout(() => {
                if (activeId.current === null && audioIsRolling()) hardPause();
            }, 400);
        },
        [armSeek, hardPause, mediaPause, mediaPlayByIndex, publishQueue, resolveSongs, setQueue],
    );

    // Held in a ref so the long-lived message handler below can call it without
    // the socket effect having to re-subscribe when the query client changes.
    const refreshLibrary = useLbBotLibraryRefresh();
    const libraryRefresh = useRef(refreshLibrary);
    libraryRefresh.current = refreshLibrary;

    // Stream URLs embed the server origin and per-server credentials, so a server (or
    // credential) switch invalidates every memoized entry — otherwise the cast bridge
    // keeps being handed URLs signed for the previous server.
    useEffect(() => {
        streamUrlCache.current.clear();
    }, [serverId]);

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
                noteActive(msg.session?.activeDeviceId ?? null);
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
                    savedQueueId: msg.session?.savedQueueId ?? null,
                });
                reconcileRemoteActive();
                // Reconcile saved-queue history. Capture our LOCAL (possibly offline-
                // accumulated) rows FIRST, then adopt the hub's authoritative list (a
                // replace), then push the local rows up — the hub union-merges them and
                // rebroadcasts the complete list, so nothing offline is lost.
                {
                    const sqActions = useSavedQueuesStore.getState().actions;
                    const sid = serverIdRef.current;
                    const local = useSavedQueuesStore.getState().queues;
                    sqActions.mergeFromHub(
                        (msg.savedQueues ?? []).map((r: any) => mapHubSavedQueue(r, sid)),
                    );
                    if (local.length) {
                        hub.send({
                            action: 'syncSavedQueues',
                            queues: local.map(savedQueueToHubRecord),
                            t: 'act',
                        });
                    }
                }
                // Hub is authoritative: adopt its session rather than pushing ours.
                void adoptIfNoLiveReceiver(msg.session);
            } else if (msg.t === 'session') {
                noteActive(msg.activeDeviceId ?? null);
                setStore({
                    activeDeviceId: activeId.current,
                    remoteIsPlaying: msg.isPlaying ?? false,
                    remotePositionAt: Date.now(),
                    remotePositionMs: msg.positionMs ?? 0,
                    remoteQueue: msg.queue ?? [],
                    remoteQueueIndex: msg.index ?? 0,
                    remoteRepeat: msg.repeat ?? 'none',
                    remoteShuffle: msg.shuffle ?? false,
                    savedQueueId: msg.savedQueueId ?? null,
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
            } else if (msg.t === 'savedQueues') {
                // The hub's authoritative saved-queue history changed — reconcile it in.
                useSavedQueuesStore
                    .getState()
                    .actions.mergeFromHub(
                        (msg.queues ?? []).map((r: any) =>
                            mapHubSavedQueue(r, serverIdRef.current),
                        ),
                    );
            } else if (msg.t === 'library') {
                // lb-bot placed an album somewhere on the network. Whichever
                // device did the asking, every device's idea of what the library
                // holds — and of what lb-bot still calls missing — is now stale.
                libraryRefresh.current();
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
                // savedQueueId is deliberately KEPT: we're still listening to the same
                // thing, so a reconnect must refresh that record rather than fork a
                // near-duplicate of the queue we never stopped playing.
                setStore({ activeDeviceId: null, connected: false, savedQueueId: null });
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

    // Deleting the history record we're publishing into restarts the session, so the queue
    // still playing gets a fresh card instead of disappearing from Continue Listening.
    useEffect(() => {
        return onQueueSessionReset(() => {
            savedQueueId.current = null;
            savedQueueCoverSong.current = null;
            savedQueuePrevIds.current = [];
            lastQueueSig.current = '';
            publishQueue();
        });
    }, [publishQueue]);

    // Publish on queue-MEMBERSHIP changes too, not just song/status changes.
    // Auto DJ (and any enqueue) appends to the tail without moving the current
    // song or flipping play-state — the two events below drive publishQueue. So
    // without this, a top-up never reaches the hub until the track advances, and
    // a transfer taken mid-track hands the next device a stale (pre-top-up)
    // queue. publishQueue itself is idempotent (dedupes by signature) and gated
    // (hubDrivenUntil / active-or-none), so this can't echo hub-driven loads.
    useEffect(() => {
        if (!hub) return undefined;
        return usePlayerStoreBase.subscribe(
            (state) =>
                state
                    .getQueue()
                    .items.map((item) => item.id)
                    .join(','),
            () => publishQueue(),
        );
    }, [publishQueue]);

    // Feed the refs from player events; publish queue changes + report when active.
    usePlayerEvents(
        {
            onCurrentSongChange: (properties) => {
                index.current = properties.index;
                const pending = pendingSeek.current;
                if (pending && Date.now() - pending.armedAt > PENDING_SEEK_TTL) {
                    // Its target track never became current (superseded load, queue
                    // changed under us) — drop it before it ambushes an unrelated song.
                    pendingSeek.current = null;
                } else if (pending && properties.index === pending.index) {
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
                            // hardPause, not mediaPause: by now the store is back at
                            // PAUSED, which makes a plain pause a no-op against the
                            // playback that won the race.
                            setTimeout(() => hardPause(), 100);
                        }
                    }, 150);
                }
                routeLocalPlayToRemote();
                publishQueue();
                // A track change starts the new song at 0, but positionMs.current still
                // holds the OUTGOING track's offset (onPlayerProgress hasn't ticked for
                // the new one yet). Reporting that pair parks the hub's cursor minutes
                // into a song that just started, which then reads as drift everywhere
                // that compares against it.
                // ...but NOT when a hub-driven load is positioning us (a pending seek, or
                // inside the hub-driven window) — there the hub's own offset is the truth
                // and reporting 0 would rewind the session it just handed us.
                if (!pendingSeek.current && Date.now() >= hubDrivenUntil.current) {
                    positionMs.current = 0;
                }
                report({ index: properties.index, positionMs: positionMs.current });
            },
            onPlayerProgress: (properties, prev) => {
                positionMs.current = Math.round(properties.timestamp * 1000);
                // Feed the engine-clock ground truth the watchdogs read — see audioIsRolling.
                const delta = properties.timestamp - prev.timestamp;
                if (delta > 0 && delta < 2) {
                    if (!advancingSince.current) advancingSince.current = Date.now();
                } else {
                    advancingSince.current = 0;
                }
                const rolling = audioIsRolling();
                // Watchdog: while another device is the active receiver, the
                // local engine must stay silent. Startup auto-resume can begin
                // (and keep) playing past the one-shot reconcile, so re-pause any
                // local playback that's still progressing. Fires only while local
                // audio actually advances, so it self-stops once truly paused.
                if (isRemoteActiveNow() && rolling && Date.now() >= hubDrivenUntil.current) {
                    hardPause();
                    return;
                }
                // Just adopted an orphaned session (no active device) as PAUSED: an
                // in-flight auto-resume can start the engine right after and leave audio
                // running under a bar that reads "paused". Short window only — outside it
                // a local play with no active device is the user legitimately claiming
                // the session, and pausing that would fight them.
                if (
                    activeId.current === null &&
                    rolling &&
                    Date.now() < adoptPauseGuardUntil.current
                ) {
                    hardPause();
                    return;
                }
                // Last net, and the only one that doesn't care what the hub is doing:
                // audio is advancing while the store insists it isn't. That is never
                // something the user asked for — they'd be looking at a paused bar — so
                // there's no intent here to fight. Silence it whether or not a hub session
                // is in play; this is what makes the state recoverable without a restart.
                if (!playing.current && rolling) {
                    hardPause();
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
        [hardPause, mediaPause, mediaSeekToTimestamp, publishQueue, report, routeLocalPlayToRemote],
    );
};

export const HubHook = () => {
    useHub();
    return null;
};
