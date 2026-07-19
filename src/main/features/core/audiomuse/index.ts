import { ipcMain } from 'electron';

/**
 * navi-connect Tier-2 AudioMuse-AI core API client (main process).
 *
 * The AudioMuse core API sets no CORS headers, so the renderer can't call it
 * directly under web security — these handlers proxy the calls from the main
 * process (no CORS) and return only resolved Navidrome song ids. The renderer
 * passes all config per-call (base url, bearer token, Navidrome creds, params),
 * so nothing is persisted here. Fail-soft: every handler returns [] on any error.
 */

interface AlchemyArgs {
    addIds: string[];
    baseUrl: string;
    count: number;
    subtractDistance?: number;
    subtractIds: string[];
    temperature?: number;
    token: string;
}

interface FingerprintArgs {
    baseUrl: string;
    count: number;
    ndPassword: string;
    ndUser: string;
    token: string;
}

const trimBase = (url: string): string => url.replace(/\/+$/, '');

const collectItemIds = (value: unknown): string[] => {
    if (!value) return [];

    if (typeof value === 'string') {
        return [value];
    }

    if (Array.isArray(value)) {
        return value.flatMap(collectItemIds);
    }

    if (typeof value !== 'object') {
        return [];
    }

    const row = value as Record<string, unknown>;
    const directId = row.item_id ?? row.itemId ?? row.song_id ?? row.songId ?? row.id;
    if (typeof directId === 'string') {
        return [directId];
    }

    return ['results', 'songs', 'tracks', 'items', 'playlist', 'data'].flatMap((key) =>
        collectItemIds(row[key]),
    );
};

const itemIds = (data: unknown): string[] => {
    return Array.from(new Set(collectItemIds(data).filter(Boolean)));
};

