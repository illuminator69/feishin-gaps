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

function createIDBPersister(idbValidKey: IDBValidKey = 'reactQuery') {
    return {
        persistClient: async (client: PersistedClient) => {
            set(idbValidKey, client);
        },
        removeClient: async () => {
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
