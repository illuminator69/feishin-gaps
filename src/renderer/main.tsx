import {
    PersistedClient,
    Persister,
    PersistQueryClientProvider,
} from '@tanstack/react-query-persist-client';
import { del, get, set } from 'idb-keyval';
import { createRoot } from 'react-dom/client';

import { App } from '/@/renderer/app';
import {
    isLbBotQueryKey,
    shouldPersistLbBotQuery,
} from '/@/renderer/features/lbbot/utils/persisted-queries';
import { queryClient } from '/@/renderer/lib/react-query';

// navi-connect (Q-010): `persistQueryClientSubscribe` calls `persistClient`
// on EVERY QueryCache/MutationCache 'added'/'removed'/'updated' event with no
// throttle of its own — `@tanstack/react-query-persist-client` 5.x dropped
// v4's `throttleTime` option entirely (checked in node_modules: neither
// `PersistQueryClientOptions` nor the provider's props carry one any more), so
// there is no library option left to pass. Each call structured-clones and
// writes the WHOLE dehydrated cache to IndexedDB, which the lb-bot reads
// (index mirror aside, still Fresh, Deezer, meta, the fill ledger) turn into
// a burst on ordinary scrolling. Throttled here instead, at the persister
// boundary: at most one write per PERSIST_THROTTLE_MS, leading edge fires
// immediately so a single change still lands promptly.
const PERSIST_THROTTLE_MS = 1_000;

function createIDBPersister(idbValidKey: IDBValidKey = 'reactQuery') {
    let lastWriteAt = 0;
    let pending: null | PersistedClient = null;
    let timer: null | ReturnType<typeof setTimeout> = null;

    const flush = () => {
        timer = null;
        if (!pending) return;
        const client = pending;
        pending = null;
        lastWriteAt = Date.now();
        set(idbValidKey, client);
    };

    return {
        persistClient: async (client: PersistedClient) => {
            pending = client;
            const elapsed = Date.now() - lastWriteAt;
            if (elapsed >= PERSIST_THROTTLE_MS) {
                flush();
            } else if (timer === null) {
                timer = setTimeout(flush, PERSIST_THROTTLE_MS - elapsed);
            }
        },
        removeClient: async () => {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
            pending = null;
            await del(idbValidKey);
        },
        restoreClient: async () => {
            const client = await get<PersistedClient>(idbValidKey);
            // navi-connect: lb-bot entries are bounded by age on the way back in
            // too — `maxAge` below is Infinity, and the snapshot's own filter
            // only ran when it was written.
            if (client?.clientState?.queries) {
                client.clientState.queries = client.clientState.queries.filter(
                    (query) => !isLbBotQueryKey(query.queryKey) || shouldPersistLbBotQuery(query),
                );
            }
            return client;
        },
    } as Persister;
}

const indexedDbPersister = createIDBPersister('feishin');

createRoot(document.getElementById('root')!).render(
    <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
            buster: 'feishin',
            dehydrateOptions: {
                shouldDehydrateQuery: (query) => {
                    const isSuccess = query.state.status === 'success';
                    const isLyricsQueryKey =
                        query.queryKey.includes('song') &&
                        query.queryKey.includes('lyrics') &&
                        query.queryKey.includes('select');

                    // navi-connect: lb-bot's slow-moving reads (meta, editions,
                    // tracklists, Fresh, Deezer) too, each bounded by age.
                    return (isSuccess && isLyricsQueryKey) || shouldPersistLbBotQuery(query);
                },
            },
            hydrateOptions: {
                defaultOptions: {
                    queries: {
                        gcTime: Infinity,
                    },
                },
            },
            maxAge: Infinity,
            persister: indexedDbPersister,
        }}
    >
        <App />
    </PersistQueryClientProvider>,
);
