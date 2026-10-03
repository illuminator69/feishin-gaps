import assert from 'node:assert/strict';
import test from 'node:test';

import { applyFreshScope, hasArtistPlays, scopeInEffect } from './fresh-scope.ts';

/**
 * I-006: the Fresh feed's third scope, "Artists you play".
 *
 *     node --test src/renderer/features/lbbot/utils/fresh-scope.harness.ts
 */

const row = (name: string, owned: boolean, plays?: number, date = '2026-09-01') => ({
    artist: name,
    artistOwned: owned,
    releaseDate: date,
    releaseName: `${name} LP`,
    ...(plays === undefined ? {} : { artistPlays: plays }),
});

const rows = [
    row('A', true, 0),
    row('B', false, 40, '2026-09-02'),
    row('C', true, 5, '2026-09-03'),
    row('D', false, 40, '2026-09-04'),
    row('E', false, 0),
];

test('hasArtistPlays: true as soon as any row carries the field, even as 0', () => {
    assert.equal(hasArtistPlays(rows), true);
    assert.equal(hasArtistPlays([row('A', true, 0)]), true);
    assert.equal(hasArtistPlays([row('A', true), row('B', false)]), false);
    assert.equal(hasArtistPlays([]), false);
    assert.equal(hasArtistPlays(undefined), false);
});

test('plays scope keeps artistPlays > 0, most played first, newest breaking ties', () => {
    const out = applyFreshScope(rows, 'plays');
    assert.deepEqual(
        out.map((r) => r.artist),
        ['D', 'B', 'C'],
    );
});

test('a row without the field counts as 0 in the plays scope', () => {
    assert.deepEqual(applyFreshScope([row('A', true), row('B', false, 3)], 'plays').length, 1);
});

test('mine keeps owned artists, all keeps everything; neither reorders', () => {
    assert.deepEqual(
        applyFreshScope(rows, 'mine').map((r) => r.artist),
        ['A', 'C'],
    );
    assert.equal(applyFreshScope(rows, 'all').length, 5);
});

test('scopeInEffect: a stored "plays" falls back to "mine" when no row can support it', () => {
    assert.equal(scopeInEffect('plays', false), 'mine');
    assert.equal(scopeInEffect('plays', true), 'plays');
    assert.equal(scopeInEffect('all', false), 'all');
    assert.equal(scopeInEffect('mine', false), 'mine');
});
