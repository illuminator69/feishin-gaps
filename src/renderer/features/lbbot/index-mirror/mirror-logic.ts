import type {
    LbBotDiscography,
    LbBotIndexArtist,
    LbBotIndexEnvelope,
    LbBotIndexItem,
} from '/@/shared/types/lbbot-types';

/**
 * The rules of lb-bot's index mirror, as pure functions.
 *
 * PLAN-lbbot-index-mirror-2026-09-23, contract §1a "Client mirror rules". Kept
 * apart from the store (`index-mirror.ts`) so the parts that decide what a page
 * does, what drift means and which artist a Navidrome id resolves to can be read
 * and reviewed without IndexedDB, IPC or React in the way. Nothing here touches
 * state; every function answers a question about the values it is handed.
 *
 * Feishin has no test runner, so nothing exercises these at runtime except the
 * app itself. Navic implements the same rules in Kotlin; the contract, not
 * either implementation, is the reference.
 */

/** What the mirror remembers about the index as a whole. */
export interface MirrorMeta {
    /** The highest seq this mirror has applied a page up to. */
    cursor: number;
    /** lb-bot's index epoch this mirror was built under; empty before the first pull. */
    epoch: string;
    scanVersion: number;
    ttlDays: number;
}

export const EMPTY_MIRROR_META: MirrorMeta = { cursor: 0, epoch: '', scanVersion: 0, ttlDays: 0 };

/** The writes one change-feed page makes, computed before any of them happen. */
export interface PageDelta {
    deletes: string[];
    puts: LbBotIndexArtist[];
}

/**
 * Decide what one page does to the mirror.
 *
 * **Artist-level replace, gated on seq.** An artist is taken whole — every row at
 * once — and only when its seq is greater than the one held for that key, which
 * makes a duplicate or an out-of-order delivery a no-op rather than a regression.
 * A tombstone deletes the key only when its seq is greater than the held one: a
 * lower one means the key was re-created after the delete, and the artist
 * already on hand is the newer fact.
 *
 * Items are walked in order against a working overlay, so the answer is right
 * even if one page carries the same key twice.
 */
export const planPage = (
    localSeq: (key: string) => number | undefined,
    items: LbBotIndexItem[],
): PageDelta => {
    const working = new Map<string, null | number>();
    const puts = new Map<string, LbBotIndexArtist>();
    const deletes = new Set<string>();
    const current = (key: string): number | undefined => {
        if (working.has(key)) return working.get(key) ?? undefined;
        return localSeq(key);
    };
    for (const item of items) {
        const held = current(item.key);
        if (item.type === 'artist') {
            if (held !== undefined && item.seq <= held) continue;
            // The stored record is the artist without its feed discriminator,
            // spelled out so a field added to the wire item is a decision here
            // rather than something that silently lands in IndexedDB.
            puts.set(item.key, {
                key: item.key,
                mbid: item.mbid,
                name: item.name,
                ndArtistId: item.ndArtistId,
                rows: item.rows,
                scannedAt: item.scannedAt,
                scanVersion: item.scanVersion,
                seq: item.seq,
            });
            deletes.delete(item.key);
            working.set(item.key, item.seq);
        } else {
            if (held === undefined || item.seq <= held) continue;
            puts.delete(item.key);
            deletes.add(item.key);
            working.set(item.key, null);
        }
    }
    return { deletes: [...deletes], puts: [...puts.values()] };
};

/** The mirror's side of the drift check: what the final page's `artistCount`
 *  and `seqSum` are compared against. */
export const mirrorTotals = (
    artists: Iterable<LbBotIndexArtist>,
): { artistCount: number; seqSum: number } => {
    let artistCount = 0;
    let seqSum = 0;
    for (const artist of artists) {
        artistCount += 1;
        seqSum += artist.seq;
    }
    return { artistCount, seqSum };
};

export interface DriftPlan {
    /** Local keys to drop: the server no longer has them, or holds them at a
     *  LOWER seq than we do — an impossible state that would otherwise block the
     *  refetch below forever, since an artist only applies over a lower seq. */
    deletes: string[];
    /** Where to pull from again: one below the lowest server seq among the keys
     *  we are missing or hold at a different seq. Null when nothing differs. */
    rewindTo: null | number;
}

/**
 * Reconcile the mirror against `/lb/index/keys` after a count/sum mismatch.
 *
 * There is no per-key fetch route (Ruling R6), so "re-fetch only the differing
 * artists" becomes "pull again from just below the oldest one that differs". The
 * seq gate in `planPage` then skips every artist the mirror already holds at the
 * same seq, so the second pull re-applies exactly the ones that were wrong. This
 * never wipes: only a `resync` answer does.
 */
