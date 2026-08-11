import type {
    LbBotDiscography,
    LbBotDownloadResult,
    LbBotFillStatus,
    LbBotGap,
    LbBotGapSource,
    LbBotReleaseDetail,
    LbBotResolvedEdition,
    LbBotResult,
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
): Promise<LbBotDownloadResult> =>
    ipcRenderer.invoke('lbbot-download-album', {
        artist: edition?.artist,
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

export const lbBot = {
    albumReleases,
    albumSources,
    albumStatus,
    albumTracklist,
    allowMp3,
    discography,
    downloadAlbum,
    gap,
    gapAuto,
    gapCancel,
    gapFetch,
    gapRescan,
    gapSearch,
    gapSourceFiles,
    indexArtist,
    status,
};
