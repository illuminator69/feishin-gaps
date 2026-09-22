import type {
    LbBotArtistCandidate,
    LbBotDiscography,
    LbBotDownloadResult,
    LbBotFillStatus,
    LbBotFreshFeed,
    LbBotGap,
    LbBotGapSource,
    LbBotMeta,
    LbBotReleaseDetail,
    LbBotResolvedEdition,
    LbBotResult,
    LbBotSimilarAlbums,
    LbBotSimilarArtists,
    LbBotSourceFiles,
    LbBotStatus,
    LbBotTracklist,
} from '/@/shared/types/lbbot-types';

import { ipcRenderer } from 'electron';

/**
 * Renderer-facing bridge for lb-bot's library-gap intelligence. The main process
 * does the HTTP (always through the navi-connect hub) and normalizes lb-bot's
 * snake_case API into the shared shapes.
 *
 * Two contracts, and the split is deliberate. The passive reads — the probe, the
 * discography — fail soft to null so their surface hides itself. Anything the
 * user pressed answers with an `LbBotResult`, because a button that does nothing
 * and says nothing is worse than an error.
 */

const status = (): Promise<LbBotStatus> => ipcRenderer.invoke('lbbot-status');

const discography = (ndId: string, mbid?: string): Promise<LbBotDiscography | null> =>
    ipcRenderer.invoke('lbbot-discography', { mbid, ndId });

const indexArtist = (ndId: string, mbid: string, name: string): Promise<null | string> =>
    ipcRenderer.invoke('lbbot-index-artist', { mbid, name, ndId });

/** Add or refresh one release-group in an artist's index — the cheap alternative
 *  to a full rescan for a release the stored discography predates. */
const indexRelease = (args: {
    artist?: string;
    external?: boolean;
    mbid?: string;
    name?: string;
    ndId?: string;
    rgid: string;
    title?: string;
    type?: string;
    year?: string;
}): Promise<LbBotResult<boolean>> => ipcRenderer.invoke('lbbot-index-release', args);

/** Site-wide fresh releases. Fail-soft: null when ListenBrainz or lb-bot is down. */
const freshReleases = (days: number): Promise<LbBotFreshFeed | null> =>
    ipcRenderer.invoke('lbbot-fresh-releases', { days });

const albumReleases = (rgid: string): Promise<LbBotReleaseDetail | null> =>
    ipcRenderer.invoke('lbbot-album-releases', { rgid });

const albumTracklist = (releaseMbid: string, albumIds?: string[]): Promise<LbBotTracklist | null> =>
    ipcRenderer.invoke('lbbot-album-tracklist', { albumIds, releaseMbid });

/** Ranked Soulseek folders for one release-group. Slow (a live slskd fan-out). */
/** `edition` is the release the caller already resolved, so lb-bot can skip
 *  re-asking MusicBrainz — see the main-process handler. */
const albumSources = (
    rgid: string,
    edition?: LbBotResolvedEdition,
): Promise<LbBotResult<LbBotGapSource[]>> =>
    ipcRenderer.invoke('lbbot-album-sources', {
        album: edition?.title,
        artist: edition?.artist,
        releaseMbid: edition?.releaseMbid,
        rgid,
        total: edition?.totalTracks,
    });

const downloadAlbum = (
    rgid: string,
    quality?: string,
    source?: { folder: string; peer: string },
    edition?: LbBotResolvedEdition,
    excludeUsers?: string[],
): Promise<LbBotDownloadResult> =>
    ipcRenderer.invoke('lbbot-download-album', {
        artist: edition?.artist,
        excludeUsers,
        quality,
        releaseMbid: edition?.releaseMbid,
        rgid,
        sourceFolder: source?.folder,
        sourceUsername: source?.peer,
        title: edition?.title,
        totalTracks: edition?.totalTracks,
    });

const albumStatus = (releaseMbid?: string, rgid?: string): Promise<LbBotFillStatus> =>
    ipcRenderer.invoke('lbbot-album-status', { releaseMbid, rgid });

const cancelAlbum = (releaseMbid: string): Promise<{ ok: boolean; status: LbBotFillStatus }> =>
    ipcRenderer.invoke('lbbot-cancel-album', { releaseMbid });

