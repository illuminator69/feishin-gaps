import type { PreviewStatus, PreviewTrack } from '/@/shared/types/preview-types';

import { ipcRenderer } from 'electron';

/**
 * Renderer-facing bridge for the navi-connect preview sidecar.
 *
 * Both calls are fail-soft by design: `status` answers "off" rather than
 * throwing, and `resolve` answers `null` for "no preview exists", which is a
 * normal outcome for anything obscure. Nothing here carries the audio — the
 * `streamUrl` on a resolved track is a signed, absolute URL the `<audio>`
 * element (or a Chromecast) fetches from the sidecar itself.
 */

const status = (): Promise<PreviewStatus> => ipcRenderer.invoke('preview-status');

/** Find a playable preview for one track. `durationMs`, when known, lets the
 *  sidecar reject a match of the wrong length — a different recording with the
 *  same title is the common bad hit. */
const resolve = (args: {
    album?: string;
    artist: string;
    durationMs?: number;
    title: string;
}): Promise<null | PreviewTrack> => ipcRenderer.invoke('preview-resolve', args);

export const preview = {
    resolve,
    status,
};

export type Preview = typeof preview;
