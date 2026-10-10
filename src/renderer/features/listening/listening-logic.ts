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

/** The stored count in words: the ready line, and the error banner's lead-in. */
export const describeStoredListens = (status: LbBotListeningStatus): string =>
    `${status.count} listens stored${
        status.total !== null && status.total !== status.count
            ? ` of ${status.total} on ListenBrainz`
            : ''
    }.`;

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
    if (view.kind === 'ready') return { banner: null, line: describeStoredListens(status), meta };
    // An error keeps the stored count the plain line used to carry.
    const detail =
        view.kind === 'error' ? `${describeStoredListens(status)} ${view.detail}` : view.detail;
    return { banner: { detail, headline: view.headline }, line: '', meta };
};

export interface HeatmapCell {
    count: number;
    date: string;
    /** 0 = no plays, 1..4 scaled to the busiest day. */
    level: number;
}

/**
 * The days that are drawn: from the first Monday inside the data, so the grid is
 * whole weeks (the leading days before it - at most six - are not drawn). With no
 * Monday inside (under a week of data) everything is kept.
 */
const wholeWeeks = (days: readonly LbBotDayCount[]): readonly LbBotDayCount[] => {
    // Date strings are zone-local calendar days; read them as UTC so the weekday
    // is the one printed, whatever zone this machine is in.
    const monday = days.findIndex(
        (d) => (((Date.parse(`${d.date}T00:00:00Z`) / 86_400_000 + 3) % 7) + 7) % 7 === 0,
    );
    return monday < 0 ? days : days.slice(monday);
};

/**
 * `columns[week][weekday]`, Monday = row 0: whole weeks. The first column starts on
 * a Monday; every column but the last is seven real days; the current week's days
 * not yet reached are null (drawn as placeholders), so the map is always a clean
 * rectangle. (lb-bot's 112-day span rarely starts on a Monday: drawing the partial
 * leading week hidden was the "bottom row starts one column to the left" the user saw.)
 */
export const heatmapGrid = (
    days: readonly LbBotDayCount[],
): { columns: (HeatmapCell | null)[][]; max: number } => {
    const drawn = wholeWeeks(days);
    if (drawn.length === 0) return { columns: [], max: 0 };
    const max = drawn.reduce((m, d) => Math.max(m, d.count), 0);
    const cells: (HeatmapCell | null)[] = drawn.map((d) => ({
        count: d.count,
        date: d.date,
        level:
            d.count <= 0 || max <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((d.count / max) * 4))),
    }));
    const columns: (HeatmapCell | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
        const week = cells.slice(i, i + 7);
        while (week.length < 7) week.push(null);
        columns.push(week);
    }
    return { columns, max };
};