ipcMain.handle(
    'audiomuse-fingerprint',
    async (_event, args: FingerprintArgs): Promise<string[]> => {
        if (!args.baseUrl || !args.token) return [];
        try {
            const url = new URL(`${trimBase(args.baseUrl)}/api/sonic_fingerprint/generate`);
            url.searchParams.set('n', String(args.count));
            if (args.ndUser) url.searchParams.set('navidrome_user', args.ndUser);
            if (args.ndPassword) url.searchParams.set('navidrome_password', args.ndPassword);

            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${args.token}` },
            });
            if (!res.ok) return [];
            return itemIds(await res.json());
        } catch {
            return [];
        }
    },
);

export interface AlchemyResult {
    centroid2d: null | number[];
    ids: string[];
}

const parseCentroid = (data: unknown): null | number[] => {
    const c = (data as { centroid_2d?: unknown })?.centroid_2d;
    if (!Array.isArray(c)) return null;
    const nums = c.map((n) => (typeof n === 'string' ? Number(n) : (n as number)));
    return nums.every((n) => Number.isFinite(n)) ? nums : null;
};

ipcMain.handle('audiomuse-alchemy', async (_event, args: AlchemyArgs): Promise<AlchemyResult> => {
    if (!args.baseUrl || !args.token || args.addIds.length === 0) {
        return { centroid2d: null, ids: [] };
    }
    try {
        const items = [
            ...args.addIds.map((id) => ({ id, op: 'ADD', type: 'song' })),
            ...args.subtractIds.map((id) => ({ id, op: 'SUBTRACT', type: 'song' })),
        ];
        const body: Record<string, unknown> = { items, n: args.count };
        if (args.temperature != null) body.temperature = args.temperature;
        if (args.subtractDistance != null) body.subtract_distance = args.subtractDistance;

        const res = await fetch(`${trimBase(args.baseUrl)}/api/alchemy`, {
            body: JSON.stringify(body),
            headers: {
                Authorization: `Bearer ${args.token}`,
                'Content-Type': 'application/json',
            },
            method: 'POST',
        });
        if (!res.ok) return { centroid2d: null, ids: [] };
        const data = await res.json();
        return { centroid2d: parseCentroid(data), ids: itemIds(data) };
    } catch {
        return { centroid2d: null, ids: [] };
    }
});

interface TrackMoodArgs {
    baseUrl: string;
    itemId: string;
    token: string;
}

const parseMoodVector = (value: unknown): number[] | Record<string, number> | undefined => {
    if (value == null) return undefined;
    if (Array.isArray(value)) return value as number[];
    if (typeof value === 'object') return value as Record<string, number>;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed) || (parsed && typeof parsed === 'object')) {
                return parsed;
            }
        } catch {
            /* not JSON — ignore */
        }
    }
    return undefined;
};

const toFiniteNumber = (value: unknown): number | undefined => {
    const n = typeof value === 'string' ? Number(value) : (value as number);
    return Number.isFinite(n) ? n : undefined;
};

interface ClapSearchArgs {
    baseUrl: string;
    limit: number;
    query: string;
    token: string;
}

export interface ClapResult {
    author: string;
    id: string;
    similarity: number;
    title: string;
}

const toClapResults = (data: unknown): ClapResult[] => {
    const results = (data as { results?: unknown })?.results;
    if (!Array.isArray(results)) return [];
    return results.flatMap((row): ClapResult[] => {
        if (!row || typeof row !== 'object') return [];
        const r = row as Record<string, unknown>;
        const id = r.item_id ?? r.itemId ?? r.id;
        if (typeof id !== 'string' || !id) return [];
        return [
            {
                author: typeof r.author === 'string' ? r.author : '',
                id,
                similarity: toFiniteNumber(r.similarity) ?? 0,
                title: typeof r.title === 'string' ? r.title : '',
            },
        ];
    });
};

// CLAP text→audio search: free-text query → tracks whose audio embedding best
// matches. POST /api/clap/search {query, limit}. Fail-soft: [] on disabled
// (400), cache-not-loaded (503), or any error — the UI greys out / shows empty.
ipcMain.handle('audiomuse-clap-search', async (_event, args: ClapSearchArgs): Promise<
    ClapResult[]
> => {
    if (!args.baseUrl || !args.token || !args.query) return [];
    try {
        const res = await fetch(`${trimBase(args.baseUrl)}/api/clap/search`, {
            body: JSON.stringify({ limit: args.limit, query: args.query }),
            headers: {
                Authorization: `Bearer ${args.token}`,
                'Content-Type': 'application/json',
            },
            method: 'POST',
        });
        if (!res.ok) return [];
        return toClapResults(await res.json());
    } catch {
        return [];
    }
});

// Capability probe for greying out the CLAP entry point. GET /api/clap/stats →
// {clap_enabled, num_embeddings}. Available only when enabled AND embeddings
// are loaded. Fail-soft: false on any error.
ipcMain.handle(
    'audiomuse-clap-stats',
    async (_event, args: { baseUrl: string; token: string }): Promise<{ available: boolean }> => {
        if (!args.baseUrl || !args.token) return { available: false };
        try {
            const res = await fetch(`${trimBase(args.baseUrl)}/api/clap/stats`, {
                headers: { Authorization: `Bearer ${args.token}` },
            });
            if (!res.ok) return { available: false };
            const stats = (await res.json()) as Record<string, unknown>;
            // /api/clap/stats merges get_cache_stats() ({loaded, song_count, ...})
            // with clap_enabled. Available = feature on AND the embedding index is
            // loaded (song_count>0, or the explicit loaded flag).
            const enabled = stats.clap_enabled === true;
            const loaded = stats.loaded === true;
            const count = toFiniteNumber(stats.song_count) ?? 0;
            return { available: enabled && (loaded || count > 0) };
        } catch {
            return { available: false };
        }
    },
);

// /get_score returns a track's full analysis row (mood_vector, other_features,
// top_genre). Normalized to a small mood object for the visualizer; null when not
// configured, the track isn't analyzed (404), or on any error.
ipcMain.handle('audiomuse-track-mood', async (_event, args: TrackMoodArgs) => {
    if (!args.baseUrl || !args.token || !args.itemId) return null;
    try {
        const url = new URL(`${trimBase(args.baseUrl)}/get_score`);
        url.searchParams.set('id', args.itemId);

        const res = await fetch(url.toString(), {
            headers: { Authorization: `Bearer ${args.token}` },
        });
        if (!res.ok) return null;

        const row = (await res.json()) as Record<string, unknown>;
        const features = (row.other_features ?? {}) as Record<string, unknown>;

        return {
            energy: toFiniteNumber(features.energy ?? row.energy),
            moodVector: parseMoodVector(row.mood_vector),
            tempo: toFiniteNumber(features.tempo ?? row.tempo),
            topGenre: typeof row.top_genre === 'string' ? row.top_genre : undefined,
        };
    } catch {
        return null;
    }
});
