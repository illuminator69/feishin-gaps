import type { LbBotDiscography, LbBotIndexArtist, LbBotStatus } from '/@/shared/types/lbbot-types';

import { clear, createStore, entries, promisifyRequest, UseStore } from 'idb-keyval';
import isElectron from 'is-electron';
import { useEffect, useSyncExternalStore } from 'react';

import {
    EMPTY_MIRROR_META,
    isArtistStale,
    lookupByNdId,
    MirrorMeta,
    mirrorTotals,
    ndIdsOf,
    PageDelta,
    planDrift,
    planPage,
    toDiscography,
} from '/@/renderer/features/lbbot/index-mirror/mirror-logic';
import { queryClient } from '/@/renderer/lib/react-query';
import { useHubStore } from '/@/renderer/store/hub.store';

/**
 * A local copy of lb-bot's library index, kept current through the hub.
 *
 * PLAN-lbbot-index-mirror-2026-09-23 §5. lb-bot is the only writer of the index;
 * this mirror changes only when a page of its change feed says so, never from a
 * user action — anything optimistic (a fill in flight) stays in the fill ledger,
 * which this file does not touch.
 *
 * - **Storage.** A dedicated IndexedDB database (`lbbot-index`), apart from the
 *   react-query persister's default `idb-keyval` store: one record per artist,
 *   keyed by lb-bot's `artist_key`, plus one `$meta` record holding the cursor,
 *   the epoch and the envelope's `scanVersion`/`ttlDays`. A page is written in ONE
 *   IndexedDB transaction together with its cursor, so a crash mid-sync leaves
 *   either the whole page and its cursor or neither — never an artist half
 *   replaced, and never a cursor past rows that were not written.
 * - **Memory.** Loaded once into a Map keyed by artist key, with a second index
 *   by Navidrome artist id, so a lookup is synchronous and a page can render its
 *   missing albums in the same pass as Navidrome's own data.
 * - **Sync.** Triggered by every hub `welcome`, every `index` frame and a 15-min
 *   interval (all wired in `use-hub.tsx`); one sync in flight, a trigger during
 *   one queues exactly one more. The rules — seq-gated artist replace, resync,
 *   drift — are the pure functions in `mirror-logic.ts`.
 */

const lbBot = isElectron() ? window.api.lbBot : null;

/** Bump when the stored record shape changes; a mismatched store is discarded
 *  and pulled again from 0, which costs one full sync and nothing else. */
const MIRROR_SCHEMA = 1;
/** Artist keys are MBIDs or `nd:<id>`; neither can begin with `$`. */
const META_KEY = '$meta';

/** The advertised-route string a hub serving the feed lists (`/lb/status`,
 *  `welcome.lb.routes`). */
export const INDEX_CHANGES_ROUTE = 'GET /lb/index/changes';

/** The backstop, for a notify missed while the hub or this app was away. */
const PERIODIC_SYNC_MS = 15 * 60 * 1000;

/** Back-off after a transient failure. After the last step the sync stops
 *  retrying and waits for the next trigger — at worst the 15-min interval. */
const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 5 * 60_000];
/** "Busy" (the hub's one-slot sync pool is taken), "unreachable", "timed out",
 *  and a request that never left this process. Anything else is an answer. */
const RETRYABLE_STATUSES = new Set([0, 502, 503, 504]);

/** A resync is answered by pulling from 0 under the new epoch; one that answers
 *  resync again at once means something is wrong upstream, not here. */
const MAX_RESYNCS_PER_SYNC = 2;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const byKey = new Map<string, LbBotIndexArtist>();
const keysByNdId = new Map<string, Set<string>>();
let meta: MirrorMeta = EMPTY_MIRROR_META;
let loaded = false;

export interface IndexMirrorSnapshot {
    /** Number of artists mirrored. */
    artistCount: number;
    /** False until the stored mirror has been read into memory. A lookup that
     *  misses before then means "not read yet", not "not indexed". */
    loaded: boolean;
    meta: MirrorMeta;
    /** Moves on every change that could alter a lookup. */
    version: number;
}

