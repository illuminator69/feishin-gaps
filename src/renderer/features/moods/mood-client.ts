import { keepPreviousData, useQuery } from '@tanstack/react-query';
import isElectron from 'is-electron';

import { useCurrentServer, useHubSettings } from '/@/renderer/store';
import { logger } from '/@/renderer/utils/logger';
import { ServerType } from '/@/shared/types/domain-types';
import { MoodCatalogue, MoodListData, MoodResult } from '/@/shared/types/mood-types';

/**
 * The hub's mood routes, through the main process (`window.api.mood`), which holds the hub's
 * base and token. The web build has no bridge: no catalogue, no chips.
 */

const bridge = () => (isElectron() ? (window.api?.mood ?? null) : null);

const noBridge = <T>(): MoodResult<T> => ({
    error: 'Mood search needs the desktop app.',
    kind: 'unavailable',
    ok: false,
    status: 0,
});

export const fetchMoodCatalogue = async (): Promise<MoodResult<MoodCatalogue>> => {
    const api = bridge();
    if (!api) return noBridge();
    try {
        return await api.catalogue();
    } catch (error) {
        logger.warn('[mood] catalogue bridge failed', { error: String(error) });
        return { error: String(error), kind: 'unavailable', ok: false, status: 0 };
    }
};

export const fetchMoodList = async (
    mood: string,
    variant: string,
): Promise<MoodResult<MoodListData>> => {
    const api = bridge();
    if (!api) return noBridge();
    try {
        return await api.list({ mood, variant });
    } catch (error) {
        logger.warn('[mood] list bridge failed', { error: String(error) });
        return { error: String(error), kind: 'unavailable', ok: false, status: 0 };
    }
};

/**
 * The last catalogue the hub answered, so the chips are there in the first frame of a launch.
 * A per-viewer convenience: every access may throw (storage blocked), and then there is none.
 */
const STORAGE_KEY = 'mood-catalogue';

const readPersisted = (): MoodCatalogue | undefined => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as MoodCatalogue) : undefined;
    } catch {
        return undefined;
    }
};

const writePersisted = (catalogue: MoodCatalogue | null) => {
    try {
        if (catalogue) localStorage.setItem(STORAGE_KEY, JSON.stringify(catalogue));
        else localStorage.removeItem(STORAGE_KEY);
    } catch {
        // storage blocked: the next launch waits for the hub
    }
};

class MoodCatalogueError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

/**
 * Home's mood catalogue. Null while the hub is switched off or the server is not Navidrome (the
 * hub's ids are Navidrome's), and the persisted copy is not shown then (it is kept). An older hub
 * (absent) clears the copy; a hub that does not answer keeps it. A status-0 answer (no answer, or
 * the main process has not learned the hub settings yet on a cold start) is retried.
 */
export const useMoodCatalogue = (): {
    catalogue: MoodCatalogue | null;
    isError: boolean;
    refetch: () => void;
} => {
    const hub = useHubSettings();
    const server = useCurrentServer();
    const on = isElectron() && hub.enabled && server?.type === ServerType.NAVIDROME;

    const query = useQuery<MoodCatalogue | null>({
        enabled: on,
        initialData: readPersisted,
        // The copy is old by definition: ask the hub at once.
        initialDataUpdatedAt: 0,
        placeholderData: keepPreviousData,
        queryFn: async () => {
            const result = await fetchMoodCatalogue();
            if (result.ok) {
                writePersisted(result.data);
                return result.data;
            }
            if (result.kind === 'absent') {
                writePersisted(null);
                return null;
            }
            throw new MoodCatalogueError(result.error, result.status);
        },
        queryKey: ['moods', 'catalogue', hub.url],
        retry: (failures, error) =>
            failures < 3 && error instanceof MoodCatalogueError && error.status === 0,
        retryDelay: 1500,
        staleTime: 30_000,
    });

    if (!on) return { catalogue: null, isError: false, refetch: () => {} };
    return {
        catalogue: query.data ?? null,
        isError: query.isError,
        refetch: () => void query.refetch(),
    };
};
