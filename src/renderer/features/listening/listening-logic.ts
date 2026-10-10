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

const PERIOD_PHRASES: Record<LbBotListeningPeriod, string> = {
    '7d': 'in the last 7 days',
    '30d': 'in the last 30 days',
    '90d': 'in the last 90 days',
    '365d': 'in the last year',
    all: 'of all time',
};

/** "in the last 30 days" - the period as a phrase for a ranking's reason line. */
export const periodPhrase = (period: LbBotListeningPeriod): string => PERIOD_PHRASES[period];

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

/** The page's four tabs (L1). */
export type ListeningTab = 'activity' | 'history' | 'not-in-library' | 'overview';

export const LISTENING_TABS: { id: ListeningTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'activity', label: 'Activity' },
    { id: 'history', label: 'History' },
    { id: 'not-in-library', label: 'Not in library' },
];

export const DEFAULT_TAB: ListeningTab = 'overview';

/** L2: the period picker is drawn where the period changes what is shown - not on History. */
export const showsPeriodPicker = (tab: ListeningTab): boolean => tab !== 'history';

/** The status in words, for the plain line shown when the history is ready. */
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
 * L8: the status shown ONCE. A state with something to say (importing, error, off)
 * is the banner and nothing else; only `ready` is a plain line. The range and last
 * sync ride along either way, as one muted line.
 */
export const statusLines = (
    status: LbBotListeningStatus,
    when: (epochSeconds: null | number) => string,
): { banner: null | { detail: string; headline: string }; line: string; meta: string } => {
    const view = statusView(status);
    const meta = [
        rangeText(status.oldest, status.newest, when),
        `last sync ${when(status.lastSyncAt)}`,
    ]
        .filter(Boolean)
        .join(' · ');
    return view.kind === 'ready'
        ? { banner: null, line: describeListeningStatus(status), meta }
        : { banner: { detail: view.detail, headline: view.headline }, line: '', meta };
};

export interface HeatmapCell {
    count: number;
    date: string;
    /** 0 = no plays, 1..4 scaled to the busiest day. */
    level: number;
}

/**
 * `columns[week][weekday]`, Monday = row 0. `padBefore` / `padAfter` count the null
 * cells at the start of the first column and the end of the last: a span that does
 * not end on a Sunday leaves the last column short, so the bottom rows end one
 * column before the top ones - the "last row sits one square to the left" the user
 * saw. The cells are right (every date is in its weekday's row, for a span ending
 * on any weekday - the harness pins it); the renderer draws the trailing pad as
 * faint placeholders so every row visibly runs to the same end.
 */
export const heatmapGrid = (
    days: readonly LbBotDayCount[],
): { columns: (HeatmapCell | null)[][]; max: number; padAfter: number; padBefore: number } => {
    if (days.length === 0) return { columns: [], max: 0, padAfter: 0, padBefore: 0 };
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
    let padAfter = 0;
    for (let i = 0; i < padded.length; i += 7) {
        const week = padded.slice(i, i + 7);
        while (week.length < 7) {
            week.push(null);
            padAfter += 1;
        }
        columns.push(week);
    }
    return { columns, max, padAfter, padBefore: offset };
};

/** What the heat map says it shows: its own span, and that the picker does not change it. */
export const heatmapCaption = (days: readonly LbBotDayCount[]): string => {
    if (days.length === 0) return '';
    const span = days.length % 7 === 0 ? `${days.length / 7} weeks` : `${days.length} days`;
    return `Plays per day, ${days[0].date} to ${days[days.length - 1].date} (${span}). The period below does not change it.`;
};

const PERIOD_DAYS: Record<LbBotListeningPeriod, null | number> = {
    '7d': 7,
    '30d': 30,
    '90d': 90,
    '365d': 365,
    all: null,
};

/** The plays-over-time series for the picked period: the tail of lb-bot's daily series. */
export const dailyForPeriod = (
    daily: readonly LbBotDayCount[],
    period: LbBotListeningPeriod,
): LbBotDayCount[] => {
    const wanted = PERIOD_DAYS[period];
    return wanted === null || wanted >= daily.length
        ? [...daily]
        : daily.slice(daily.length - wanted);
};

/** lb-bot's daily series is capped; a longer period says what is actually drawn. */
export const dailyNote = (period: LbBotListeningPeriod, available: number): string => {
    const wanted = PERIOD_DAYS[period];
    return (wanted === null || wanted > available) && available > 0
        ? `Showing the last ${available} days, the longest daily series lb-bot sends.`
        : '';
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

// ---------------------------------------------------------------------------
// What a card or a row shows (L4, L6): text and the Navidrome id for the picture.
// No id means the placeholder - never a request to find one.
// ---------------------------------------------------------------------------

export interface CardView {
    imageId: null | string;
    subtitle: string;
    title: string;
}

export const albumCardView = (
    album: { artist: string; ndAlbumId: string; owned: boolean; plays: number; title: string },
    rank: number,
): CardView => ({
    imageId: album.ndAlbumId || null,
    subtitle: `${album.artist} · ${playsLabel(album.plays)}${album.owned ? '' : ' · not in your library'}`,
    title: `${rank}. ${album.title}`,
});

export const artistCardView = (
    artist: { name: string; ndArtistId: string; plays: number },
    rank: number,
): CardView => ({
    imageId: artist.ndArtistId || null,
    subtitle: playsLabel(artist.plays),
    title: `${rank}. ${artist.name}`,
});

export const trackCardView = (
    track: { artist: string; ndAlbumId: string; plays: number; title: string },
    rank: number,
): CardView => ({
    imageId: track.ndAlbumId || null,
    subtitle: `${track.artist} · ${playsLabel(track.plays)}`,
    title: `${rank}. ${track.title}`,
});

export const recentRowView = (row: {
    artist: string;
    ndAlbumId: string;
    release: string;
    track: string;
}): CardView => ({
    imageId: row.ndAlbumId || null,
    subtitle: row.release ? `${row.artist} · ${row.release}` : row.artist,
    title: row.track,
});