let snapshot: IndexMirrorSnapshot = { artistCount: 0, loaded, meta, version: 0 };
const listeners = new Set<() => void>();

const notify = () => {
    snapshot = { artistCount: byKey.size, loaded, meta, version: snapshot.version + 1 };
    for (const listener of listeners) listener();
};

const indexNdIds = (artist: LbBotIndexArtist) => {
    for (const id of ndIdsOf(artist)) {
        const keys = keysByNdId.get(id) ?? new Set<string>();
        keys.add(artist.key);
        keysByNdId.set(id, keys);
    }
};

const unindexNdIds = (artist: LbBotIndexArtist) => {
    for (const id of ndIdsOf(artist)) {
        const keys = keysByNdId.get(id);
        if (!keys) continue;
        keys.delete(artist.key);
        if (keys.size === 0) keysByNdId.delete(id);
    }
};

const putInMemory = (artist: LbBotIndexArtist) => {
    const previous = byKey.get(artist.key);
    if (previous) unindexNdIds(previous);
    byKey.set(artist.key, artist);
    indexNdIds(artist);
};

const deleteInMemory = (key: string) => {
    const previous = byKey.get(key);
    if (!previous) return;
    unindexNdIds(previous);
    byKey.delete(key);
};

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

let idb: null | UseStore = null;
// Opened on first use rather than at import, so a build that never touches
// lb-bot (the web build, no hub) never creates the database.
const store = (): UseStore => (idb ??= createStore('lbbot-index', 'mirror'));

interface StoredMeta extends MirrorMeta {
    schema: number;
}

const isStoredMeta = (value: unknown): value is StoredMeta => {
    const v = value as Partial<StoredMeta> | undefined;
    return (
        !!v &&
        v.schema === MIRROR_SCHEMA &&
        typeof v.cursor === 'number' &&
        typeof v.epoch === 'string' &&
        typeof v.scanVersion === 'number' &&
        typeof v.ttlDays === 'number'
    );
};

const isStoredArtist = (value: unknown): value is LbBotIndexArtist => {
    const v = value as Partial<LbBotIndexArtist> | undefined;
    return !!v && typeof v.key === 'string' && typeof v.seq === 'number' && Array.isArray(v.rows);
};

let loading: null | Promise<void> = null;

/**
 * Read the stored mirror into memory, once. Every entry point awaits it, so a
 * sync can never start from an empty in-memory copy of a full store (which would
 * re-pull everything and, worse, compare its drift totals against nothing).
 *
 * A read failure leaves an empty mirror marked loaded: the next sync then pulls
 * from 0 and overwrites whatever the store held, and the drift check removes
 * anything the server no longer has.
 */
export const loadIndexMirror = (): Promise<void> => {
    loading ??= (async () => {
        // No Electron bridge (the web build): there is nothing to sync from, so
        // do not create a database just to report it empty.
        if (!lbBot) {
            loaded = true;
            notify();
            return;
        }
        try {
            const rows = await entries<IDBValidKey, unknown>(store());
            const storedMeta = rows.find(([key]) => key === META_KEY)?.[1];
            if (isStoredMeta(storedMeta)) {
                meta = {
                    cursor: storedMeta.cursor,
                    epoch: storedMeta.epoch,
                    scanVersion: storedMeta.scanVersion,
                    ttlDays: storedMeta.ttlDays,
                };
                for (const [key, value] of rows) {
                    if (key !== META_KEY && isStoredArtist(value)) putInMemory(value);
                }
            } else if (rows.length > 0) {
                // Written by another schema, or artists with no meta to say
                // which epoch they belong to. Neither can be trusted; start over.
                await clear(store());
            }
        } catch (error) {
            console.error('[lbbot-index] could not read the stored mirror', error);
        }
        loaded = true;
        notify();
    })();
    return loading;
};

/**
 * Write one page's delta and the new meta in a single IndexedDB transaction,
 * then — only once it has committed — apply the same to memory. Memory never
 * runs ahead of disk, so a failed write leaves both where they were and the
 * cursor unmoved.
 */
