/**
 * navi-connect F7 (Task 6): the not-owned album page's shell, from what it knows so far.
 */

export type AlbumPageState = 'loading' | 'older' | 'ready' | 'redirect' | 'unconfigured';

export const albumPageState = (input: {
    available: boolean;
    hasRgid: boolean;
    /** The index names a Navidrome album for this release-group: the library has it. */
    ownedAlbumId: null | string;
    releasesRead: 'data' | 'null' | 'pending';
    /** The hub does not advertise `GET /lb/album/releases`. */
    routeOlder: boolean;
}): AlbumPageState => {
    if (input.ownedAlbumId) return 'redirect';
    // The page says the link has no id; there is nothing to wait for.
    if (!input.hasRgid) return 'ready';
    if (!input.available && input.releasesRead !== 'data') return 'unconfigured';
    if (input.releasesRead === 'null' && input.routeOlder) return 'older';
    if (input.releasesRead === 'pending') return 'loading';
    return 'ready';
};
