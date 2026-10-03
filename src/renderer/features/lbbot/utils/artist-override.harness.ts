import assert from 'node:assert/strict';
import test from 'node:test';

import {
    effectiveArtistMbid,
    overrideKind,
    overridesByNdId,
    parseMbidInput,
} from './artist-override.ts';

/**
 * I-019: the resolver every lb-bot artist call goes through, and the picker's
 * paste parser. Run directly (Node 24 strips the types, no build step):
 *
 *     node --test src/renderer/features/lbbot/utils/artist-override.harness.ts
 */

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const row = (ndArtistId: string, mbid: string, tagMbid = '') => ({
    mbid,
    name: 'X',
    ndArtistId,
    setAt: 1,
    tagMbid,
});

test('overridesByNdId keys by Navidrome id and drops rows without both ids', () => {
    const map = overridesByNdId([row('nd1', A), row('', B), row('nd3', '')]);
    assert.deepEqual(Object.keys(map), ['nd1']);
    assert.equal(map.nd1.mbid, A);
});

test('effectiveArtistMbid: an override wins over the tag', () => {
    const map = overridesByNdId([row('nd1', A, B)]);
    assert.equal(effectiveArtistMbid(map, 'nd1', B), A);
});

test('effectiveArtistMbid: an override supplies an MBID the tag lacks', () => {
    const map = overridesByNdId([row('nd1', A)]);
    assert.equal(effectiveArtistMbid(map, 'nd1', null), A);
    assert.equal(effectiveArtistMbid(map, 'nd1', undefined), A);
    assert.equal(effectiveArtistMbid(map, 'nd1', ''), A);
});

test('effectiveArtistMbid: no override falls back to the tag, unchanged', () => {
    const map = overridesByNdId([row('nd1', A)]);
    assert.equal(effectiveArtistMbid(map, 'other', B), B);
    assert.equal(effectiveArtistMbid(map, 'other', null), null);
    assert.equal(effectiveArtistMbid(undefined, 'nd1', B), B);
    assert.equal(effectiveArtistMbid({}, '', B), B);
});

test('effectiveArtistMbid: ids that collide with Object.prototype are not overrides', () => {
    assert.equal(effectiveArtistMbid({}, 'constructor', B), B);
    assert.equal(effectiveArtistMbid({}, '__proto__', B), B);
});

test('overrideKind covers the five states the entry point distinguishes', () => {
    const map = overridesByNdId([row('nd1', A, B), row('nd2', B, B)]);
    assert.equal(overrideKind(map, 'x', null), 'none');
    assert.equal(overrideKind(map, 'x', B), 'tag');
    assert.equal(overrideKind(map, 'nd1', B), 'override');
    assert.equal(overrideKind(map, 'nd2', B), 'override-same');
    assert.equal(overrideKind(overridesByNdId([row('nd1', A)]), 'nd1', null), 'override');
});

test('parseMbidInput takes a bare uuid, any case, with surrounding space', () => {
    assert.equal(parseMbidInput(`  ${A.toUpperCase()} `), A);
});

test('parseMbidInput takes a musicbrainz.org artist URL, with or without a path tail', () => {
    assert.equal(parseMbidInput(`https://musicbrainz.org/artist/${A}`), A);
    assert.equal(parseMbidInput(`musicbrainz.org/artist/${A}/details?x=1#y`), A);
    assert.equal(parseMbidInput(`https://beta.musicbrainz.org/artist/${A}`), A);
});

test('parseMbidInput refuses everything else', () => {
    assert.equal(parseMbidInput(''), null);
    assert.equal(parseMbidInput('Pink Floyd'), null);
    assert.equal(parseMbidInput(A.slice(1)), null);
    // A release or label uuid is not an artist.
    assert.equal(parseMbidInput(`https://musicbrainz.org/release/${A}`), null);
    assert.equal(parseMbidInput(`https://evil.example/artist/${A}`), null);
    assert.equal(parseMbidInput(`https://musicbrainz.org.evil.example/artist/${A}`), null);
});