const commit = async (delta: PageDelta, next: MirrorMeta, wipe = false): Promise<void> => {
    await store()('readwrite', (os) => {
        if (wipe) os.clear();
        for (const artist of delta.puts) os.put(artist, artist.key);
        for (const key of delta.deletes) os.delete(key);
        const stored: StoredMeta = { ...next, schema: MIRROR_SCHEMA };
        os.put(stored, META_KEY);
        return promisifyRequest(os.transaction);
    });
    const envelopeChanged =
        next.epoch !== meta.epoch ||
        next.scanVersion !== meta.scanVersion ||
        next.ttlDays !== meta.ttlDays;
    if (wipe) {
        byKey.clear();
        keysByNdId.clear();
    }
    for (const artist of delta.puts) putInMemory(artist);
    for (const key of delta.deletes) deleteInMemory(key);
    meta = next;
    // The cursor alone moving changes nothing anyone renders.
    if (wipe || envelopeChanged || delta.puts.length > 0 || delta.deletes.length > 0) notify();
};

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export type IndexSyncTrigger = 'index' | 'interval' | 'retry' | 'welcome';

let running: null | Promise<void> = null;
let queued: IndexSyncTrigger | null = null;
let retryTimer: number | undefined;
let retryAttempt = 0;
/** The hub answered 404: it is older than the feed. Cleared on the next
 *  `welcome`, which is the only way a hub gets newer. */
let feedMissing = false;

/** The routes the hub advertises: `welcome.lb` when this hub sends it, else the
 *  `/lb/status` probe's answer for an older one. */
const advertisedRoutes = (): string[] | undefined =>
    useHubStore.getState().lbStatus?.routes ??
    queryClient.getQueryData<LbBotStatus>(['lbbot', 'status'])?.routes;

/** An empty or unknown list is an older hub that does not advertise: try, and
 *  let a 404 answer the question. Matches `useHubSupports`. */
const feedAdvertised = (): boolean => {
    const routes = advertisedRoutes();
    return !routes || routes.length === 0 || routes.includes(INDEX_CHANGES_ROUTE);
};

const scheduleRetry = (status: number) => {
    if (status === 404) {
        feedMissing = true;
        return;
    }
    // Not when the hub itself said lb-bot is down (or unconfigured): every retry
    // would fail the same way and log it. lb-bot announces itself when it comes
    // up — its index push at boot reaches this client as an `index` frame — and
    // the next welcome and the 15-min interval still pull.
    const hubSaysDown = useHubStore.getState().lbStatus?.available === false;
    if (hubSaysDown || !RETRYABLE_STATUSES.has(status) || retryAttempt >= RETRY_DELAYS_MS.length) {
        retryAttempt = 0;
        return;
    }
    // Jittered, so two clients bounced off the same busy slot do not come back
    // in lockstep and collide again.
    const delay = RETRY_DELAYS_MS[retryAttempt] * (0.75 + Math.random() * 0.5);
    retryAttempt += 1;
    retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        requestIndexSync('retry');
    }, delay);
};

/**
 * A pull that succeeded proves lb-bot is up, whatever `welcome.lb` said when
 * this socket connected — the hub only states availability at connect, and a
 * hub that had just restarted may not have probed lb-bot yet.
 */
const markReachable = () => {
    const { actions, lbStatus } = useHubStore.getState();
    if (lbStatus && !lbStatus.available) {
        actions.setStore({ lbStatus: { ...lbStatus, available: true } });
    }
};

/**
 * One sync: pull pages until `more` is false, then check drift once.
 * Returns the HTTP status that stopped it, or null on success.
 */
