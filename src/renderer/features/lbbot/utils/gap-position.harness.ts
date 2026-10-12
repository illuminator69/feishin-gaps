import assert from 'node:assert/strict';
import test from 'node:test';

import { gapPositionLabel, gapShowsDisc } from './gap-position.ts';

/**
 * B-071: a gap with a row past its first disc numbers its rows "<disc>-<position>";
 * every other gap reads as it did.
 *
 *     node --test src/renderer/features/lbbot/utils/gap-position.harness.ts
 */

type Row = { disc: number; position: number };

/** The number column of a gap, as the modal draws it. */
const column = (tracks: Row[]): string[] => {
    const showDisc = gapShowsDisc(tracks);
    return tracks.map((track) => gapPositionLabel(track, showDisc));
};

test('a single disc (every row disc 1) reads as before', () => {
    const tracks = [
        { disc: 1, position: 1 },
        { disc: 1, position: 2 },
        { disc: 1, position: 12 },
    ];
    assert.equal(gapShowsDisc(tracks), false);
    assert.deepEqual(column(tracks), ['1', '2', '12']);
});

test('no disc field at all (an older lb-bot) reads as before', () => {
    // what main's decoder makes of the missing field
    const decoded = [
        { disc: 0, position: 1 },
        { disc: 0, position: 2 },
    ];
    assert.equal(gapShowsDisc(decoded), false);
    assert.deepEqual(column(decoded), ['1', '2']);
    // and a row that reached here with the key really absent
    const bare = [{ position: 1 }, { position: 2 }] as Row[];
    assert.equal(gapShowsDisc(bare), false);
    assert.deepEqual(column(bare), ['1', '2']);
});

test("two discs: every row names its disc, in lb-bot's order, without zero padding", () => {
    const tracks = [
        { disc: 1, position: 1 },
        { disc: 1, position: 2 },
        { disc: 2, position: 1 },
        { disc: 2, position: 2 },
    ];
    assert.equal(gapShowsDisc(tracks), true);
    assert.deepEqual(column(tracks), ['1-1', '1-2', '2-1', '2-2']);
    assert.equal(gapPositionLabel({ disc: 10, position: 12 }, true), '10-12');
});

test('a disc 0 row inside a two-disc gap keeps its bare position', () => {
    const tracks = [
        { disc: 1, position: 1 },
        { disc: 0, position: 2 },
        { disc: 2, position: 1 },
    ];
    assert.equal(gapShowsDisc(tracks), true);
    assert.deepEqual(column(tracks), ['1-1', '2', '2-1']);
});

test('showDisc false never prints a disc, whatever the row carries', () => {
    assert.equal(gapPositionLabel({ disc: 2, position: 3 }, false), '3');
});
