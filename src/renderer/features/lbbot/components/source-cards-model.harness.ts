import assert from 'node:assert/strict';
import test from 'node:test';

import {
    coverageLine,
    folderName,
    initialGapSelection,
    initialSelection,
    isSafeSource,
    shownSelection,
    sourceKey,
    sourceRank,
} from './source-cards-model.ts';

/**
 * R11 (B-222): which source card a box selects on the user's behalf, and what a card says. Ported
 * from Navic's `preselectedSource` rule (RequestStageTest / GapStageTest's sources case).
 *
 *     node --test src/renderer/features/lbbot/components/source-cards-model.harness.ts
 */

const source = (over: Record<string, unknown> = {}) => ({
    albumMatchOk: true,
    artistVerified: true as boolean | undefined,
    coverage: '',
    coverageDetail: { haveTracks: 12, totalTracks: 12, unmatched: [] as string[] },
    coverageFull: true,
    folder: 'Music\\Artist\\Album (2001)',
    id: 0,
    peer: 'p',
    rank: 1,
    recommended: true,
    ...over,
});

test('safeTopIsPreselected', () => {
    assert.equal(initialSelection([source({ id: 0 }), source({ id: 1, recommended: false })]), 0);
    // The safe one wherever it sits in the list.
    assert.equal(initialSelection([source({ id: 0, recommended: false }), source({ id: 1 })]), 1);
    // A missing artistVerified is the server's own True.
    assert.equal(initialSelection([source({ artistVerified: undefined, id: 3 })]), 3);
});

test('unsafeTopIsNot', () => {
    assert.equal(initialSelection([source({ artistVerified: false })]), null);
    assert.equal(initialSelection([source({ albumMatchOk: false })]), null);
    assert.equal(initialSelection([source({ coverageFull: false })]), null);
    assert.equal(initialSelection([source({ recommended: false })]), null);
    // No fallback to "the first verified row": a default is not consent.
    assert.equal(
        initialSelection([source({ recommended: false }), source({ id: 1, recommended: false })]),
        null,
    );
});

test('emptyIsNull', () => {
    assert.equal(initialSelection([]), null);
});

test('a pick wins while it is still listed, and falls back when it is gone', () => {
    const rows = [source({ id: 0 }), source({ id: 1, recommended: false })];
    assert.equal(shownSelection(rows, 1), 1);
    assert.equal(shownSelection(rows, 7), 0);
    assert.equal(shownSelection(rows, null), 0);
    assert.equal(shownSelection([source({ albumMatchOk: false })], null), null);
});

test('isSafeSource needs all four', () => {
    assert.equal(isSafeSource(source()), true);
    assert.equal(isSafeSource(source({ artistVerified: false })), false);
});

test('the coverage line counts tracks against the release', () => {
    assert.equal(coverageLine(source()), 'All 12 tracks');
    assert.equal(
        coverageLine(source({ coverageDetail: { haveTracks: 9, totalTracks: 12, unmatched: [] } })),
        '9 of 12 tracks',
    );
    assert.equal(
        coverageLine(
            source({
                coverage: 'partial',
                coverageDetail: { haveTracks: 0, totalTracks: 0, unmatched: [] },
            }),
        ),
        'partial',
    );
});

test('rank and folder name', () => {
    assert.equal(sourceRank({ id: 4, rank: 0 }), 5);
    assert.equal(sourceRank({ id: 4, rank: 2 }), 2);
    assert.equal(folderName(source()), 'Album (2001)');
    assert.equal(folderName(source({ folder: 'a/b/c/' })), 'c');
    assert.equal(folderName(source({ folder: '' })), 'p');
});

test("a gap preselects by Navic's three terms: its sources carry no coverage", () => {
    // Review minor 4: lb-bot's gap sources have no coverageFull, so the album's rule never fired.
    assert.equal(initialGapSelection([source({ coverageFull: false, id: 2 })]), 2);
    assert.equal(initialGapSelection([source({ artistVerified: undefined, id: 3 })]), 3);
    assert.equal(initialGapSelection([source({ artistVerified: false })]), null);
    assert.equal(initialGapSelection([source({ albumMatchOk: false })]), null);
    assert.equal(initialGapSelection([source({ recommended: false })]), null);
    // A pick still wins over it, and the gap's preselection is what a box falls back to.
    const rows = [source({ coverageFull: false, id: 0 }), source({ id: 1, recommended: false })];
    assert.equal(shownSelection(rows, 1, initialGapSelection(rows)), 1);
    assert.equal(shownSelection(rows, null, initialGapSelection(rows)), 0);
    assert.equal(shownSelection(rows, null), null);
});

test('a listing is kept by the folder it lists, not by its place in one search', () => {
    // Review minor 11: after Search again, index 0 can be another folder; its old listing must
    // not show under it, and the same folder at a new index keeps what was fetched for it.
    const first = source({ folder: 'A', id: 0, peer: 'p' });
    const again = source({ folder: 'B', id: 0, peer: 'p' });
    const moved = source({ folder: 'A', id: 3, peer: 'p' });
    assert.notEqual(sourceKey(first), sourceKey(again));
    assert.equal(sourceKey(first), sourceKey(moved));
    assert.notEqual(sourceKey(first), sourceKey(source({ folder: 'A', id: 0, peer: 'q' })));
});
