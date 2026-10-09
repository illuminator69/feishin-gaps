import type {
    LbBotAlbumOverrideRow,
    LbBotPreview,
    LbBotVariant,
} from '/@/shared/types/lbbot-types';

/**
 * I-022 "Fix album match": the logic that has no React in it.
 *
 * Pure, so `album-override.harness.ts` can run it. Navic mirrors this by hand
 * (`navi-connect/CLAUDE.md`, the contract in `.superpowers/sdd/album-override-*`):
 * the sentences and the poll's rules below are the shared behaviour.
 */

// ---------------------------------------------------------------------------
// A pasted release id
// ---------------------------------------------------------------------------

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const BARE_UUID = new RegExp(`^${UUID}$`, 'i');
const RELEASE_URL = new RegExp(
    `^(?:https?://)?(?:[a-z0-9-]+\\.)?musicbrainz\\.org/release/(${UUID})(?:[/?#].*)?$`,
    'i',
);

/**
 * A pasted bare MBID or `musicbrainz.org/release/<uuid>` URL -> the lowercase
 * uuid, else null. Only the *release* path on musicbrainz.org (or one of its
 * subdomains): a release-group, artist or label uuid is not a release, and a
 * look-alike host is not MusicBrainz. (`artist-override.ts` has the artist twin.)
 */
export const extractReleaseMbid = (input: string): null | string => {
    const text = (input || '').trim();
    if (BARE_UUID.test(text)) return text.toLowerCase();
    const match = RELEASE_URL.exec(text);
    return match ? match[1].toLowerCase() : null;
};

// ---------------------------------------------------------------------------
// The preview, summarised
// ---------------------------------------------------------------------------

export interface PreviewSummary {
    /** Files an apply would rewrite: they have a slot and are not already right. */
    changing: number;
    /** Files with a slot. */
    matched: number;
    /** Slots of the release that no file fills. */
    missing: number;
    /** Files with no slot: an apply leaves them untouched. */
    noSlot: number;
    total: number;
    /** Files with a slot that already carry exactly its numbers, title and release. */
    unchanged: number;
}

