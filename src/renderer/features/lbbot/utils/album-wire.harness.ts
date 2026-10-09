import assert from 'node:assert/strict';
import test from 'node:test';

import {
    toAlbumState,
    toCovers,
    toOverrideRow,
    toPreview,
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
