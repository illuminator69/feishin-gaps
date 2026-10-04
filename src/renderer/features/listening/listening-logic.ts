import type {
    LbBotDayCount,
    LbBotListeningPeriod,
    LbBotListeningStatus,
    LbBotRelease,
} from '/@/shared/types/lbbot-types';

/**
 * I-006: the My Listening screen's view-model, as pure functions.
 *
 * Every number the screen shows is a field of lb-bot's response; what lives here
 * is only the wording decisions around them ("from N of M plays"), the grid
 * layouts, and where a row links. Plain `.ts` so `listening-logic.harness.ts`
 * can run it with `node --test`.
 */

export const PERIOD_OPTIONS: { label: string; value: LbBotListeningPeriod }[] = [
    { label: '7 days', value: '7d' },
    { label: '30 days', value: '30d' },
    { label: '90 days', value: '90d' },
    { label: 'Year', value: '365d' },
    { label: 'All time', value: 'all' },
];

export const DEFAULT_PERIOD: LbBotListeningPeriod = '30d';

export const formatListeningTime = (seconds: number): string => {
    if (seconds <= 0) return '0 min';
    if (seconds < 60) return '< 1 min';
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours === 0) return `${minutes} min`;
    // Past ~100 h the minutes are noise.
    if (hours >= 100) return `${hours} h`;
    return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
};

/** `seconds` sums only listens that carry a duration; say how many did, but only
 *  when that is fewer than all of them. */
export const listeningTimeNote = (totals: { plays: number; secondsKnownFor: number }): string =>
    totals.secondsKnownFor < totals.plays
        ? `from ${totals.secondsKnownFor} of ${totals.plays} plays`
        : '';

/** `genres` covers only plays of albums the library holds. */
export const genresNote = (genrePlays: number, plays: number): string =>
    `from ${genrePlays} of ${plays} plays — albums in your library`;

export interface StatusView {
    detail: string;
    headline: string;
    kind: LbBotListeningStatus['state'];
    /** Poll `status` every 5 s — only while importing. */
    poll: boolean;
}

export const statusView = (status: LbBotListeningStatus): StatusView => {
    switch (status.state) {
        case 'error':
            return {
                detail: status.error
                    ? `The last sync failed: ${status.error}. The listens already stored are shown.`
                    : 'The last sync failed. The listens already stored are shown.',
                headline: 'Sync problem',
                kind: 'error',
                poll: false,
            };
        case 'importing':
            return {
                detail: 'Reading your ListenBrainz history. Numbers below cover what has arrived so far.',
                headline:
                    status.total !== null
                        ? `Importing ${status.count} of ${status.total}`
                        : `Importing ${status.count} listens so far`,
                kind: 'importing',
                poll: true,
            };
        case 'off':
            return {
                detail: 'lb-bot has no ListenBrainz user configured, so there is no listening history to show.',
                headline: 'Listening history is off',
                kind: 'off',
                poll: false,
            };
        default:
            return { detail: '', headline: '', kind: 'ready', poll: false };
    }
};

export interface HeatmapCell {
    count: number;
    date: string;
    /** 0 = no plays, 1..4 scaled to the busiest day. */
    level: number;
}

/** `columns[week][weekday]`, Monday = row 0; null pads the first week. */
export const heatmapGrid = (
    days: readonly LbBotDayCount[],
): { columns: (HeatmapCell | null)[][]; max: number } => {
    if (days.length === 0) return { columns: [], max: 0 };
    const max = days.reduce((m, d) => Math.max(m, d.count), 0);
    const cells: (HeatmapCell | null)[] = days.map((d) => ({
        count: d.count,
        date: d.date,
        level:
            d.count <= 0 || max <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((d.count / max) * 4))),
    }));
    // Date strings are zone-local calendar days; read them as UTC so the weekday
    // is the one printed, whatever zone this machine is in.
    const weekday = (Date.parse(`${days[0].date}T00:00:00Z`) / 86_400_000 + 3) % 7;
    const offset = Number.isFinite(weekday) ? Math.floor(((weekday % 7) + 7) % 7) : 0;
    const padded = [...Array<null>(offset).fill(null), ...cells];
    const columns: (HeatmapCell | null)[][] = [];
    for (let i = 0; i < padded.length; i += 7) {
        const week = padded.slice(i, i + 7);
        while (week.length < 7) week.push(null);
        columns.push(week);
    }
    return { columns, max };
};

