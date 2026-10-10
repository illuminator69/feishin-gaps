import assert from 'node:assert/strict';
import test from 'node:test';

import {
    albumLook,
    artistLook,
    currentSection,
    landingSection,
    matchSections,
    mergedLook,
} from './matches-page.ts';

/**
 * The Library Matches page's pure decisions: which sections are offered, which one
 * the user lands on, and what each row shows for its cover and whether it is a link.
 *
 *     node --test src/renderer/features/lbbot/utils/matches-page.harness.ts
 */

const all = { albums: 2, artists: 5, merges: 1, toCheck: 106 };

test('sections: four in a fixed order, each with its count', () => {
    assert.deepEqual(
        matchSections(all).map((s) => [s.id, s.label, s.count]),
        [
            ['to-check', 'To check', 106],
            ['artists', 'Artists', 5],
            ['albums', 'Albums', 2],
            ['merged', 'Merged names', 1],
        ],
    );
});

test('sections: a list lb-bot did not send (null = unknown) is not offered; an empty one (0) is', () => {
    const offered = matchSections({ albums: null, artists: 0, merges: null, toCheck: null });
    assert.deepEqual(
        offered.map((s) => [s.id, s.count]),
        [['artists', 0]],
    );
});

test('landing: To check when it is not empty, else Artists', () => {
    assert.equal(landingSection(all), 'to-check');
    assert.equal(landingSection({ ...all, toCheck: 0 }), 'artists');
    assert.equal(landingSection({ ...all, toCheck: null }), 'artists');
});

test('landing: Artists even when empty if it is offered; else the first offered section; else none', () => {
    assert.equal(landingSection({ albums: 3, artists: 0, merges: 0, toCheck: 0 }), 'artists');
    assert.equal(landingSection({ albums: 3, artists: null, merges: 1, toCheck: 0 }), 'to-check');
    assert.equal(landingSection({ albums: 3, artists: null, merges: 1, toCheck: null }), 'albums');
    assert.equal(
        landingSection({ albums: null, artists: null, merges: null, toCheck: null }),
        null,
    );
});

test('currentSection: the chosen one while it is offered, else the landing one', () => {
    assert.equal(currentSection('albums', all), 'albums');
    assert.equal(currentSection(null, all), 'to-check');
    // an offered section that became unavailable falls back
    assert.equal(currentSection('merged', { ...all, merges: null }), 'to-check');
    assert.equal(
        currentSection('albums', { albums: null, artists: 2, merges: null, toCheck: null }),
        'artists',
    );
});

test('artist rows: the image and the link come from the id the row already carries', () => {
    assert.deepEqual(artistLook({ alive: true, ndArtistId: 'nd1' }), {
        imageId: 'nd1',
        imageUrl: null,
        linkId: 'nd1',
    });
});

test('artist rows: an artist gone from the library shows the placeholder and is not a link', () => {
    assert.deepEqual(artistLook({ alive: false, ndArtistId: 'nd1' }), {
        imageId: null,
        imageUrl: null,
        linkId: null,
    });
    assert.deepEqual(artistLook({ alive: true, ndArtistId: '' }), {
        imageId: null,
        imageUrl: null,
        linkId: null,
    });
});

test('album rows: a known album id is the cover and the link', () => {
    assert.deepEqual(albumLook({ albumId: 'al-9', coverUrl: 'https://c/x.jpg' }), {
        imageId: 'al-9',
        imageUrl: null,
        linkId: 'al-9',
    });
});

test('album rows: no id yet shows the cover lb-bot was given, else the placeholder; never a link', () => {
    assert.deepEqual(albumLook({ albumId: '', coverUrl: 'https://coverartarchive.org/x.jpg' }), {
        imageId: null,
        imageUrl: 'https://coverartarchive.org/x.jpg',
        linkId: null,
    });
    assert.deepEqual(albumLook({ albumId: '', coverUrl: '' }), {
        imageId: null,
        imageUrl: null,
        linkId: null,
    });
});

test('merged rows: the kept artist is shown and linked (the rewritten spelling is gone)', () => {
    assert.deepEqual(mergedLook({ into: { name: 'Belle & Sebastian', ndArtistId: 'nd1' } }), {
        imageId: 'nd1',
        imageUrl: null,
        linkId: 'nd1',
    });
    assert.deepEqual(mergedLook({ into: { name: '', ndArtistId: '' } }), {
        imageId: null,
        imageUrl: null,
        linkId: null,
    });
});
