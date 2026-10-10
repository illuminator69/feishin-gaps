import assert from 'node:assert/strict';
import test from 'node:test';

import {
    mergePreviewParams,
    mergeStartBody,
    toAlbumRows,
    toAlbumState,
    toCovers,
    toMergePreview,
    toMergeRow,
    toMergeRows,
    toOverrideRow,
    toPreview,
    toSiblingGroups,
} from '../../../../shared/utils/lbbot-album-wire.ts';

/**
 * I-022: lb-bot's album-override bodies as the main process reads them. A field
 * the body lacks is its empty value, a row without an id is not a row, and
 * nothing is invented (a missing `override` is null, which is not an empty row).
 *
 *     node --test src/renderer/features/lbbot/utils/album-wire.harness.ts
 */

const ROW = {
    album: 'Tigermilk',
    albumId: 'al-2',
    artist: 'Belle & Sebastian',
    coverUrl: '',
    done: 3,
    failures: [{ reason: 'read-only', title: 'Electronic Renaissance' }, { nope: 1 }],
    id: 'ov1',
    prevReleaseMbid: '',
    releaseMbid: 'r-new',
    rgid: 'rg1',
    setAt: 1760000000.5,
    state: 'applying',
    total: 11,
};

test('toOverrideRow keeps every field and drops a failure without a title', () => {
    const row = toOverrideRow(ROW);
    assert.ok(row);
    assert.equal(row.id, 'ov1');
    assert.equal(row.state, 'applying');
    assert.equal(row.done, 3);
    assert.equal(row.total, 11);
    assert.equal(row.setAt, 1760000000.5);
    assert.equal(row.prevReleaseMbid, '');
    assert.deepEqual(row.failures, [{ reason: 'read-only', title: 'Electronic Renaissance' }]);
});

test('toOverrideRow: no id is not a row, and null/garbage is null', () => {
    assert.equal(toOverrideRow({ ...ROW, id: '' }), null);
    assert.equal(toOverrideRow(null), null);
    assert.equal(toOverrideRow('x'), null);
});

test('toOverrideRow: absent counters are zero and absent failures are an empty list', () => {
    const row = toOverrideRow({ id: 'a', state: 'applied' });
    assert.ok(row);
    assert.equal(row.done, 0);
    assert.equal(row.total, 0);
    assert.deepEqual(row.failures, []);
    assert.equal(row.albumId, '');
});

test('toAlbumState: tracks as tagged, override null when absent', () => {
    const state = toAlbumState({
        album: 'Tigermilk',
        albumId: 'al-1',
        artist: 'Belle & Sebastian',
        override: null,
        releaseMbid: 'r1',
        rgid: '',
        tracks: [{ disc: 1, duration: 353, title: 'Keep On Lying', track: 2 }, 'junk'],
    });
    assert.equal(state.albumId, 'al-1');
    assert.equal(state.rgid, '');
    assert.equal(state.override, null);
    assert.deepEqual(state.tracks, [{ disc: 1, duration: 353, title: 'Keep On Lying', track: 2 }]);
});

test('toAlbumState: a nested override row is normalised', () => {
    const state = toAlbumState({ albumId: 'x', override: ROW });
    assert.equal(state.override?.id, 'ov1');
    assert.deepEqual(state.tracks, []);
});

test('toCovers keeps source honest and drops a cover without a full url', () => {
    const covers = toCovers({
        covers: [
            {
                full: 'https://coverartarchive.org/a.jpg',
                releaseMbid: 'r',
                source: 'release',
                thumb: 't',
            },
            {
                full: 'https://archive.org/b.jpg',
                releaseMbid: '',
                source: 'release-group',
                thumb: 't2',
            },
            { full: '', source: 'release', thumb: 't3' },
            { full: 'https://archive.org/c.jpg', source: 'weird', thumb: '' },
        ],
    });
    assert.equal(covers.length, 3);
    assert.equal(covers[0].source, 'release');
    assert.equal(covers[1].source, 'release-group');
    // An unknown source is read as the less specific one.
    assert.equal(covers[2].source, 'release-group');
    // No thumb: the full image stands in for it.
    assert.equal(covers[2].thumb, 'https://archive.org/c.jpg');
});

test('toCovers: no list is an empty list', () => {
    assert.deepEqual(toCovers({}), []);
    assert.deepEqual(toCovers(null), []);
});

const FILE_CHANGED = {
    basis: 'exact',
    changed: true,
    from: { disc: 1, title: 'Intro', track: 1 },
    to: { disc: 1, title: 'Intro', track: 2 },
};
const FILE_SAME = {
    basis: 'mbid',
    changed: false,
    from: { disc: 1, title: 'B', track: 2 },
    to: { disc: 1, title: 'B', track: 2 },
};
const FILE_NONE = {
    basis: '',
    changed: false,
    from: { disc: 1, title: 'Hidden', track: 9 },
    to: null,
};

test('toPreview: counts come from the body when it sends them', () => {
    const p = toPreview({
        albumId: 'al',
        files: [FILE_CHANGED, FILE_SAME, FILE_NONE],
        matched: 2,
        missing: [{ disc: 1, title: 'Gap', track: 5 }],
        release: {
            country: 'GB',
            discCount: 1,
            format: 'CD',
            title: 'T',
            trackCount: 11,
            year: '1996',
        },
        releaseMbid: 'r',
        unmatched: 1,
    });
    assert.equal(p.matched, 2);
    assert.equal(p.unmatched, 1);
    assert.equal(p.files.length, 3);
    assert.equal(p.files[2].to, null);
    assert.equal(p.missing.length, 1);
    assert.equal(p.release.trackCount, 11);
    assert.equal(p.release.disambiguation, '');
});

