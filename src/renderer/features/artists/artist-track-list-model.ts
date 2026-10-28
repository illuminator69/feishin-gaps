/**
 * The artist page's compact track list (R10, B-218): Popular, laid out as Spotify's Popular is. Its
 * own columns; nothing here reads the Songs library's table settings.
 *
 * Pure: plain data in, plain data out; nothing from `/@/`, so the harness runs it under `node --test`.
 */

export type TrackListToggle = 'less' | 'more' | null;

/**
 * The rows on screen: `initial` folded, at most `max` unfolded. The toggle is "See more" while
 * folded and there is more to show, "Show less" while unfolded and there was something folded away,
 * and absent when everything fits folded.
 */
export const visibleTracks = <T>({
    expanded,
    initial,
    max,
    songs,
}: {
    expanded: boolean;
    initial: number;
    max: number;
    songs: readonly T[];
}): { rows: T[]; toggle: TrackListToggle } => {
    const cap = Math.max(initial, max);
    if (songs.length <= initial) return { rows: [...songs], toggle: null };
    if (!expanded) return { rows: songs.slice(0, initial), toggle: 'more' };
    return { rows: songs.slice(0, cap), toggle: 'less' };
};

/**
 * Whether a row earns its second line (the song's artists): only when someone other than the page's
 * artist is credited. Without a page artist any credit does.
 */
export const hasOtherArtists = (
    artists: readonly { id: string }[],
    pageArtistId: string | undefined,
): boolean =>
    pageArtistId === undefined
        ? artists.length > 0
        : artists.some((artist) => artist.id !== pageArtistId);

/** A column of the list, in its order (R13, B-245: the rating and the heart where the play count was). */
export type TrackColumn = 'cover' | 'duration' | 'favorite' | 'index' | 'menu' | 'rating' | 'title';

/** The list's width below which the rating goes (`@container` in artist-track-list.module.css). */
export const TRACK_LIST_NARROW_PX = 520;
/** Below this the second line goes and the gaps shrink, before the title truncates hard. */
export const TRACK_LIST_NARROWER_PX = 380;

const COLUMN_PX: Record<Exclude<TrackColumn, 'title'>, number> = {
    cover: 40,
    duration: 52,
    favorite: 32,
    index: 28,
    menu: 32,
    // Five xs stars and their 4 px sides, as the album table draws them.
    rating: 84,
};

/**
 * The columns at a list width: number, cover, title, rating, heart, duration, menu. Narrow, the rating
 * goes first (it took the play count's place in R10's order); the heart is small and stays. A column
 * the user switched off in Settings (ratings, favourites) is not there at all.
 */
export const trackColumns = (
    width: number,
    { favorite, rating }: { favorite: boolean; rating: boolean },
): TrackColumn[] => {
    const columns: TrackColumn[] = ['index', 'cover', 'title'];
    if (rating && width >= TRACK_LIST_NARROW_PX) columns.push('rating');
    if (favorite) columns.push('favorite');
    columns.push('duration', 'menu');
    return columns;
};

/** The grid's `grid-template-columns` for those columns: the title takes what is left. */
export const trackColumnTemplate = (columns: readonly TrackColumn[]): string =>
    columns
        .map((column) => (column === 'title' ? 'minmax(0, 1fr)' : `${COLUMN_PX[column]}px`))
        .join(' ');

/** Mantine's Rating star, on its 24-unit grid. */
const STAR_PATH =
    'M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z';

/**
 * R13 review M5: a rated row's stars as one element until it is pointed at or focused. The CSS mask
 * of five stars, the first `rating` filled and the rest outlined (1 unit, as Mantine's are stroked),
 * as a `url(...)` value; the element's background gives the filled and the outlined their colours.
 */
export const staticStarsMask = (rating: number): string => {
    const filled = Math.max(0, Math.min(5, Math.round(rating)));
    const paths = Array.from(
        { length: 5 },
        (_, i) =>
            `<path transform='translate(${i * 24} 0)' d='${STAR_PATH}' fill='${i < filled ? '#000' : 'none'}' stroke='#000' stroke-width='1' stroke-linecap='round' stroke-linejoin='round'/>`,
    ).join('');
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 24'>${paths}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};
