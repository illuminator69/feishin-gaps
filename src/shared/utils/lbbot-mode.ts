/**
 * lb-bot's downloads mode and index progress, as the hub relays them (Worbus P1).
 *
 * Pure and import-free (tested by `lbbot-mode.harness.ts`). The rules are Navic's (lane N
 * ruling 3), adopted for Feishin:
 *
 * - `welcome.lb.downloads` is `"on"` or `"off"`; absent means an older hub or lb-bot, read as
 *   `unknown`, which behaves exactly as today (downloads shown, no P1-only offers).
 * - Every `welcome` restates the mode. An `lb` frame or a `/lb/status` read without the key
 *   keeps the current one, so an "off" a 409 taught holds until the hub says otherwise.
 * - A 409 `downloads_off` from any route sets off.
 * - The last known `on`/`off` per hub URL is remembered (at most four hubs; unknown never) and
 *   is the cold start's mode until the first welcome.
 */

export type LbDownloads = 'off' | 'on';

/** The index build's countdown (`welcome.lbIndex.progress`, `t:"index"`.progress). */
export interface LbIndexProgress {
    /** The artist lb-bot is reading now, "" when it says none. At most 200 characters. */
    current: string;
    total: number;
    /** Artists lb-bot will still attempt that have no index row yet. */
    unindexed: number;
}

/** `unknown` = an older peer that does not report the mode: behave as today. */
export type LbMode = 'unknown' | LbDownloads;

const asRecord = (value: unknown): null | Record<string, unknown> =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const downloadsOf = (value: unknown): LbDownloads | null => {
    const downloads = asRecord(value)?.downloads;
    return downloads === 'on' || downloads === 'off' ? downloads : null;
};

/** A welcome states the whole mode: no (valid) key is an older peer. */
export const modeFromWelcome = (lb: unknown): LbMode => downloadsOf(lb) ?? 'unknown';

/** An `lb` frame or a `/lb/status` read: only a valid key moves the mode. */
export const modeFromFrame = (current: LbMode, frame: unknown): LbMode =>
    downloadsOf(frame) ?? current;

/** A refusal from any route: `downloads_off` means off, whatever was believed. */
export const modeAfterRefusal = (current: LbMode, code: string | undefined): LbMode =>
    code === 'downloads_off' ? 'off' : current;

/** Whether download actions are offered: everywhere except a known "off". */
export const downloadsShown = (mode: LbMode): boolean => mode !== 'off';

/** A peer that reported the mode at all, i.e. lb-bot and hub from Worbus P1 on. */
export const isP1Peer = (mode: LbMode): boolean => mode !== 'unknown';

/** How many hubs' last mode is remembered. */
export const REMEMBERED_HUBS = 4;

/**
 * Remember `mode` as the last word of the hub at `hubUrl`. Unknown is never stored (it would
 * overwrite a real answer with "don't know"); the oldest hub is dropped past four.
 */
export const rememberMode = (
    map: Record<string, LbDownloads>,
    order: string[],
    hubUrl: string,
    mode: LbMode,
): { map: Record<string, LbDownloads>; order: string[] } => {
    if (mode === 'unknown' || !hubUrl) return { map, order };
    const nextOrder = [...order.filter((url) => url !== hubUrl), hubUrl];
    const dropped = nextOrder.splice(0, Math.max(0, nextOrder.length - REMEMBERED_HUBS));
    const nextMap: Record<string, LbDownloads> = { ...map, [hubUrl]: mode };
    for (const url of dropped) delete nextMap[url];
    return { map: nextMap, order: nextOrder };
};

const count = (value: unknown): null | number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

/** `progress` off the wire, or null for anything that is not one (and for its absence). */
export const parseProgress = (raw: unknown): LbIndexProgress | null => {
    const record = asRecord(raw);
    if (!record) return null;
    const unindexed = count(record.unindexed);
    const total = count(record.total);
    if (unindexed === null || total === null) return null;
    const current = record.current;
    if (current !== undefined && current !== null && typeof current !== 'string') return null;
    return { current: (current ?? '').slice(0, 200), total, unindexed };
};

/**
 * An `index` frame that moved nothing but the progress: the same epoch as the mirror's and a
 * seq it has already pulled. Such a frame updates the bar only (Navic ruling 9). Without a
 * mirror cursor every frame is a reason to pull.
 */
export const isProgressOnlyFrame = (
    frame: { epoch: string; seq: number },
    cursor: null | { epoch: string; seq: number },
): boolean => cursor !== null && frame.epoch === cursor.epoch && frame.seq <= cursor.seq;
