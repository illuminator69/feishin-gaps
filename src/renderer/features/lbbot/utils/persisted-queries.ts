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
 * An lb-bot answer that says nothing: the IPC handlers resolve every failure to
 * `null`, and lb-bot itself answers 200 with an empty list during a MusicBrainz
 * blip (`mbz_get` returned `{}`). A release-group always has at least one
 * release, a release at least one track, and Deezer always has genres, so an
 * empty one of those is a failure wearing an answer's shape.
 *
 * Such an answer must neither be kept as fresh (the reads below are otherwise
 * `staleTime: Infinity`, so a revisit would never ask again this session) nor
 * written to disk (where it would be restored as the answer next launch).
 */
export const isLbBotNonAnswer = (queryKey: readonly unknown[], data: unknown): boolean => {
    if (data == null) return true;
    const [, kind, feed] = queryKey;
    const list = (field: string) => (data as Record<string, unknown>)[field];
    const empty = (value: unknown) => !Array.isArray(value) || value.length === 0;
    if (kind === 'album-releases') return empty(list('variants'));
    if (kind === 'tracklist') return empty(list('tracks'));
    if (kind === 'deezer' && feed === 'genres') return empty(list('genres'));
    return false;
};

/** `staleTime` for a long-lived lb-bot read: `ms` for a real answer, 0 for a
 *  {@link isLbBotNonAnswer}, so the next mount asks again. */
export const staleUnlessAnswered =
    (ms: number) =>
    (query: Pick<Query, 'queryKey' | 'state'>): number =>
        isLbBotNonAnswer(query.queryKey, query.state.data) ? 0 : ms;

/**
 * `shouldDehydrateQuery` for the lb-bot keys above. Only a successful answer
 * that carries something ({@link isLbBotNonAnswer}), and only within its window.
 *
 * Also the filter on the way back in (`main.tsx`'s `restoreClient`): the window
 * is checked when a snapshot is written, but the persister restores with
 * `maxAge: Infinity`, so without a second check a chart saved 23 h old would be
 * hydrated as current on a launch weeks later.
 */
export const shouldPersistLbBotQuery = (
    query: Pick<Query, 'queryKey' | 'state'>,
    now = Date.now(),
): boolean => {
    const [scope, kind] = query.queryKey as unknown[];
    if (scope !== 'lbbot' || typeof kind !== 'string') return false;
    const window = PERSIST_FOR_MS[kind];
    if (window === undefined) return false;
    const { data, dataUpdatedAt, status } = query.state;
    return (
        status === 'success' &&
        !isLbBotNonAnswer(query.queryKey, data) &&
        now - dataUpdatedAt < window
    );
};

/** Whether a restored query belongs to lb-bot, and so to the rule above. */
export const isLbBotQueryKey = (queryKey: readonly unknown[]): boolean => queryKey[0] === 'lbbot';
