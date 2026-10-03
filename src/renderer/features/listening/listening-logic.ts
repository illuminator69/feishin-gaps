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
        level: d.count <= 0 || max <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((d.count / max) * 4))),
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

export const hoursBars = (hours: readonly number[]): { count: number; hour: number; ratio: number }[] => {
    const max = hours.reduce((m, h) => Math.max(m, h), 0);
    return Array.from({ length: 24 }, (_, hour) => {
        const count = hours[hour] ?? 0;
        return { count, hour, ratio: max > 0 ? count / max : 0 };
    });
};

export type ArtistTarget = { id: string; kind: 'library' } | { kind: 'external'; mbid: string } | null;
export type AlbumTarget = { id: string; kind: 'library' } | { kind: 'external'; rgid: string } | null;

/** Owned → the library page; else the virtual page; else plain text. */
export const artistTarget = (ndArtistId: string, mbid: string): ArtistTarget =>
    ndArtistId
        ? { id: ndArtistId, kind: 'library' }
        : mbid
          ? { kind: 'external', mbid }
          : null;

export const albumTarget = (ndAlbumId: string, rgid: string): AlbumTarget =>
    ndAlbumId ? { id: ndAlbumId, kind: 'library' } : rgid ? { kind: 'external', rgid } : null;

/** An unowned-album row as the release the shared missing-album tile renders. */
export const unownedAlbumRelease = (row: { rgid: string; title: string }): LbBotRelease => ({
    effectiveType: 'album',
    navidromeAlbumIds: [],
    primaryType: 'album',
    rgid: row.rgid,
    secondaryTypes: [],
    status: 'missing',
    title: row.title,
    year: '',
});
