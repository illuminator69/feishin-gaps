import assert from 'node:assert/strict';
import test from 'node:test';

import { requestStage } from './request-stage.ts';

/**
 * F7 Task 7: the request box's stage, read from the ledger row and never inferred from the page.
 *
 *     node --test src/renderer/features/discography/request-stage.harness.ts
 */

const stage = (
    row: null | { outcome?: string; settled: boolean; state?: string; verifyGaveUp?: boolean },
    over = {},
) =>
    requestStage({
        indexRowOwned: false,
        ownedAlbumId: null,
        row: row ? { outcome: 'running', state: '', ...row } : null,
        ...over,
    });

test('no row is none', () => {
    assert.equal(stage(null), 'none');
});

test('unsettled is active', () => {
    assert.equal(stage({ settled: false, state: 'searching' }), 'active');
    assert.equal(stage({ settled: false, state: 'downloading' }), 'active');
    assert.equal(stage({ settled: false, state: 'placing' }), 'active');
});

test('placed is syncing, never in the library', () => {
    assert.equal(stage({ settled: false, state: 'placed' }), 'syncing');
});

test('the settled outcomes', () => {
    assert.equal(stage({ outcome: 'failed', settled: true, state: 'failed' }), 'failed');
    assert.equal(stage({ outcome: 'cancelled', settled: true, state: 'cancelled' }), 'cancelled');
    assert.equal(stage({ outcome: 'needsPick', settled: true }), 'needsPick');
    assert.equal(stage({ outcome: 'failed', settled: true, state: 'needs_match' }), 'needsMatch');
    assert.equal(stage({ outcome: 'gaveUp', settled: true }), 'gaveUp');
    assert.equal(
        stage({ outcome: 'done', settled: true, state: 'verified', verifyGaveUp: true }),
        'syncing',
    );
    assert.equal(stage({ outcome: 'done', settled: true, state: 'verified' }), 'inLibrary');
});

test('an index row that names the album wins over an old failed row', () => {
    assert.equal(
        stage(
            { outcome: 'failed', settled: true, state: 'failed' },
            { indexRowOwned: true, ownedAlbumId: 'al-1' },
        ),
        'inLibrary',
    );
    assert.equal(stage(null, { indexRowOwned: true, ownedAlbumId: 'al-1' }), 'inLibrary');
    // Owned without an album id to open is not in the library yet.
    assert.equal(stage(null, { indexRowOwned: true, ownedAlbumId: null }), 'none');
});