const pull = async (): Promise<null | number> => {
    if (!lbBot) return null;
    let resyncs = 0;
    let driftChecked = false;
    for (;;) {
        const since = meta.cursor;
        const result = await lbBot.indexChanges(since, meta.epoch);
        if (!result.ok || !result.data) return result.status;
        const page = result.data;

        // `resync`, or a normal answer under an epoch that is not ours (which
        // lb-bot would itself have answered with resync, so this is defence
        // only): the only case that wipes. Adopt the new epoch, cursor 0, and
        // pull everything again.
        if (page.resync || (meta.epoch && page.epoch !== meta.epoch)) {
            resyncs += 1;
            if (resyncs > MAX_RESYNCS_PER_SYNC) {
                console.warn(
                    '[lbbot-index] lb-bot keeps answering resync; giving up until the next trigger',
                );
                return null;
            }
            await commit(
                { deletes: [], puts: [] },
                {
                    cursor: 0,
                    epoch: page.epoch,
                    scanVersion: page.scanVersion,
                    ttlDays: page.ttlDays,
                },
                true,
            );
            continue;
        }

        await commit(
            planPage((key) => byKey.get(key)?.seq, page.items),
            {
                cursor: Math.max(meta.cursor, page.nextSince),
                epoch: page.epoch,
                scanVersion: page.scanVersion,
                ttlDays: page.ttlDays,
            },
        );

        if (page.more) {
            // `more` with a nextSince that did not move would loop forever.
            if (page.nextSince <= since) {
                console.warn('[lbbot-index] a page said "more" without advancing; stopping');
                return null;
            }
            continue;
        }

        // Drift check, against the FINAL page's snapshot — never an earlier
        // page's, which a running bulk build would have moved past and turned
        // into a resync loop.
        const totals = mirrorTotals(byKey.values());
        if (totals.artistCount === page.artistCount && totals.seqSum === page.seqSum) return null;
        if (driftChecked) {
            console.warn(
                `[lbbot-index] still differs after one reconcile (local ${totals.artistCount}/${totals.seqSum}, lb-bot ${page.artistCount}/${page.seqSum}); the next sync will try again`,
            );
            return null;
        }
        driftChecked = true;

        const keys = await lbBot.indexKeys();
        if (!keys.ok || !keys.data) return keys.status;
        // A different epoch: the next changes read answers resync; loop to it.
        if (keys.data.epoch !== meta.epoch) continue;

        const local = new Map<string, number>();
        for (const [key, artist] of byKey) local.set(key, artist.seq);
        const plan = planDrift(local, keys.data.keys);
        await commit(
            { deletes: plan.deletes, puts: [] },
            {
                ...meta,
                // Only ever rewound: a differing key above the cursor is already
                // on its way through the normal pull.
                cursor: plan.rewindTo === null ? meta.cursor : Math.min(meta.cursor, plan.rewindTo),
            },
        );
        if (plan.rewindTo === null) return null;
    }
};

const runSync = async (): Promise<void> => {
    await loadIndexMirror();
    if (!lbBot || !useHubStore.getState().connected || feedMissing || !feedAdvertised()) return;
    let status: null | number;
    try {
        status = await pull();
    } catch (error) {
        // An IPC rejection or an IndexedDB write failure. Nothing was applied
        // past the last committed page, so this is a retry, not a repair.
        console.error('[lbbot-index] sync failed', error);
        status = 0;
    }
    if (status === null) {
        retryAttempt = 0;
        markReachable();
    } else {
        scheduleRetry(status);
    }
};

/**
 * Ask for a sync. Cheap to call often: one runs at a time, and a trigger that
 * arrives during one queues a single follow-up rather than a pile.
 *
 * While backing off after a failure, only a `welcome` jumps the queue — a new
 * socket is new information about the hub, where an `index` frame arriving
 * every two seconds during a bulk build is not a reason to hammer a hub that
 * just answered "busy". The pending retry will pull everything those frames
 * announced.
 */
export const requestIndexSync = (trigger: IndexSyncTrigger): void => {
    if (!lbBot) return;
    if (trigger === 'welcome') {
        feedMissing = false;
        retryAttempt = 0;
        if (retryTimer !== undefined) {
            window.clearTimeout(retryTimer);
            retryTimer = undefined;
        }
    } else if (trigger !== 'retry' && retryTimer !== undefined) {
        return;
    }
    if (running) {
        // A welcome outranks whatever was queued, since it resets the back-off.
        if (queued !== 'welcome') queued = trigger;
        return;
    }
    running = runSync().finally(() => {
        running = null;
        const next = queued;
        queued = null;
        if (next) requestIndexSync(next);
    });
};

