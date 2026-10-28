/**
 * The artist page's compact track list (R10, B-218): Popular and the favourite songs, laid out as
 * Spotify's Popular is. Its own columns; nothing here reads the Songs library's table settings.
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