const allowMp3 = (groupId: string, allow = true): Promise<boolean> =>
    ipcRenderer.invoke('lbbot-allow-mp3', { allow, groupId });

const gap = (groupId: string): Promise<LbBotResult<LbBotGap>> =>
    ipcRenderer.invoke('lbbot-gap', { groupId });

const gapSourceFiles = (
    groupId: string,
    sourceIndex: number,
): Promise<LbBotResult<LbBotSourceFiles>> =>
    ipcRenderer.invoke('lbbot-gap-source-files', { groupId, sourceIndex });

const gapSearch = (groupId: string, force = false): Promise<LbBotResult<boolean>> =>
    ipcRenderer.invoke('lbbot-gap-search', { force, groupId });

const gapAuto = (groupId: string): Promise<LbBotResult<boolean>> =>
    ipcRenderer.invoke('lbbot-gap-auto', { groupId });

const gapFetch = (groupId: string, sourceId: number): Promise<LbBotResult<boolean>> =>
    ipcRenderer.invoke('lbbot-gap-fetch', { groupId, sourceId });

const gapCancel = (groupId: string): Promise<LbBotResult<boolean>> =>
    ipcRenderer.invoke('lbbot-gap-cancel', { groupId });

const gapRescan = (groupId: string): Promise<LbBotResult<boolean>> =>
    ipcRenderer.invoke('lbbot-gap-rescan', { groupId });

/** MusicBrainz artist search — the "Not in your library" half of search.
 *  Empty array when we could not ask; the section then does not render. */
const artistLookup = (q: string): Promise<LbBotArtistCandidate[]> =>
    ipcRenderer.invoke('lbbot-artist-lookup', { q });

/** "Similar albums" — one album per similar artist, all from your own library,
 *  each row naming the artist that justifies it. Null when we could not ask. */
const albumSimilar = (args: {
    artistMbid?: string;
    artistName?: string;
    limit?: number;
    rgid?: string;
}): Promise<LbBotSimilarAlbums | null> => ipcRenderer.invoke('lbbot-album-similar', args);

/** "Fans also like" — similar artists, owned and unowned alike. Unlike
 *  `albumSimilar` this one is a shopping list: every row carries `owned` and
 *  `indexed` rather than being filtered out. Prefer `mbid`.
 *  Null when we could not ask. */
const artistSimilar = (args: {
    limit?: number;
    mbid?: string;
    name?: string;
}): Promise<LbBotSimilarArtists | null> => ipcRenderer.invoke('lbbot-artist-similar', args);

/** Editorial "About" for an artist — full Wikipedia text with its CC BY-SA
 *  attribution, the Wikidata one-liner, members/side-projects and links.
 *  Prefer `mbid`; `name` costs lb-bot an extra MusicBrainz search.
 *  Null means we could not ask, which hides the section. */
const metaArtist = (args: { mbid?: string; name?: string }): Promise<LbBotMeta | null> =>
    ipcRenderer.invoke('lbbot-meta-artist', args);

/** The same for a release-group, plus release credits. */
const metaAlbum = (args: { releaseMbid?: string; rgid: string }): Promise<LbBotMeta | null> =>
    ipcRenderer.invoke('lbbot-meta-album', args);

/** Post a system notification for a fill that landed while Feishin was in the
 *  background. The main process suppresses it when the window is focused — the
 *  renderer's toast has that case covered. */
const notify = (title: string, body: string): Promise<void> =>
    ipcRenderer.invoke('lbbot-notify', { body, title });

export const lbBot = {
    albumReleases,
    albumSimilar,
    albumSources,
    albumStatus,
    albumTracklist,
    allowMp3,
    artistLookup,
    artistSimilar,
    cancelAlbum,
    discography,
    downloadAlbum,
    freshReleases,
    gap,
    gapAuto,
    gapCancel,
    gapFetch,
    gapRescan,
    gapSearch,
    gapSourceFiles,
    indexArtist,
    indexRelease,
    metaAlbum,
    metaArtist,
    notify,
    status,
};