export const summarizePreview = (preview: LbBotPreview): PreviewSummary => {
    const changing = preview.files.filter((file) => file.to !== null && file.changed).length;
    return {
        changing,
        matched: preview.matched,
        missing: preview.missing.length,
        noSlot: preview.unmatched,
        total: preview.files.length,
        unchanged: Math.max(preview.matched - changing, 0),
    };
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The one fixed sentence before apply (contract, "Client behaviour" 6). */
export const commitSentence = (changing: number): string =>
    `lb-bot rewrites the tags of ${plural(changing, 'file', 'files')} and keeps the previous ones, so this can be undone.`;

/** The confirmation behind a 409 `poor_match`: both numbers, then the choice. */
export const poorMatchSentence = (matched: number, total: number): string =>
    `Only ${matched} of the ${total} files have a place on this release. Apply anyway?`;

// ---------------------------------------------------------------------------
// The apply / remove poll, as one state machine
// ---------------------------------------------------------------------------

export const POLL_INTERVAL_MS = 2000;
export const GIVE_UP_MS = 180_000;
export const STILL_WORKING = 'Still working — check the lb-bot data panel.';

/**
 * What a poll of `GET /lb/album/override?id=` (or, in F2, `GET /lb/artist/merge?id=`)
 * ends on. States are lb-bot's own strings; one not listed here keeps the poll going.
 */
export interface PollSpec {
    /** The row is still being worked on. */
    active: readonly string[];
    /** States that end the job unsuccessfully. */
    failed: readonly string[];
    /** A `failed` state only counts once `active` has been seen: a remove can be
     *  polled before lb-bot has flipped the row, and `applied` then is the old state. */
    failedNeedsActive: boolean;
    /** The lb-bot `code` of the 404 that says the row is gone. */
    goneCode: string;
    /** `true`: the coded 404 is the success (a remove deletes its row). `false`: the
     *  row vanishing from under an apply is its own, unexpected, ending. */
    goneIsDone: boolean;
    /** States that end the job successfully. */
    settled: readonly string[];
}

export const APPLY_SPEC: PollSpec = {
    active: ['applying'],
    failed: ['failed'],
    failedNeedsActive: false,
    goneCode: 'no_override',
    goneIsDone: false,
    settled: ['applied'],
};

export const REMOVE_SPEC: PollSpec = {
    active: ['removing'],
    failed: ['applied', 'failed'],
    failedNeedsActive: true,
    goneCode: 'no_override',
    goneIsDone: true,
    settled: [],
};

export type PollAnswer<TRow extends PollRow = LbBotAlbumOverrideRow> =
    | { code: string; ok: false; status: number }
    | { ok: true; row: TRow };

/** `settled`: it finished well. `gone`: the row vanished and that is not the plan.
 *  `failed`: lb-bot says it failed. `timeout`: three minutes passed. */
export type PollPhase = 'failed' | 'gone' | 'polling' | 'settled' | 'timeout';

/** A job row as the poll reads it. Both override rows and merge rows fit. */
export interface PollRow {
    done: number;
    failures: unknown[];
    state: string;
    total: number;
}

export interface PollState<TRow extends PollRow = LbBotAlbumOverrideRow> {
    phase: PollPhase;
    /** The last row lb-bot answered, kept across failed polls so progress does not blink. */
    row: null | TRow;
    sawActive: boolean;
    spec: PollSpec;
    startedAt: number;
}

export const pollStart = <TRow extends PollRow = LbBotAlbumOverrideRow>(
    spec: PollSpec,
    now: number,
): PollState<TRow> => ({ phase: 'polling', row: null, sawActive: false, spec, startedAt: now });

/**
 * One tick. An answer is judged before the clock, so a reply that lands at the
 * deadline still counts. A failed poll (no hub, a 5xx, a timeout, a code-less
 * 404) is NOT an answer and changes nothing but the clock.
 */
export const pollStep = <TRow extends PollRow>(
    prev: PollState<TRow>,
    answer: PollAnswer<TRow>,
    now: number,
): PollState<TRow> => {
    if (prev.phase !== 'polling') return prev;
    const { spec } = prev;
    if (answer.ok) {
        const state = answer.row.state;
        const sawActive = prev.sawActive || spec.active.includes(state);
        const next = { ...prev, row: answer.row, sawActive };
        if (spec.settled.includes(state)) return { ...next, phase: 'settled' };
        if (spec.failed.includes(state) && (sawActive || !spec.failedNeedsActive)) {
            return { ...next, phase: 'failed' };
        }
    } else if (answer.status === 404 && answer.code === spec.goneCode) {
        return { ...prev, phase: spec.goneIsDone ? 'settled' : 'gone' };
    }
    const row = answer.ok ? answer.row : prev.row;
    const sawActive = answer.ok
        ? prev.sawActive || spec.active.includes(answer.row.state)
        : prev.sawActive;
    if (now - prev.startedAt >= GIVE_UP_MS) return { ...prev, phase: 'timeout', row, sawActive };
    return { ...prev, row, sawActive };
};

// ---------------------------------------------------------------------------
// Failures and outcomes, in words
// ---------------------------------------------------------------------------

export interface AlbumFailure {
    code: string;
    /** `older`: hide the control. `poor_match`: ask, then resend with `force`.
     *  `retry`: nothing was written, trying again may work. `answer`: lb-bot's own text. */
    kind: 'answer' | 'older' | 'poor_match' | 'retry';
    matched?: number;
    message: string;
    status: number;
    total?: number;
}

/**
 * A code-less 404 (the hub or a GET-only lb-bot has no such route) and a 405 (an
 * lb-bot older than the hub) both mean "older". A 404 that carries a `code` is
 * lb-bot's own answer. Everything else relays lb-bot's `error`, which it writes
 * for people (`busy`, `in_progress`, `unknown_album`, `unknown_release`, 400s).
 */
export const describeAlbumFailure = (result: {
    code?: string;
    error?: string;
    matched?: number;
    retryable?: boolean;
    status: number;
    total?: number;
}): AlbumFailure => {
    const base = { code: result.code ?? '', status: result.status };
    const text = (result.error ?? '').trim();
    if (result.status === 405 || (result.status === 404 && !result.code)) {
        return {
            ...base,
            kind: 'older',
            message: 'This lb-bot is older and cannot fix album matches yet.',
        };
    }
    if (
        result.status === 409 &&
        result.code === 'poor_match' &&
        typeof result.matched === 'number' &&
        typeof result.total === 'number'
    ) {
        return {
            ...base,
            kind: 'poor_match',
            matched: result.matched,
            message: poorMatchSentence(result.matched, result.total),
            total: result.total,
        };
    }
    if (result.status === 0 || result.status === 502 || result.status === 504) {
        return {
            ...base,
            kind: 'retry',
            message: text || 'lb-bot did not answer. Nothing was written.',
        };
    }
    return { ...base, kind: 'answer', message: text || 'lb-bot did not accept that.' };
};

/** What a finished job says it did, from the row alone. */
export const outcomeSentence = (
    kind: 'apply' | 'remove',
    row: null | Pick<LbBotAlbumOverrideRow, 'done' | 'failures' | 'state' | 'total'>,
): string => {
    if (kind === 'remove') {
        return row && (row.state === 'failed' || row.state === 'applied')
            ? 'lb-bot could not put all the previous tags back.'
            : 'lb-bot put the previous tags back.';
    }
    if (!row) return 'lb-bot wrote the tags.';
    if (row.state === 'failed') {
        return `lb-bot did not finish writing the tags (${row.done} of ${plural(row.total, 'file', 'files')} written).`;
    }
    if (row.failures.length > 0) {
        return `lb-bot wrote ${row.done} of ${plural(row.total, 'file', 'files')}; ${row.failures.length} could not be written.`;
    }
    return `lb-bot wrote the tags of ${plural(row.done, 'file', 'files')}.`;
};

export type AfterOverride = { id: string; kind: 'album' | 'artist' } | { kind: 'none' };

/**
 * Where to go once an apply or remove has finished. The album id the modal was
 * opened with is dead (a retag changes it); the row's current `albumId` is the
 * album again, "" while Navidrome has not indexed it - then the artist page.
 */
export const nextAfterOverride = (albumId: string, artistId: string): AfterOverride => {
    if (albumId) return { id: albumId, kind: 'album' };
    if (artistId) return { id: artistId, kind: 'artist' };
    return { kind: 'none' };
};

// ---------------------------------------------------------------------------
// Editions
// ---------------------------------------------------------------------------

export interface EditionRow {
    country: string;
    coverUrl: string;
    current: boolean;
    disambiguation: string;
    format: string;
    label: string;
    releaseMbid: string;
    title: string;
    trackCount: number;
    year: string;
}

/**
 * The picker's rows: every edition of every variant, once, in lb-bot's order. A
 * variant with no `editions` is itself a release and becomes one row. `current`
 * marks the release the album is tagged as now.
 */
export const editionRows = (
    variants: readonly LbBotVariant[],
    currentReleaseMbid: string,
): EditionRow[] => {
    const seen = new Set<string>();
    const rows: EditionRow[] = [];
    const add = (row: Omit<EditionRow, 'current'>) => {
        if (!row.releaseMbid || seen.has(row.releaseMbid)) return;
        seen.add(row.releaseMbid);
        rows.push({
            ...row,
            current: !!currentReleaseMbid && row.releaseMbid === currentReleaseMbid,
        });
    };
    for (const variant of variants) {
        if (variant.editions.length === 0) {
            add({
                country: '',
                coverUrl: variant.coverUrl,
                disambiguation: variant.disambiguation,
                format: '',
                label: '',
                releaseMbid: variant.releaseMbid,
                title: variant.title,
                trackCount: variant.trackCount,
                year: variant.year,
            });
            continue;
        }
        for (const edition of variant.editions) {
            add({
                country: edition.country,
                coverUrl: edition.coverUrl || variant.coverUrl,
                disambiguation: variant.disambiguation,
                format: edition.format,
                label: edition.label,
                releaseMbid: edition.releaseMbid,
                title: variant.title,
                trackCount: variant.trackCount,
                year: edition.year || variant.year,
            });
        }
    }
    return rows;
};

// ---------------------------------------------------------------------------
// Fix round 1: forced applies and leaving the dead page
// ---------------------------------------------------------------------------

/** A 409 `poor_match` the user is being asked about - tied to ITS release. */
export interface PendingConfirm {
    matched: number;
    releaseMbid: string;
    total: number;
}

/**
 * Whether `force: true` may go out for `releaseMbid`. Only for the release whose
 * `poor_match` answer was confirmed: lb-bot's counts for release A say nothing
 * about release B, whose own guard must answer for itself.
 */
export const forceAllowed = (pending: null | PendingConfirm, releaseMbid: string): boolean =>
    !!pending && !!releaseMbid && pending.releaseMbid === releaseMbid;

export type LeaveDecision =
    | { id: string; kind: 'album' | 'artist' }
    | { kind: 'albums' }
    | { kind: 'stay' };

/**
 * After an apply or remove ends: where does the app go? Only off the dead album's
 * own route (a retag changes the Navidrome id, so that page is gone); anywhere
 * else the user stays. Then the new album when lb-bot gave its id (an apply only),
 * else the artist, else the album list - a route that is always valid.
 */
export const decideLeave = (input: {
    artistId: string;
    deadAlbumId: string;
    kind: 'apply' | 'remove';
    newAlbumId: string;
    pathname: string;
}): LeaveDecision => {
    if (!input.deadAlbumId || !input.pathname.split('/').includes(input.deadAlbumId)) {
        return { kind: 'stay' };
    }
    if (input.kind === 'apply' && input.newAlbumId) {
        return input.newAlbumId === input.deadAlbumId
            ? { kind: 'stay' }
            : { id: input.newAlbumId, kind: 'album' };
    }
    if (input.artistId) return { id: input.artistId, kind: 'artist' };
    return { kind: 'albums' };
};
