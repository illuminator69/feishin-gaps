import { ipcRenderer } from 'electron';

export interface DownloadProgress {
    current: number;
    done?: boolean;
    filename?: string;
    total: number;
}

export interface DownloadSyncResult {
    downloaded: number;
    failed: string[];
    removed: number;
    renamed: number;
    skipped: number;
}

const selectDirectory = (): Promise<null | string> =>
    ipcRenderer.invoke('downloads-select-directory');

const sync = (args: {
    dir: string;
    files: Array<{ filename: string; id: string; url: string }>;
    removeOthers: boolean;
}): Promise<DownloadSyncResult> => ipcRenderer.invoke('downloads-sync', args);

const cancel = () => ipcRenderer.send('downloads-cancel');

const onProgress = (cb: (progress: DownloadProgress) => void) => {
    ipcRenderer.on('downloads-progress', (_event, progress: DownloadProgress) => cb(progress));
};

const removeProgressListener = () => {
    ipcRenderer.removeAllListeners('downloads-progress');
};

export const downloads = {
    cancel,
    onProgress,
    removeProgressListener,
    selectDirectory,
    sync,
};

export type Downloads = typeof downloads;