/** What the heat map says it shows: the range actually drawn, its weeks, and that the picker does not change it. */
export const heatmapCaption = (days: readonly LbBotDayCount[]): string => {
    const drawn = wholeWeeks(days);
    if (drawn.length === 0) return '';
    const first = drawn[0].date;
    const last = drawn[drawn.length - 1].date;
    const weeks = Math.ceil(drawn.length / 7);
    const span = drawn.length < 7 ? `${drawn.length} days` : `${weeks} weeks`;
    return `Plays per day, ${first} to ${last} (${span}). The period below does not change it.`;
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

/** lb-bot's daily series holds at most this many days (`LISTENS_DAILY_MAX_DAYS`). */
export const DAILY_CAP = 90;

/**
 * Said only when the cap is what cut the series: a period longer than the series
 * AND a series at its maximum. A short history on "All time" is just short - no note.
 */
export const dailyNote = (period: LbBotListeningPeriod, available: number): string => {
    const wanted = PERIOD_DAYS[period];
    const capped = available >= DAILY_CAP && (wanted === null || wanted > available);
    return capped
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
    /** A release group whose Cover Art Archive cover stands in for an album the library lacks. */
    imageRgid: null | string;
    /** Whether the card goes anywhere: a card that does not is plain, not a button. */
    linked: boolean;
    subtitle: string;
    title: string;
}

export const albumCardView = (
    album: {
        artist: string;
        ndAlbumId: string;
        owned: boolean;
        plays: number;
        rgid: string;
        title: string;
    },
    rank: number,
): CardView => ({
    imageId: album.ndAlbumId || null,
    imageRgid: !album.ndAlbumId && album.rgid ? album.rgid : null,
    linked: albumTarget(album.ndAlbumId, album.rgid, album.owned) !== null,
    subtitle: `${album.artist} · ${playsLabel(album.plays)}${album.owned ? '' : ' · not in your library'}`,
    title: `${rank}. ${album.title}`,
});

export const artistCardView = (
    artist: { mbid: string; name: string; ndArtistId: string; plays: number },
    rank: number,
): CardView => ({
    imageId: artist.ndArtistId || null,
    imageRgid: null,
    linked: artistTarget(artist.ndArtistId, artist.mbid) !== null,
    subtitle: playsLabel(artist.plays),
    title: `${rank}. ${artist.name}`,
});

export const trackCardView = (
    track: { artist: string; ndAlbumId: string; plays: number; rgid: string; title: string },
    rank: number,
): CardView => ({
    imageId: track.ndAlbumId || null,
    imageRgid: !track.ndAlbumId && track.rgid ? track.rgid : null,
    linked: albumTarget(track.ndAlbumId, track.rgid) !== null,
    subtitle: `${track.artist} · ${playsLabel(track.plays)}`,
    title: `${rank}. ${track.title}`,
});

export const recentRowView = (row: {
    artist: string;
    ndAlbumId: string;
    release: string;
    track: string;
}): { imageId: null | string; subtitle: string; title: string } => ({
    imageId: row.ndAlbumId || null,
    subtitle: row.release ? `${row.artist} · ${row.release}` : row.artist,
    title: row.track,
});

// ---------------------------------------------------------------------------
// A history row's context menu: which song, album or artist it is for
// ---------------------------------------------------------------------------

const titleKey = (title: string): string => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The song of an album a recent play is, or null. A recent play carries no Navidrome
 * song id, so it is matched against the album's own songs: by recording id when the
 * app's song carries one (a unique hit wins), else by title with case and
 * punctuation ignored - and only when exactly ONE song has that title. Two tracks
 * with one title is no guess: a menu acting on the wrong song is worse than none.
 */
export const matchSongByTitle = <
    T extends { id: string; mbzRecordingId?: null | string; name: string },
>(
    row: { recordingMbid: string; track: string },
    songs: readonly T[],
): null | string => {
    if (row.recordingMbid) {
        const byRecording = songs.filter((s) => s.mbzRecordingId === row.recordingMbid);
        if (byRecording.length === 1) return byRecording[0].id;
    }
    const key = titleKey(row.track);
    if (!key) return null;
    const byTitle = songs.filter((s) => titleKey(s.name) === key);
    return byTitle.length === 1 ? byTitle[0].id : null;
};

export type HistoryMenuTarget =
    | { id: string; kind: 'album' | 'artist' | 'song' }
    | { kind: 'none' };

/**
 * What a history row's context menu opens: the matched song's, else its album's,
 * else its artist's, else none. A song is only ever resolved through the album, so a
 * row without an album id never gets a song menu.
 */
export const historyMenuTarget = (
    row: { ndAlbumId: string; ndArtistId: string },
    matchedSongId: null | string,
): HistoryMenuTarget => {
    if (row.ndAlbumId && matchedSongId) return { id: matchedSongId, kind: 'song' };
    if (row.ndAlbumId) return { id: row.ndAlbumId, kind: 'album' };
    if (row.ndArtistId) return { id: row.ndArtistId, kind: 'artist' };
    return { kind: 'none' };
};
