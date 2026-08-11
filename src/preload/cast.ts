import { ipcRenderer } from 'electron';

/**
 * Which cast speakers this client bridges (see the main-process handler).
 *
 * The renderer needs it to decide whether it is the one client responsible for
 * scrobbling a Chromecast's playback — nothing else about the bridge is exposed,
 * because nothing else about it is the renderer's business.
 */
const bridgedDevices = (): Promise<string[]> => ipcRenderer.invoke('cast-bridged-devices');

export const cast = {
    bridgedDevices,
};