export const planDrift = (
    local: ReadonlyMap<string, number>,
    server: { key: string; seq: number }[],
): DriftPlan => {
    const serverSeq = new Map(server.map((entry) => [entry.key, entry.seq]));
    const deletes: string[] = [];
    for (const [key, seq] of local) {
        const theirs = serverSeq.get(key);
        if (theirs === undefined || seq > theirs) deletes.push(key);
    }
    let lowest: null | number = null;
    for (const { key, seq } of server) {
        if (local.get(key) === seq) continue;
        if (lowest === null || seq < lowest) lowest = seq;
    }
    return { deletes, rewindTo: lowest === null ? null : Math.max(0, lowest - 1) };
};

/** The Navidrome artist ids one mirrored artist answers to: its `ndArtistId`,
 *  and the id inside an `nd:` key. Empty ids are never indexed — lb-bot's own
 *  lookup refuses an empty id, and matching one would pair every artist lb-bot
 *  holds no Navidrome id for with the first page that asks with none. */
export const ndIdsOf = (artist: LbBotIndexArtist): string[] => {
    const ids = new Set<string>();
    if (artist.ndArtistId) ids.add(artist.ndArtistId);
    if (artist.key.startsWith('nd:') && artist.key.length > 3) ids.add(artist.key.slice(3));
    return [...ids];
};

/**
 * SQLite's `ORDER BY scanned_at DESC, artist_key` — the newest scan first, then
 * the key in BINARY collation.
 *
 * Deliberately `<`/`>`, never `localeCompare`: lb-bot compares keys as bytes,
 * and a locale-aware compare can order two keys differently, which during the
 * brief two-rows state of an `nd:` → MBID swap would resolve the same page to a
 * different artist here than on the server and on Navic. (UTF-16 order equals
 * UTF-8 byte order for everything but astral characters; keys are MBIDs and
 * `nd:` ids, which are ASCII.)
 */
const byServerOrder = (a: LbBotIndexArtist, b: LbBotIndexArtist): number => {
    if (a.scannedAt !== b.scannedAt) return b.scannedAt - a.scannedAt;
    if (a.key < b.key) return -1;
    return a.key > b.key ? 1 : 0;
};

/**
 * Which mirrored artist a page for Navidrome artist `ndId` shows — exactly
 * lb-bot's `_index_get_artist`: the MBID key first when the caller has an MBID;
 * otherwise (or when that key is absent) `artist_key == 'nd:'+id OR
 * nd_artist_id == id`, newest scan first, then key.
 */
export const lookupByNdId = (
    byKey: ReadonlyMap<string, LbBotIndexArtist>,
    keysByNdId: ReadonlyMap<string, ReadonlySet<string>>,
    ndId: string,
    mbid?: null | string,
): LbBotIndexArtist | undefined => {
    if (mbid) {
        const direct = byKey.get(mbid);
        if (direct) return direct;
    }
    if (!ndId) return undefined;
    let best: LbBotIndexArtist | undefined;
    for (const key of keysByNdId.get(ndId) ?? []) {
        const candidate = byKey.get(key);
        if (candidate && (!best || byServerOrder(candidate, best) < 0)) best = candidate;
    }
    return best;
};

/**
 * Whether an artist's stored discography is due a rescan — computed here rather
 * than shipped, so it cannot drift while nothing writes: older than lb-bot's TTL,
 * or built by a different scan version than lb-bot runs now.
 */
export const isArtistStale = (
    artist: Pick<LbBotIndexArtist, 'scannedAt' | 'scanVersion'>,
    envelope: Pick<LbBotIndexEnvelope, 'scanVersion' | 'ttlDays'>,
    nowSeconds: number,
): boolean =>
    nowSeconds - artist.scannedAt > envelope.ttlDays * 86400 ||
    artist.scanVersion !== envelope.scanVersion;

/**
 * A mirrored artist in the network discography read's shape, so a consumer can
 * take either without caring which answered. `scan` is null: the mirror holds
 * the index, not lb-bot's in-memory record of the last scan task, which only the
 * network read carries.
 */
export const toDiscography = (
    artist: LbBotIndexArtist,
    envelope: Pick<LbBotIndexEnvelope, 'scanVersion' | 'ttlDays'>,
    nowSeconds: number,
): LbBotDiscography => ({
    artistName: artist.name,
    indexed: true,
    releases: artist.rows,
    scan: null,
    scannedAt: artist.scannedAt,
    stale: isArtistStale(artist, envelope, nowSeconds),
});
