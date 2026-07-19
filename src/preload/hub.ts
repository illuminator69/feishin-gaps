import { ipcRenderer } from 'electron';

/**
 * Renderer-facing bridge for the navi-connect hub transport. The main process
 * passes raw protocol frames both ways; the renderer (use-hub.tsx) does all the
 * protocol work.
 */
const onMessage = (cb: (msg: any) => void) => {
    ipcRenderer.on('hub-message', (_event, data: string) => {
        try {
            cb(JSON.parse(data));
        } catch {
            /* ignore malformed frame */
        }
    });
};

const send = (obj: unknown) => {
    ipcRenderer.send('hub-send', obj);
};

const setSettings = (
    enabled: boolean,
    url: string,
    token: string,
    name: string,
): Promise<null | string> => {
    return ipcRenderer.invoke('hub-settings', enabled, url, token, name);
};

const removeListeners = () => {
    ipcRenderer.removeAllListeners('hub-message');
};

export const hub = {
    onMessage,
    removeListeners,
    send,
    setSettings,
};

export type Hub = typeof hub;
