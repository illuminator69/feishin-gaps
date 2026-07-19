import isElectron from 'is-electron';

import { api } from '/@/renderer/api';
import { getItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { useHubStore, useSettingsStore } from '/@/renderer/store';
import { AddToQueueType } from '/@/renderer/store';
import { LibraryItem, Song } from '/@/shared/types/domain-types';
import { Play } from '/@/shared/types/types';

const hub = isElectron() ? window.api.hub : null;

/** Map Feishin's add-to-queue type to a remote enqueue mode. */
export const addToQueueTypeToRemoteMode = (type: AddToQueueType): 'end' | 'next' | 'now' => {
    if (typeof type === 'object' && 'edge' in type) {
        return type.edge === 'top' ? 'next' : 'end';
    }
    if (type === Play.NOW || type === Play.SHUFFLE) return 'now';
    if (type === Play.NEXT || type === Play.NEXT_SHUFFLE) return 'next';
    return 'end';
};

const rewriteToPublic = (url: null | string | undefined, base: string): string | undefined => {
    if (!url || !base) return url ?? undefined;
    try {
        const parsed = new URL(url);
        return `${base}${parsed.pathname}${parsed.search}`;
    } catch {
        return url;
    }
};

/**
 * Build hub Track payloads (id + streamUrl + metadata) from full Songs, so
 * URL-based receivers (the Chromecast bridge) can play them. Mirrors
 * use-hub's buildHubTracks but usable outside React (e.g. the player context).
 */
export const buildHubTracksForSongs = async (
    songs: Song[],
    serverId: string,
    publicServerUrl: string,
): Promise<Array<Record<string, unknown>>> => {
    const base = (publicServerUrl || '').trim().replace(/\/$/, '');
    return Promise.all(
        songs.map(async (song) => {
            let streamUrl: string | undefined;
            try {
                streamUrl = (await api.controller.getStreamUrl({
                    apiClientProps: { serverId },
                    query: { id: song.id, skipAutoTranscode: true, transcode: false },
                })) as string;
            } catch {
                streamUrl = undefined;
            }
            const container = (song as Song & { container?: null | string }).container;
            return {
                album: song.album ?? undefined,
                artist: song.artistName,
                durationMs: song.duration ?? undefined,
                id: song.id,
                imageUrl:
                    rewriteToPublic(
                        getItemImageUrl({
                            id: song.id,
                            imageUrl: song.imageUrl,
                            itemType: LibraryItem.SONG,
                            serverId: song._serverId,
                            type: 'itemCard',
                            useRemoteUrl: true,
                        }),
                        base,
                    ) || undefined,
                mime: container
                    ? `audio/${container === 'mp3' ? 'mpeg' : container}`
                    : undefined,
                streamUrl: rewriteToPublic(streamUrl, base),
                title: song.name,
            };
        }),
    );
};

/**
 * Fire an `act` directive at the hub when a remote session is active. Returns
 * true when it handled the command (caller should NOT also drive the local
 * player), false otherwise. Usable outside React (e.g. the player context),
 * which is what lets the normal playerbar controls transparently drive the
 * remote session.
 */
export const remoteAct = (action: string, extra?: Record<string, unknown>): boolean => {
    if (!hub || !isRemoteSessionActive()) return false;
    hub.send({ action, t: 'act', ...extra });
    return true;
};

/** True if playback is currently on another navi-connect device. */
export const isRemoteSessionActive = (): boolean => {
    const s = useHubStore.getState();
    return (
        s.connected &&
        s.activeDeviceId !== null &&
        s.myDeviceId !== null &&
        s.activeDeviceId !== s.myDeviceId
    );
};

/**
 * Route a set of songs to the REMOTE session: `now` replaces the queue and
 * plays, `next`/`end` enqueue. Returns true when handled (caller skips local).
 */
export const enqueueToRemote = async (
    songs: Song[],
    mode: 'end' | 'next' | 'now',
): Promise<boolean> => {
    if (!hub || !isRemoteSessionActive() || songs.length === 0) return false;
    const serverId = songs[0]._serverId;
    const publicServerUrl = useSettingsStore.getState().hub?.publicServerUrl ?? '';
    const tracks = await buildHubTracksForSongs(songs, serverId, publicServerUrl);

    if (mode === 'now') {
        hub.send({ action: 'setQueue', index: 0, play: true, t: 'act', tracks });
    } else {
        hub.send({ action: 'enqueue', at: mode === 'next' ? 'next' : 'end', t: 'act', tracks });
    }
    return true;
};
