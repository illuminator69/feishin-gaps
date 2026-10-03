import type {
    LbBotListeningStatus,
    LbBotOverride,
    LbBotToCheck,
} from '/@/shared/types/lbbot-types';

/**
 * I-020 / I-021: wording and bookkeeping for the "lb-bot data" settings panel,
 * as pure functions (`lbbot-data.harness.ts` runs them).
 */

/** The override query's cached body: the map every resolver reads, plus the
 *  I-021 list. `toCheck: null` = the lb-bot sent no such field (older), which
 *  is NOT the same as an empty list. */
export interface OverridesData {
    byNdId: Record<string, LbBotOverride>;
    toCheck: LbBotToCheck[] | null;
}

/** Tolerates a body persisted before `toCheck` existed (a bare map). */
export const normalizeOverridesData = (raw: unknown): OverridesData => {
    if (raw && typeof raw === 'object' && 'byNdId' in raw) {
        const r = raw as { byNdId?: unknown; toCheck?: unknown };
        return {
            byNdId: (r.byNdId && typeof r.byNdId === 'object'
                ? r.byNdId
                : {}) as OverridesData['byNdId'],
            toCheck: Array.isArray(r.toCheck) ? (r.toCheck as LbBotToCheck[]) : null,
        };
    }
    if (raw && typeof raw === 'object') {
        return { byNdId: raw as OverridesData['byNdId'], toCheck: null };
    }
    return { byNdId: {}, toCheck: null };
};

/** Overrides by name, case-blind; a nameless (orphaned) one last. */
export const sortOverrides = (byNdId: Record<string, LbBotOverride>): LbBotOverride[] =>
    Object.values(byNdId).sort((a, b) => {
        if (!a.name !== !b.name) return a.name ? -1 : 1;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });

/** What was measured, in words. It asserts "worth a look", never "wrong". */
export const describeToCheck = (row: Pick<LbBotToCheck, 'albums' | 'kind'>): string =>
    row.kind === 'unmatched'
        ? `lb-bot guessed a MusicBrainz artist that matches none of your ${row.albums} ${row.albums === 1 ? 'album' : 'albums'}`
        : 'No MusicBrainz artist found';

export const describeListeningStatus = (status: LbBotListeningStatus): string => {
    switch (status.state) {
        case 'error':
            return `${status.count} listens stored. The last sync failed: ${status.error || 'no reason given'}.`;
        case 'importing':
            return status.total !== null
                ? `Importing ${status.count} of ${status.total} listens.`
                : `Importing, ${status.count} listens so far.`;
        case 'off':
            return 'Listening history is not set up: lb-bot has no ListenBrainz user.';
        default:
            return `${status.count} listens stored${
                status.total !== null && status.total !== status.count
                    ? ` of ${status.total} on ListenBrainz`
                    : ''
            }.`;
    }
};

export interface SyncSnapshot {
    cursor: number;
    epoch: string;
    listening: LbBotListeningStatus | null;
}

const MIRROR_SETTLE_MS = 5000;
const LISTENING_GIVE_UP_MS = 20_000;

/**
 * What "Sync now" has visibly done so far. The click is not the answer: the
 * answer is the mirror's cursor moving and the listening status changing, read
 * from the same sources the rest of the app reads. Each part is "still waiting"
 * until it shows a change or enough time passes to call it settled.
 */
export const syncReport = (
    before: SyncSnapshot,
    now: SyncSnapshot,
    listeningRequested: boolean,
    elapsedMs: number,
): { done: boolean; listening: string; mirror: string } => {
    let mirror: string;
    let mirrorDone = true;
    if (now.epoch !== before.epoch) {
        mirror = 'Index mirror: lb-bot rebuilt its index, so the mirror started over.';
    } else if (now.cursor !== before.cursor) {
        mirror = `Index mirror moved: cursor ${before.cursor} to ${now.cursor}.`;
    } else if (elapsedMs < MIRROR_SETTLE_MS) {
        mirror = 'Index mirror: checking...';
        mirrorDone = false;
    } else {
        mirror = `Index mirror: already up to date (cursor ${now.cursor}).`;
    }

    let listening = '';
    let listeningDone = true;
    if (listeningRequested) {
        const a = before.listening;
        const b = now.listening;
        if (!b) {
            listening = 'Listening: no status from lb-bot.';
        } else if (b.state === 'importing') {
            listening = `Listening: Importing ${b.count} of ${b.total ?? '?'}.`;
            listeningDone = false;
        } else if (
            !a ||
            a.state !== b.state ||
            a.count !== b.count ||
            a.lastSyncAt !== b.lastSyncAt
        ) {
            listening = `Listening: synced, ${b.count} listens stored.`;
        } else if (elapsedMs < LISTENING_GIVE_UP_MS) {
            listening = 'Listening: waiting for lb-bot...';
            listeningDone = false;
        } else {
            listening =
                'Listening: no change reported (already up to date, or lb-bot is still working).';
        }
    }
    return { done: mirrorDone && listeningDone, listening, mirror };
};
