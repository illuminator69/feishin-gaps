import assert from 'node:assert/strict';
import test from 'node:test';

import { albumPageState } from './album-page-state.ts';

/**
 * F7 Task 6: the not-owned album page's shell.
 *
 *     node --test src/renderer/features/discography/album-page-state.harness.ts
 */

const base = {
    available: true,
    hasRgid: true,
    ownedAlbumId: null,
    releasesRead: 'data' as const,
    routeOlder: false,
};

test('an owned album redirects, over everything', () => {
    assert.equal(albumPageState({ ...base, ownedAlbumId: 'al-1' }), 'redirect');
    assert.equal(
        albumPageState({
            ...base,
            available: false,
            ownedAlbumId: 'al-1',
            releasesRead: 'pending',
        }),
        'redirect',
    );
});

test('lb-bot not there and nothing read is unconfigured', () => {
    assert.equal(
        albumPageState({ ...base, available: false, releasesRead: 'pending' }),
        'unconfigured',
    );
    assert.equal(
        albumPageState({ ...base, available: false, releasesRead: 'null' }),
        'unconfigured',
    );
    // Data already cached still draws.
    assert.equal(albumPageState({ ...base, available: false }), 'ready');
});

test('an older lb-bot, a read in flight, and data', () => {
    assert.equal(albumPageState({ ...base, releasesRead: 'null', routeOlder: true }), 'older');
    assert.equal(albumPageState({ ...base, releasesRead: 'pending' }), 'loading');
    assert.equal(albumPageState(base), 'ready');
    // A failed read on a current lb-bot still draws the page; the tracklist says it could not load.
    assert.equal(albumPageState({ ...base, releasesRead: 'null' }), 'ready');
});

test('a link with no release-group id is ready, and the page says so', () => {
    assert.equal(albumPageState({ ...base, hasRgid: false, releasesRead: 'pending' }), 'ready');
});
