import assert from 'node:assert/strict';
import test from 'node:test';

import type { ReleaseKind } from './release-kind.ts';

import { kindLines, ownedPlayIds, popularReleases } from './artist-shelves.ts';
import { type DiscographyItem, type Ownership } from './discography-model.ts';

/**
 * The artist page's short shape: a "Popular releases" line and one line per release kind, picked
 * from the discography model's items.
 *
 *     node --test src/renderer/features/discography/artist-shelves.harness.ts
 */

const item = (over: Partial<DiscographyItem> & { key: string }): DiscographyItem => ({
    addedAt: null,
    albumId: over.ownership === 'missing' || over.ownership === 'syncing' ? null : over.key,
    fill: null,
    gap: null,
    kind: 'album' as ReleaseKind,
    ownership: 'owned' as Ownership,
    plays: 0,
    rgid: `rg-${over.key}`,
    title: over.key,
    year: 2000,
    ...over,
});

const keys = (items: DiscographyItem[]) => items.map((entry) => entry.key);

test('popularOrdersPlaysThenNewest', () => {
    const items = [
        item({ key: 'a', plays: 5, year: 2010 }),
        item({ key: 'b', plays: 9, year: 2001 }),
        item({ key: 'c', plays: 9, year: 2020 }),
    ];
    assert.deepEqual(keys(popularReleases(items, 10)), ['c', 'b', 'a']);
});

test('popularThenSyncingThenMissingAlbums', () => {
    const items = [
        item({ key: 'miss-ep', kind: 'ep', ownership: 'missing', year: 2022 }),
        item({ key: 'miss-album', ownership: 'missing', year: 2018 }),
        item({ key: 'sync', ownership: 'syncing', year: 2019 }),
        item({ key: 'own', plays: 3 }),
    ];
    assert.deepEqual(keys(popularReleases(items, 10)), ['own', 'sync', 'miss-album']);
});

test('popularLimit', () => {
    const items = Array.from({ length: 10 }, (_, i) => item({ key: `k${i}`, plays: i }));
    assert.equal(popularReleases(items, 4).length, 4);
});

test('kindLinesKeepOrderAndHide', () => {
    const items = [
        item({ key: 's1', kind: 'single' }),
        item({ key: 'e1', kind: 'ep' }),
        item({ key: 'a1', kind: 'album' }),
        item({ key: 'l1', kind: 'live' }),
    ];
    const lines = kindLines(items, ['album', 'ep', 'single'], new Set<ReleaseKind>(['single']), 5);
    assert.deepEqual(
        lines.map((line) => line.kind),
        ['album', 'ep'],
    );
    assert.deepEqual(keys(lines[0].items), ['a1']);
});

test('seeAllOnlyWhenMore', () => {
    const eps = [item({ key: 'e1', kind: 'ep' }), item({ key: 'e2', kind: 'ep' })];
    const [epLine] = kindLines(eps, ['ep'], new Set(), 5);
    assert.equal(epLine.more, false);
    assert.equal(epLine.total, 2);

    const albums = Array.from({ length: 7 }, (_, i) => item({ key: `a${i}`, year: 2000 + i }));
    const [albumLine] = kindLines(albums, ['album'], new Set(), 5);
    assert.equal(albumLine.items.length, 5);
    assert.equal(albumLine.more, true);
    assert.equal(albumLine.total, 7);
    assert.deepEqual(keys(albumLine.items), ['a6', 'a5', 'a4', 'a3', 'a2']);
});

test('fromLibraryOnlyHasNoMissing', () => {
    const items = [
        item({ key: 'a', plays: 2 }),
        item({ key: 'b', kind: 'ep', ownership: 'partly' }),
        item({ key: 'c', kind: 'single' }),
    ];
    const all = [
        ...popularReleases(items, 10),
        ...kindLines(items, ['album', 'ep', 'single'], new Set(), 10).flatMap((line) => line.items),
    ];
    assert.ok(all.length > 0);
    assert.ok(all.every((entry) => entry.ownership !== 'missing'));
});

test('playIdsDefaultView', () => {
    const items = [
        item({ key: 'id2001', year: 2001 }),
        item({ key: 'id2020', ownership: 'partly', year: 2020 }),
        item({ key: 'id2015', ownership: 'missing', year: 2015 }),
    ];
    assert.deepEqual(ownedPlayIds(items), ['id2020', 'id2001']);
});