/**
 * The hub's `{t: "index", seq, epoch}` frame: lb-bot's head moved.
 *
 * It is a hint to pull, and one this mirror may already have acted on — a page
 * that committed up to `seq` under the same epoch has everything the frame
 * announces, so that case is skipped. Anything else pulls. It is also proof
 * lb-bot is alive, which the connect-time `welcome.lb` cannot be.
 */
export const onIndexFrame = (seq: number, epoch: string): void => {
    markReachable();
    if (loaded && epoch === meta.epoch && seq <= meta.cursor) return;
    requestIndexSync('index');
};

/** Mount once (from `useHub`): reads the stored mirror at startup and runs the
 *  15-minute backstop sync. */
export const useLbBotIndexSync = (): void => {
    useEffect(() => {
        if (!lbBot) return undefined;
        void loadIndexMirror();
        const timer = window.setInterval(() => requestIndexSync('interval'), PERIODIC_SYNC_MS);
        return () => window.clearInterval(timer);
    }, []);
};

// ---------------------------------------------------------------------------
// Reading the mirror — the API artist and `mb:` pages consume
// ---------------------------------------------------------------------------

/** Called on every change that could alter a lookup. Subscribing starts the
 *  load if nothing has yet. */
export const subscribeIndexMirror = (listener: () => void): (() => void) => {
    listeners.add(listener);
    void loadIndexMirror();
    return () => {
        listeners.delete(listener);
    };
};

export const getIndexMirrorSnapshot = (): IndexMirrorSnapshot => snapshot;

/** Synchronous lookup by Navidrome artist id, in lb-bot's own order (see
 *  `lookupByNdId`). Pass the artist's MBID when the page has one. */
export const getMirrorArtistByNdId = (
    ndId: string,
    mbid?: null | string,
): LbBotIndexArtist | undefined => lookupByNdId(byKey, keysByNdId, ndId, mbid);

/** Synchronous lookup by lb-bot artist key — an MBID for the `mb:` pages. */
export const getMirrorArtist = (key: string): LbBotIndexArtist | undefined => byKey.get(key);

/** Whether a mirrored artist is due a rescan, against the envelope the mirror
 *  last saw. */
export const isMirrorArtistStale = (artist: LbBotIndexArtist, nowMs = Date.now()): boolean =>
    isArtistStale(artist, meta, nowMs / 1000);

/** A mirrored artist in the network discography read's shape (`scan: null`),
 *  with `stale` computed against the envelope the mirror last saw. */
export const mirrorDiscography = (artist: LbBotIndexArtist, nowMs = Date.now()): LbBotDiscography =>
    toDiscography(artist, meta, nowMs / 1000);

/** The mirror's state as a whole; re-renders on every change. */
export const useIndexMirror = (): IndexMirrorSnapshot =>
    useSyncExternalStore(subscribeIndexMirror, getIndexMirrorSnapshot);

/**
 * The mirrored artist a Navidrome artist page shows, re-rendering only when that
 * answer changes (a stored artist object is replaced, never mutated, so identity
 * is the change signal). Undefined while the mirror loads and for an artist
 * lb-bot has not indexed — check `useIndexMirror().loaded` to tell them apart.
 */
export const useMirrorArtistByNdId = (
    ndId: string,
    mbid?: null | string,
): LbBotIndexArtist | undefined =>
    useSyncExternalStore(subscribeIndexMirror, () => getMirrorArtistByNdId(ndId, mbid));

/** The same, by artist key (an MBID on the `mb:` pages). */
export const useMirrorArtist = (key: string): LbBotIndexArtist | undefined =>
    useSyncExternalStore(subscribeIndexMirror, () => (key ? byKey.get(key) : undefined));
