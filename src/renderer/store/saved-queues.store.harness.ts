import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

import type { SavedQueue } from './saved-queues.store.ts';

/**
 * The real store over a counting localStorage:
 *
 *     node --test src/renderer/store/saved-queues.store.harness.ts
 *
 * zustand's persist and devtools both act on EVERY `set` call, changed or not: one serializes
 * the whole history to localStorage, the other ships it to the Redux DevTools extension. So an
 * action on a hot path must not call `set` to say "nothing moved". followCursor runs on each
 * ~1 Hz hub `progress` frame; with a ~300 KB history that was ~940 MB/h into the extension's
 * worker under `pnpm dev` (3.8 GB after 4.5 h) and a full stringify per second everywhere.
 */

let writes = 0;
const data = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
    localStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        removeItem: (key: string) => data.delete(key),
        setItem: (key: string, value: string) => {
            writes += 1;
            data.set(key, value);
        },
    },
};

// Vite resolves the extensionless `lodash/merge`; node's ESM resolver wants the file.
registerHooks({
    resolve: (specifier, context, nextResolve) =>
        nextResolve(specifier === 'lodash/merge' ? 'lodash/merge.js' : specifier, context),
});

const { useSavedQueuesStore } = await import('./saved-queues.store.ts');

const song = (id: string) => ({ id, name: `Song ${id}` }) as SavedQueue['songs'][number];

const seed = (): SavedQueue => {
    const entry = {
        coverImageUrl: null,
        createdAt: 1,
        currentIndex: 0,
        currentSongId: 'a',
        currentSongName: 'Song a',
        id: 'q1',
        positionSeconds: 0,
        serverId: 's',
        songCount: 3,
        songs: [song('a'), song('b'), song('c')],
        sourceKind: 'album',
        updatedAt: 1000,
    } as SavedQueue;
    useSavedQueuesStore.getState().actions.clearAll();
    useSavedQueuesStore.getState().actions.upsert(entry);
    writes = 0;
    return entry;
};

const active = () => useSavedQueuesStore.getState().queues.find((q) => q.id === 'q1')!;

test('a progress frame on the same track writes nothing', () => {
    seed();
    const before = useSavedQueuesStore.getState();
    // Three minutes of one track: a `progress` frame per second, the index never moving.
    for (let n = 0; n < 180; n += 1) {
        before.actions.followCursor('q1', {
            currentIndex: 0,
            currentSongId: 'a',
            currentSongName: 'Song a',
        });
    }
    assert.equal(writes, 0);
    assert.equal(useSavedQueuesStore.getState(), before);
});

test('a track change writes once and keeps the history order', () => {
    seed();
    useSavedQueuesStore.getState().actions.followCursor('q1', {
        currentIndex: 2,
        currentSongId: 'c',
        currentSongName: 'Song c',
    });
    assert.equal(writes, 1);
    assert.equal(active().currentIndex, 2);
    assert.equal(active().currentSongId, 'c');
    assert.equal(active().currentSongName, 'Song c');
    assert.equal(active().updatedAt, 1000);
});

test('a cursor for a record that is not in the history writes nothing', () => {
    seed();
    useSavedQueuesStore.getState().actions.followCursor('gone', {
        currentIndex: 1,
        currentSongId: 'b',
        currentSongName: 'Song b',
    });
    assert.equal(writes, 0);
});