export const hoursBars = (
    hours: readonly number[],
): { count: number; hour: number; ratio: number }[] => {
    const max = hours.reduce((m, h) => Math.max(m, h), 0);
    return Array.from({ length: 24 }, (_, hour) => {
        const count = hours[hour] ?? 0;
        return { count, hour, ratio: max > 0 ? count / max : 0 };
    });
};

export type AlbumTarget =
    | null
    | { id: string; kind: 'library' }
    | { kind: 'external'; rgid: string };
export type ArtistTarget =
    | null
    | { id: string; kind: 'library' }
    | { kind: 'external'; mbid: string };

/** Owned → the library page; else the virtual page; else plain text. */
export const artistTarget = (ndArtistId: string, mbid: string): ArtistTarget =>
    ndArtistId ? { id: ndArtistId, kind: 'library' } : mbid ? { kind: 'external', mbid } : null;

/** `owned` with no id yet (a filled album still syncing) is plain text: the
 *  external page is where acquire lives, and the library already holds it. */
export const albumTarget = (ndAlbumId: string, rgid: string, owned = false): AlbumTarget =>
    ndAlbumId
        ? { id: ndAlbumId, kind: 'library' }
        : rgid && !owned
          ? { kind: 'external', rgid }
          : null;

/** An unowned-album row as the release the shared missing-album tile renders.
 *  `fillDone`: the fills ledger holds a finished fill for it, so it is no longer
 *  "missing" (never re-offer a download because the download succeeded). */
export const unownedAlbumRelease = (
    row: { rgid: string; title: string },
    fillDone: boolean,
): LbBotRelease => ({
    effectiveType: 'album',
    navidromeAlbumIds: [],
    primaryType: 'album',
    rgid: row.rgid,
    secondaryTypes: [],
    status: fillDone ? 'complete' : 'missing',
    title: row.title,
    year: '',
});

/** The first read after an import ends: the summary and unowned lists were read
 *  while it ran, so they hold partial totals under no "Importing" label until
 *  something re-reads them. `error` ends an import too (the numbers stay, the
 *  banner says why). */
export const importFinished = (
    prev: LbBotListeningStatus['state'] | undefined,
    next: LbBotListeningStatus['state'],
): boolean => prev === 'importing' && (next === 'ready' || next === 'error');

export type ReadState =
    | { kind: 'empty' }
    | { kind: 'failed'; permanent: boolean; text: string }
    | { kind: 'older' }
    | { kind: 'reading' }
    | { kind: 'rows' }
    | { kind: 'unreachable' };

/**
 * One list's honest state: "reading" only while a fetch is in flight, "empty" only
 * from a 200 that said so, "failed" with lb-bot's own text (a 400 is permanent, so
 * no Retry), "older" for a 404 / 405, "unreachable" when nothing can be asked.
 * Rows already read stay rows when a later refetch fails.
 */
export const readState = (input: {
    available: boolean;
    error: null | { message: string; status: number };
    fetching: boolean;
    hasData: boolean;
    rowCount: number;
    supported: boolean;
}): ReadState => {
    if (input.hasData && input.rowCount > 0) return { kind: 'rows' };
    if (input.error && (input.error.status === 404 || input.error.status === 405)) {
        return { kind: 'older' };
    }
    if (input.error) {
        return {
            kind: 'failed',
            permanent: input.error.status === 400,
            text: input.error.message || 'lb-bot could not answer this.',
        };
    }
    if (input.hasData) return { kind: 'empty' };
    if (input.fetching) return { kind: 'reading' };
    return { kind: 'unreachable' };
};

export const playsLabel = (n: number): string => `${n} ${n === 1 ? 'play' : 'plays'}`;

/** "Range A to B" only from what is known; nothing when neither end is. */
export const rangeText = (
    oldest: null | number,
    newest: null | number,
    format: (epochSeconds: number) => string,
): string => {
    if (oldest !== null && newest !== null) return `Range ${format(oldest)} to ${format(newest)}`;
    if (oldest !== null) return `Range from ${format(oldest)}`;
    if (newest !== null) return `Range up to ${format(newest)}`;
    return '';
};
