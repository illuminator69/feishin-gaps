import { contextBridge, webUtils } from 'electron';

import { audioMuse } from './audiomuse';
import { autodiscover } from './autodiscover';
import { browser } from './browser';
import { cast } from './cast';
import { customThemes } from './custom-themes';
import { discordRpc } from './discord-rpc';
import { downloads } from './downloads';
import { hub } from './hub';
import { ipc } from './ipc';
import { lbBot } from './lbbot';
import { localSettings } from './local-settings';
import { lyrics } from './lyrics';
import { mpris } from './mpris';
import { mpvPlayer, mpvPlayerListener } from './mpv-player';
import { remote } from './remote';
import { utils } from './utils';
import { visualizer } from './visualizer';

// Custom APIs for renderer
const api = {
    audioMuse,
    autodiscover,
    browser,
    cast,
    customThemes,
    discordRpc,
    downloads,
    getPathForFile: webUtils.getPathForFile,
    hub,
    ipc,
    lbBot,
    localSettings,
    lyrics,
    mpris,
    mpvPlayer,
    mpvPlayerListener,
    remote,
    utils,
    visualizer,
};

export type PreloadApi = typeof api;

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('api', api);
    } catch (error) {
        console.error(error);
    }
} else {
    // @ts-ignore (define in dts)
    window.api = api;
}
