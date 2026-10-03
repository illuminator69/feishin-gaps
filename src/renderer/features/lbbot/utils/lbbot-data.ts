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

/**
 * The index mirror's last sync run, read-only (`getMirrorSyncState`). `id` counts
 * runs, so a caller can tell a run that began after its click from one that was
 * already over. `status` on a failure is the HTTP status the pull ended on (0 =
 * an IPC or storage failure, no HTTP answer).
 */
export interface MirrorSyncState {
    id: number;
    phase: 'failed' | 'finished' | 'idle' | 'running' | 'skipped';
    reason?: string;
    status?: number;
}

export interface SyncSnapshot {
    cursor: number;
    epoch: string;
    listening: LbBotListeningStatus | null;
    sync: MirrorSyncState;
}

const MIRROR_START_MS = 5000;
const LISTENING_GIVE_UP_MS = 20_000;

const describePullFailure = (status: number | undefined): string => {
    if (status === 503) return 'the hub is busy (503); it will retry';
    if (status === 404) return 'the hub does not serve the index feed (404)';
    if (status === 0 || status === undefined) return 'no answer from the hub, or a storage error';
    return `the hub answered ${status}`;
};

/**
 * What "Sync now" has visibly done so far. The click is not the answer: the
 * answer is the mirror's cursor moving and the listening status changing, read
 * from the same sources the rest of the app reads. The mirror part judges the
 * pull's OWN outcome (a run that started after the click), never a timeout:
 * "up to date" only after a pull that finished with the cursor unchanged.
 */
export const syncReport = (
    before: SyncSnapshot,
    now: SyncSnapshot,
    listeningRequested: boolean,
    elapsedMs: number,
): { done: boolean; listening: string; mirror: string } => {
    let mirror: string;
    let mirrorDone = true;
    const ownRun = now.sync.id > before.sync.id;
    if (now.epoch !== before.epoch) {
        mirror = 'Index mirror: lb-bot rebuilt its index, so the mirror started over.';
    } else if (now.cursor !== before.cursor) {
        mirror = `Index mirror moved: cursor ${before.cursor} to ${now.cursor}.`;
        // The pull may still be running; the cursor already moved, which is the answer.
    } else if (!ownRun) {
        if (elapsedMs < MIRROR_START_MS) {
            mirror = 'Index mirror: waiting for the pull to start...';
            mirrorDone = false;
        } else {
            mirror =
                'Index mirror: no pull has started (one may be queued, or backing off after an earlier failure).';
        }
    } else if (now.sync.phase === 'running') {
        mirror = 'Index mirror: the pull is still running...';
        mirrorDone = false;
    } else if (now.sync.phase === 'failed') {
        mirror = `Index mirror: the pull failed (${describePullFailure(now.sync.status)}). The mirror is unchanged.`;
    } else if (now.sync.phase === 'skipped') {
        mirror = `Index mirror: the pull was not run (${now.sync.reason || 'lb-bot is not available'}).`;
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

/**
 * The sentence under "Refresh About". `same` = the answer was a success whose
 * body equals what was already shown; only then is "nothing new" true.
 */
export const classifyRefresh = (
    result: { error?: string; ok: boolean; status: number },
    same: boolean,
): string => {
    if (result.ok) {
        return same ? "Checked: lb-bot's answer is the same as what is shown." : 'Refreshed.';
    }
    if (result.status === 0) return 'Could not reach lb-bot. What is shown is unchanged.';
    return `lb-bot answered an error (${result.status})${result.error ? `: ${result.error}` : ''}. What is shown is unchanged.`;
};