test('toPreview: absent counts are derived from the files', () => {
    const p = toPreview({ files: [FILE_CHANGED, FILE_SAME, FILE_NONE], releaseMbid: 'r' });
    assert.equal(p.matched, 2);
    assert.equal(p.unmatched, 1);
    assert.deepEqual(p.missing, []);
});

test('toPreview: a file whose `to` is not a slot has no slot', () => {
    const p = toPreview({ files: [{ ...FILE_CHANGED, to: 'oops' }] });
    assert.equal(p.files[0].to, null);
    // ...and a slot-less file cannot be a change.
    assert.equal(p.files[0].changed, false);
});

// --- I-023 / the three new /lb/overrides fields ------------------------------

test('absent is null, [] is [] - for albums, merges and siblings alike', () => {
    assert.equal(toAlbumRows(undefined), null);
    assert.equal(toAlbumRows('x'), null);
    assert.deepEqual(toAlbumRows([]), []);
    assert.equal(toMergeRows(undefined), null);
    assert.deepEqual(toMergeRows([]), []);
    assert.equal(toSiblingGroups(undefined), null);
    assert.deepEqual(toSiblingGroups([]), []);
});

test('toAlbumRows drops a row without an id, keeps the rest', () => {
    const rows = toAlbumRows([ROW, { state: 'applied' }]);
    assert.equal(rows?.length, 1);
    assert.equal(rows?.[0].id, 'ov1');
});

const MERGE = {
    done: 4,
    failures: [{ album: 'A', reason: 'ro', title: 'T' }, { album: 'x' }],
    from: { name: 'Belle and Sebastian' },
    id: 'm1',
    into: { name: 'Belle & Sebastian', ndArtistId: 'nd1' },
    mbid: 'mb',
    setAt: 1760000000,
    state: 'merging',
    total: 9,
};

test('toMergeRow: names, counters, failures; no id is no row', () => {
    const row = toMergeRow(MERGE);
    assert.ok(row);
    assert.equal(row.from.name, 'Belle and Sebastian');
    assert.equal(row.into.ndArtistId, 'nd1');
    assert.deepEqual(row.failures, [{ album: 'A', reason: 'ro', title: 'T' }]);
    assert.equal(toMergeRow({ ...MERGE, id: '' }), null);
    assert.equal(toMergeRow(null), null);
    assert.equal(toMergeRows([MERGE, 'junk'])?.length, 1);
});

test('toSiblingGroups: keeps lb-bot order, drops artists without an id and groups under two', () => {
    const groups = toSiblingGroups([
        {
            artists: [
                { albums: 7, name: 'Belle & Sebastian', ndArtistId: 'a' },
                { albums: '2', name: 'Belle and Sebastian', ndArtistId: 'b' },
                { albums: 1, name: 'ghost', ndArtistId: '' },
            ],
            mbid: 'mb',
        },
        { artists: [{ albums: 1, name: 'Solo', ndArtistId: 'c' }], mbid: 'm2' },
    ]);
    assert.equal(groups?.length, 1);
    assert.deepEqual(
        groups?.[0].artists.map((a) => [a.ndArtistId, a.albums]),
        [
            ['a', 7],
            ['b', 2],
        ],
    );
});

test('toMergePreview reads the counts and both names', () => {
    const p = toMergePreview({
        albums: 3,
        files: 31,
        from: { name: 'F', ndArtistId: 'f' },
        into: { name: 'I', ndArtistId: 'i' },
        mbid: 'mb',
        sample: [{ album: 'X', tracks: 10 }, 'junk'],
    });
    assert.equal(p.files, 31);
    assert.equal(p.into.name, 'I');
    assert.deepEqual(p.sample, [{ album: 'X', tracks: 10 }]);
});

// --- final fix wave ---------------------------------------------------------------

test('X5: collab is read off each sibling entry; absent is false', () => {
    const groups = toSiblingGroups([
        {
            artists: [
                { albums: 7, name: 'Prince', ndArtistId: 'a' },
                { albums: 2, collab: true, name: 'Prince & The Revolution', ndArtistId: 'b' },
                { albums: 1, collab: 'yes', name: 'Prince and Co', ndArtistId: 'c' },
            ],
            mbid: 'mb',
        },
    ]);
    assert.deepEqual(
        groups?.[0].artists.map((a) => [a.ndArtistId, a.collab]),
        [
            ['a', false],
            ['b', true],
            // only a real boolean true counts
            ['c', false],
        ],
    );
});

test('item 14: the merge row names the rewritten spelling by id as well when lb-bot sends it', () => {
    const merged = toMergeRow({
        from: { name: 'F', ndArtistId: 'nd-f' },
        id: 'm1',
        into: { name: 'I', ndArtistId: 'nd-i' },
        state: 'merged',
    });
    assert.equal(merged?.from.ndArtistId, 'nd-f');
    assert.equal(toMergeRow({ from: { name: 'F' }, id: 'm2' })?.from.ndArtistId, '');
});

test('Minor 13: the kept artist is nd_id, the rewritten one from_nd_id, in both bodies', () => {
    const plan = { fromNdId: 'rewritten', ndId: 'kept' };
    assert.deepEqual(mergeStartBody(plan), { from_nd_id: 'rewritten', nd_id: 'kept' });
    assert.deepEqual(mergePreviewParams(plan), { from_nd_id: 'rewritten', nd_id: 'kept' });
});
