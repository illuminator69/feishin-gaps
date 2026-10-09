import assert from 'node:assert/strict';
import test from 'node:test';

import { pickAlbumCandidate, rankAlbumCandidates } from './album-match.ts';

/**
 * Validating an album lookup against the question (`navi-connect/CLAUDE.md` §7,
 * "Never take the first hit"). The case is the measured one: Daft Punk, Discovery.
 *
 *     node --test src/renderer/features/lbbot/utils/album-match.harness.ts
 */

const cand = (artist: string, title: string, extra: object = {}) => ({
    artist,
    coverUrl: '',
    primaryType: 'Album',
    releaseAlbumId: '',
    releaseOwned: false,
    rgid: `${artist}|${title}`,
    score: 100,
    title,
    year: '',
    ...extra,
});

const ASKED = { artist: 'Daft Punk', title: 'Discovery' };

test('the parody that ranks first is not the answer', () => {
    const picked = pickAlbumCandidate(
        [
            cand('Pignickel', "Daft Punk's Discovery but it's in the SM64 Soundfont"),
            cand('Daft Punk', 'Discovery'),
        ],
        ASKED,
    );
    assert.equal(picked?.artist, 'Daft Punk');
});

test('survivors: owned first, then no bracketed qualifier, then lb-bot order', () => {
    const ranked = rankAlbumCandidates(
        [
            cand('Daft Punk', 'Discovery (Beta Version)'),
            cand('Daft Punk', 'Discovery (Sample Bandit Bootlegs)', { releaseOwned: true }),
            cand('Daft Punk', 'Discovery'),
        ],
        ASKED,
    );
    assert.deepEqual(
        ranked.map((row) => row.title),
        ['Discovery (Sample Bandit Bootlegs)', 'Discovery', 'Discovery (Beta Version)'],
    );
    const unowned = rankAlbumCandidates(
        [cand('Daft Punk', 'Discovery (Beta Version)'), cand('Daft Punk', 'Discovery')],
        ASKED,
    );
    assert.equal(unowned[0].title, 'Discovery');
});

test('nothing valid is a decline, not a guess', () => {
    assert.equal(pickAlbumCandidate([cand('Pink', 'Discovery')], ASKED), null);
    assert.equal(pickAlbumCandidate([], ASKED), null);
});

test('an artist that only contains the asked one does not match', () => {
    assert.equal(
        pickAlbumCandidate([cand('Pink Floyd', 'The Wall')], { artist: 'Pink', title: 'The Wall' }),
        null,
    );
});
