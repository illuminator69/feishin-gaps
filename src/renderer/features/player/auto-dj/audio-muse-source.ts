import isElectron from 'is-electron';

import { setMoodCentroid } from '/@/renderer/store/mood-centroid.store';
import { useSettingsStore } from '/@/renderer/store/settings.store';
import { ServerListItem } from '/@/shared/types/domain-types';

// navi-connect Tier 2: AudioMuse-AI core API (Sonic Fingerprint / Mood Flow).
// Routed through the main process (the core API has no CORS), so it only works
// in the desktop build. Returns Navidrome song ids; fail-soft to [].
//
// The main process prefers the hub's /sonic/* proxy and falls back to these
// direct settings (see DESIGN-hub-audiomuse-proxy.md), so Tier 2 counts as
// configured when EITHER is set — a hub-routed setup leaves these fields blank.

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

// Reads the store directly so the async fetchers below stay non-reactive; React
// callers pass their `useHubSettings()` value so they re-render on a hub change.
const hubRouteConfigured = (hub?: { enabled: boolean; token: string; url: string }): boolean => {
    const h = hub ?? useSettingsStore.getState().hub;
    return Boolean(h?.enabled && h.url && h.token);
};

export const audioMuseConfigured = (
    settings: AudioMuseSettings,
    hub?: { enabled: boolean; token: string; url: string },
): boolean =>
    isElectron() && (hubRouteConfigured(hub) || (Boolean(settings.url) && Boolean(settings.token)));

export const fetchFingerprintIds = async (
    settings: AudioMuseSettings,
    server: null | ServerListItem,
    count: number,
): Promise<string[]> => {
    const api = bridge();
    if (!api || !audioMuseConfigured(settings)) return [];
    // Pass the username; the AudioMuse core supplies the password from its own
    // NAVIDROME_PASSWORD config (Feishin stores a salted token, not the password).
    return api.fingerprint(settings.url, settings.token, server?.username ?? '', '', count);
};

// Adaptive "Mood Flow" tuning preset, mirroring Navic's MoodCharacter. Maps to AudioMuse Song
// Alchemy params: temperature = softmax exploration/drift (server default 1.0, higher = looser);
// subtractDistance = exclusion radius around skipped tracks (server default 0.2). Undefined =
// server default.
export type MoodCharacter = 'echo' | 'steady' | 'transition';

export interface MoodCharacterParams {
    subtractDistance?: number;
    temperature?: number;
}

export const moodCharacterParams = (character: MoodCharacter): MoodCharacterParams => {
    switch (character) {
        case 'echo':
            // Echo Match — sticks close to the vibe.
            return { temperature: 0.5 };
        case 'transition':
            // Transition Maestro — explores, drifts readily.
            return { temperature: 1.6 };
        case 'steady':
        default:
            // Steady Vibes — stays in lane, resists skips.
            return { subtractDistance: 0.35, temperature: 0.6 };
    }
};

export const fetchAlchemyIds = async (
    settings: AudioMuseSettings,
    addIds: string[],
    subtractIds: string[],
    count: number,
    params?: MoodCharacterParams,
): Promise<string[]> => {
    const api = bridge();
    if (!api || !audioMuseConfigured(settings) || addIds.length === 0) return [];
    const { centroid2d, ids } = await api.alchemy(
        settings.url,
        settings.token,
        addIds,
        subtractIds,
        count,
        params?.temperature,
        params?.subtractDistance,
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
    if (!api || !audioMuseConfigured(settings) || !itemId) return null;
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
    if (!api || !audioMuseConfigured(settings) || !query.trim()) return [];
    return api.clapSearch(settings.url, settings.token, query.trim(), limit);
};

// Probe whether CLAP search is usable on the server (enabled + embeddings loaded).
export const fetchClapAvailable = async (settings: AudioMuseSettings): Promise<boolean> => {
    const api = bridge();
    if (!api || !audioMuseConfigured(settings)) return false;
    const { available } = await api.clapStats(settings.url, settings.token);
    return available;
};
