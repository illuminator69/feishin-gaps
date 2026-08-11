import { dialog, ipcMain } from 'electron';
import { createWriteStream, promises as fsp } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

/**
 * Playlist downloads (navi-connect roadmap): the renderer resolves transcoded
 * stream URLs and filenames; this side owns the filesystem — directory picker,
 * sequential downloads with progress events, and a per-directory manifest
 * (.feishin-downloads.json) listing the files WE wrote, so mirror-mode can
 * remove tracks that left the playlist without ever touching foreign files.
 */

interface DownloadFile {
    filename: string;
    id: string;
    url: string;
}

interface ManifestEntry {
    filename: string;
    id: string;
}

interface SyncArgs {
    dir: string;
    files: DownloadFile[];
    removeOthers: boolean;
}

interface SyncResult {
    downloaded: number;
    failed: string[];
    removed: number;
    renamed: number;
    skipped: number;
}

const MANIFEST = '.feishin-downloads.json';

let cancelled = false;

async function downloadOne(url: string, destPath: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
    }
    const tmpPath = `${destPath}.part`;
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(tmpPath));
    await fsp.rename(tmpPath, destPath);
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await fsp.stat(path);
        return true;
    } catch {
        return false;
    }
}

async function readManifest(dir: string): Promise<ManifestEntry[]> {
    try {
        const raw = await fsp.readFile(join(dir, MANIFEST), 'utf-8');
        const data = JSON.parse(raw) as { files?: Array<ManifestEntry | string> };
        if (!Array.isArray(data.files)) return [];
        // Back-compat with the old string-list manifest (no ids).
        return data.files.map((entry) =>
            typeof entry === 'string' ? { filename: entry, id: '' } : entry,
        );
    } catch {
        return [];
    }
}

async function writeManifest(dir: string, files: ManifestEntry[]): Promise<void> {
    await fsp.writeFile(join(dir, MANIFEST), JSON.stringify({ files }, null, 2), 'utf-8');
}

ipcMain.handle('downloads-select-directory', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
    });
    return result.filePaths[0] || null;
});

ipcMain.on('downloads-cancel', () => {
    cancelled = true;
});

ipcMain.handle('downloads-sync', async (event, args: SyncArgs): Promise<SyncResult> => {
    const { dir, files, removeOthers } = args;
    cancelled = false;

    await fsp.mkdir(dir, { recursive: true });
    const managed = await readManifest(dir);
    const managedById = new Map(
        managed.filter((entry) => entry.id).map((entry) => [entry.id, entry.filename]),
    );
    const wantedIds = new Set(files.map((file) => file.id));
    const wantedNames = new Set(files.map((file) => file.filename));

    // Mirror-removal by SONG ID, not filename — index-prefixed names shift when
    // tracks are removed/reordered, and treating that as departure deleted and
    // re-downloaded most of the folder. Only files whose song truly left the
    // playlist are removed; position changes are handled by renaming below.
    let removed = 0;
    if (removeOthers) {
        for (const entry of managed) {
            const departed = entry.id ? !wantedIds.has(entry.id) : !wantedNames.has(entry.filename);
            if (departed) {
                try {
                    await fsp.unlink(join(dir, entry.filename));
                    removed += 1;
                } catch {
                    /* already gone */
                }
            }
        }
    }

    let downloaded = 0;
    let renamed = 0;
    let skipped = 0;
    const failed: string[] = [];
    const newManaged: ManifestEntry[] = [];

    for (let i = 0; i < files.length; i += 1) {
        if (cancelled) break;
        const file = files[i];
        const destPath = join(dir, file.filename);

        event.sender.send('downloads-progress', {
            current: i + 1,
            filename: file.filename,
            total: files.length,
        });

        if (await fileExists(destPath)) {
            skipped += 1;
            newManaged.push({ filename: file.filename, id: file.id });
            continue;
        }

        // Same song managed under a different name (its position shifted) —
        // rename instead of re-downloading.
        const previousName = managedById.get(file.id);
        if (previousName && previousName !== file.filename) {
            try {
                await fsp.rename(join(dir, previousName), destPath);
                renamed += 1;
                newManaged.push({ filename: file.filename, id: file.id });
                continue;
            } catch {
                /* old file missing — fall through to download */
            }
        }

        try {
            await downloadOne(file.url, destPath);
            downloaded += 1;
            newManaged.push({ filename: file.filename, id: file.id });
        } catch (error) {
            failed.push(`${file.filename}: ${(error as Error).message}`);
        }
    }

    await writeManifest(dir, newManaged);
    event.sender.send('downloads-progress', {
        current: files.length,
        done: true,
        total: files.length,
    });

    return { downloaded, failed, removed, renamed, skipped };
});
