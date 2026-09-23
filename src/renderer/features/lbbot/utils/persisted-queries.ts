import type { Query } from '@tanstack/react-query';

/**
 * Which lb-bot answers survive a restart, and for how long.
 *
 * The react-query persister in `main.tsx` used to keep lyrics and nothing else,
 * so every lb-bot read started cold on every launch — the About section, the
 * editions and tracklist of a record you looked at yesterday, the Fresh feed
 * and the Deezer rows all waited on a hub round trip (and on lb-bot, and for
 * the first two on MusicBrainz) before painting anything. These are the reads
 * whose answer is worth showing from disk while a refetch runs behind it.
 *
 * Deliberately **not** the discography: that is the index mirror's job now, in
 * its own IndexedDB store with its own sync, and a second persisted copy would
 * be a second answer to disagree with it. Nor anything in the fill ledger's
 * orbit (`album-status`, `fills`, `gap`, `album-sources`): those are live
 * state, and a restored one is a lie about a download.
 *
 * Each entry is bounded by age. Hydrated queries are given `gcTime: Infinity`
 * (`main.tsx`'s `hydrateOptions`), so without a bound an entry restored once
 * would be written back on every persist and live forever; with it, an entry
 * nobody has refetched within the window drops out of the next snapshot.
 */
const PERSIST_FOR_MS: Record<string, number> = {
    // Editions and a release's tracklist do not change; neither, within a week,
    // does an encyclopaedia article (lb-bot itself caches those for 30 days).
    'album-releases': 7 * 24 * 60 * 60 * 1000,
    // Charts move daily; a day-old chart is a fine thing to paint while the
    // current one loads, an older one is not.
    deezer: 24 * 60 * 60 * 1000,
    'fresh-releases': 24 * 60 * 60 * 1000,
    'meta-album': 7 * 24 * 60 * 60 * 1000,
    'meta-artist': 7 * 24 * 60 * 60 * 1000,
    tracklist: 7 * 24 * 60 * 60 * 1000,
};

/**
 * `shouldDehydrateQuery` for the lb-bot keys above. Only a successful answer
 * that carries something: the hooks resolve lb-bot being unreachable to `null`
 * rather than to an error, and persisting that would restore "nothing to say"
 * on the next launch — for the `staleTime: Infinity` reads, for good.
 */
export const shouldPersistLbBotQuery = (query: Query, now = Date.now()): boolean => {
    const [scope, kind] = query.queryKey as unknown[];
    if (scope !== 'lbbot' || typeof kind !== 'string') return false;
    const window = PERSIST_FOR_MS[kind];
    if (window === undefined) return false;
    const { data, dataUpdatedAt, status } = query.state;
    return status === 'success' && data != null && now - dataUpdatedAt < window;
};
