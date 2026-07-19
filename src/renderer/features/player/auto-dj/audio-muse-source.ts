import isElectron from 'is-electron';

import { setMoodCentroid } from '/@/renderer/store/mood-centroid.store';
import { ServerListItem } from '/@/shared/types/domain-types';

// navi-connect Tier 2: AudioMuse-AI core API (Sonic Fingerprint / Mood Flow).
// Routed through the main process (the core API has no CORS), so it only works
// in the desktop build. Returns Navidrome song ids; fail-soft to [].

export interface AudioMuseSettings {
    token: string;
    url: string;
}

// A track's sonic analysis from AudioMuse /get_score, used to drive the visualizer.
export interface TrackMood {
    energy?: number;
    moodVector?: number[] | Record<string, number>;
    tempo?: number;
    topGenre?: string;
}

const bridge = () => (isElectron() ? window.api.audioMuse : undefined);

export const audioMuseConfigured = (settings: AudioMuseSettings): boolean =>
    isElectron() && Boolean(settings.url) && Boolean(settings.token);

export const fetchFingerprintIds = async (
    settings: AudioMuseSettings,
    server: null | ServerListItem,
    count: number,
): Promise<string[]> => {
    const api = bridge();
    if (!api || !settings.url || !settings.token) return [];
    // Pass the username; the AudioMuse core supplies the password from its own
    // NAVIDROME_PASSWORD config (Feishin stores a salted token, not the password).
    return api.fingerprint(settings.url, settings.token, server?.username ?? '', '', count);
};

export const fetchAlchemyIds = async (
    settings: AudioMuseSettings,
    addIds: string[],
    subtractIds: string[],
    count: number,
): Promise<string[]> => {
    const api = bridge();
    if (!api || !settings.url || !settings.token || addIds.length === 0) return [];
    const { centroid2d, ids } = await api.alchemy(
        settings.url,
        settings.token,
        addIds,
        subtractIds,
        count,
    );
    // Stash the mood centroid so the scoped generator chip can tint by mood.
    setMoodCentroid(centroid2d);
    return ids;
};

export const fetchTrackMood = async (
    settings: AudioMuseSettings,
    itemId: string,
): Promise<TrackMood | null> => {
    const api = bridge();
    if (!api || !settings.url || !settings.token || !itemId) return null;
    return api.trackMood(settings.url, settings.token, itemId);
};

// A single CLAP text-search result (id + display fields).
export interface ClapResult {
    author: string;
    id: string;
    similarity: number;
    title: string;
}

// CLAP text→audio mood search. Fail-soft to [] (disabled/unanalyzed/non-Electron).
export const fetchClapSearch = async (
    settings: AudioMuseSettings,
    query: string,
    limit: number,
): Promise<ClapResult[]> => {
    const api = bridge();
    if (!api || !settings.url || !settings.token || !query.trim()) return [];
    return api.clapSearch(settings.url, settings.token, query.trim(), limit);
};

// Probe whether CLAP search is usable on the server (enabled + embeddings loaded).
export const fetchClapAvailable = async (settings: AudioMuseSettings): Promise<boolean> => {
    const api = bridge();
    if (!api || !settings.url || !settings.token) return false;
    const { available } = await api.clapStats(settings.url, settings.token);
    return available;
};
