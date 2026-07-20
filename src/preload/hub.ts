import { ipcRenderer } from 'electron';

/**
 * Renderer-facing bridge for the navi-connect hub transport. The main process
 * passes raw protocol frames both ways; the renderer (use-hub.tsx) does all the
 * protocol work.
 */
const onMessage = (cb: (msg: any) => void): (() => void) => {
    const handler = (_event: unknown, data: string) => {
        try {
            cb(JSON.parse(data));
        } catch {
            /* ignore malformed frame */
        }
    };
    ipcRenderer.on('hub-message', handler);
    // Return a disposer that removes THIS handler only — removeAllListeners
    // would clobber any other subscriber and re-subscribing stacked duplicates.
    return () => ipcRenderer.removeListener('hub-message', handler);
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
