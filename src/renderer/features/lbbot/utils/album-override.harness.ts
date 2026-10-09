import assert from 'node:assert/strict';
import test from 'node:test';

import {
    APPLY_SPEC,
    commitSentence,
    describeAlbumFailure,
    editionRows,
    extractReleaseMbid,
    GIVE_UP_MS,
    nextAfterOverride,
    outcomeSentence,
    POLL_INTERVAL_MS,
    pollStart,
    pollStep,
    poorMatchSentence,
    REMOVE_SPEC,
    STILL_WORKING,
    summarizePreview,
} from './album-override.ts';

/**
 * I-022: the "Fix album match" logic that has no React in it - the release id a
 * user pastes, the preview's three counts, the apply/remove poll as one state
 * machine, the words for each failure, and where to go afterwards.
 *
 *     node --test src/renderer/features/lbbot/utils/album-override.harness.ts
 */

const UUID = '8b0a1c1e-3d6f-4a0e-9d52-0c4f2f5b7a11';

test('extractReleaseMbid: a bare uuid, any case, surrounded by spaces', () => {
    assert.equal(extractReleaseMbid(`  ${UUID.toUpperCase()} \n`), UUID);
});

test('extractReleaseMbid: a musicbrainz.org/release url, with and without extras', () => {
    assert.equal(extractReleaseMbid(`https://musicbrainz.org/release/${UUID}`), UUID);
    assert.equal(extractReleaseMbid(`musicbrainz.org/release/${UUID}/cover-art`), UUID);
    assert.equal(extractReleaseMbid(`https://beta.musicbrainz.org/release/${UUID}?x=1#a`), UUID);
});

test('extractReleaseMbid: other entities, other hosts and junk are not a release id', () => {
    assert.equal(extractReleaseMbid(`https://musicbrainz.org/artist/${UUID}`), null);
    assert.equal(extractReleaseMbid(`https://musicbrainz.org/release-group/${UUID}`), null);
    assert.equal(extractReleaseMbid(`https://evilmusicbrainz.org/release/${UUID}`), null);
    assert.equal(extractReleaseMbid(`https://example.com/musicbrainz.org/release/${UUID}`), null);
    assert.equal(extractReleaseMbid('not a uuid'), null);
    assert.equal(extractReleaseMbid(''), null);
});

const slot = (disc: number, track: number, title: string) => ({ disc, title, track });
const file = (
    from: ReturnType<typeof slot>,
    to: null | ReturnType<typeof slot>,
    changed: boolean,
) => ({
    basis: to ? 'exact' : '',
    changed,
    from,
    to,
});

test('summarizePreview: files that change, files with no slot, tracks still missing', () => {
    const summary = summarizePreview({
        albumId: 'a',
        files: [
            file(slot(1, 1, 'A'), slot(1, 2, 'A'), true),
            file(slot(1, 2, 'B'), slot(1, 2, 'B'), false),
            file(slot(1, 3, 'C'), slot(1, 4, 'C'), true),
            file(slot(1, 9, 'Z'), null, false),
        ],
        matched: 3,
        missing: [slot(1, 1, 'X'), slot(1, 3, 'Y')],
        release: {
            country: '',
            disambiguation: '',
            discCount: 1,
            format: '',
            title: 'T',
            trackCount: 5,
            year: '',
        },
        releaseMbid: 'r',
        unmatched: 1,
    });
    assert.deepEqual(summary, {
        changing: 2,
        matched: 3,
        missing: 2,
        noSlot: 1,
        total: 4,
        unchanged: 1,
    });
});

test('summarizePreview: nothing to change is a real answer, not a missing one', () => {
    const summary = summarizePreview({
        albumId: 'a',
        files: [file(slot(1, 1, 'A'), slot(1, 1, 'A'), false)],
        matched: 1,
        missing: [],
        release: {
            country: '',
            disambiguation: '',
            discCount: 1,
            format: '',
            title: '',
            trackCount: 1,
            year: '',
        },
        releaseMbid: 'r',
        unmatched: 0,
    });
    assert.equal(summary.changing, 0);
    assert.equal(summary.unchanged, 1);
});

test('commitSentence is the one fixed sentence before apply, singular and plural', () => {
    assert.equal(
        commitSentence(12),
        'lb-bot rewrites the tags of 12 files and keeps the previous ones, so this can be undone.',
    );
    assert.equal(
        commitSentence(1),
        'lb-bot rewrites the tags of 1 file and keeps the previous ones, so this can be undone.',
    );
});

test('poorMatchSentence names both numbers', () => {
    assert.match(poorMatchSentence(3, 12), /3 of the 12 files/);
    assert.match(poorMatchSentence(3, 12), /Apply anyway/);
});

// --- the poll -------------------------------------------------------------

const row = (state: string, extra: object = {}) => ({
    album: 'A',
    albumId: '',
    artist: 'B',
    coverUrl: '',
    done: 0,
    failures: [],
    id: 'ov',
    prevReleaseMbid: '',
    releaseMbid: 'r',
    rgid: '',
    setAt: 1,
    state,
    total: 10,
    ...extra,
});
const ok = (r: ReturnType<typeof row>) => ({ ok: true as const, row: r });
const bad = (status: number, code = '') => ({ code, ok: false as const, status });

test('constants: 2 s interval, 3 minute give-up, the contract sentence', () => {
    assert.equal(POLL_INTERVAL_MS, 2000);
    assert.equal(GIVE_UP_MS, 180_000);
    assert.equal(STILL_WORKING, 'Still working — check the lb-bot data panel.');
});

test('apply poll: applying keeps going and carries the progress', () => {
    const s = pollStep(pollStart(APPLY_SPEC, 0), ok(row('applying', { done: 4 })), 2000);
    assert.equal(s.phase, 'polling');
    assert.equal(s.row?.done, 4);
});

test('apply poll: applied and failed are terminal, with the row', () => {
    const start = pollStart(APPLY_SPEC, 0);
    const applied = pollStep(start, ok(row('applied', { done: 10 })), 4000);
    assert.equal(applied.phase, 'settled');
    assert.equal(applied.row?.done, 10);
    const failed = pollStep(start, ok(row('failed')), 4000);
    assert.equal(failed.phase, 'failed');
});

test('apply poll: a failed poll is not an answer - keep polling, keep the last row', () => {
    let s = pollStep(pollStart(APPLY_SPEC, 0), ok(row('applying', { done: 2 })), 2000);
    s = pollStep(s, bad(0), 4000);
    assert.equal(s.phase, 'polling');
    assert.equal(s.row?.done, 2);
    s = pollStep(s, bad(502), 6000);
    s = pollStep(s, bad(504), 8000);
    assert.equal(s.phase, 'polling');
});

test('apply poll: a coded 404 no_override is an answer - the row is gone', () => {
    const s = pollStep(pollStart(APPLY_SPEC, 0), bad(404, 'no_override'), 2000);
    assert.equal(s.phase, 'gone');
});

test('apply poll: a code-less 404 is the hub or an older lb-bot, not an answer about the row', () => {
    const s = pollStep(pollStart(APPLY_SPEC, 0), bad(404), 2000);
    assert.equal(s.phase, 'polling');
});

test('apply poll: gives up after three minutes, whatever the last answer was', () => {
    const start = pollStart(APPLY_SPEC, 1000);
    assert.equal(pollStep(start, ok(row('applying')), 1000 + GIVE_UP_MS - 1).phase, 'polling');
    assert.equal(pollStep(start, ok(row('applying')), 1000 + GIVE_UP_MS).phase, 'timeout');
    assert.equal(pollStep(start, bad(0), 1000 + GIVE_UP_MS).phase, 'timeout');
});

test('apply poll: an answer that lands exactly at the deadline still wins over the clock', () => {
    const start = pollStart(APPLY_SPEC, 0);
    assert.equal(pollStep(start, ok(row('applied')), GIVE_UP_MS).phase, 'settled');
});

test('terminal phases do not move again', () => {
    const done = pollStep(pollStart(APPLY_SPEC, 0), ok(row('applied')), 2000);
    assert.equal(pollStep(done, ok(row('applying')), 4000).phase, 'settled');
    assert.equal(pollStep(done, bad(0), 999_999).phase, 'settled');
});

test('remove poll: 404 no_override is the finish', () => {
    let s = pollStep(pollStart(REMOVE_SPEC, 0), ok(row('removing', { done: 3 })), 2000);
    assert.equal(s.phase, 'polling');
    s = pollStep(s, bad(404, 'no_override'), 4000);
    assert.equal(s.phase, 'settled');
});

test('remove poll: a code-less 404 or a transport failure is not the finish', () => {
    assert.equal(pollStep(pollStart(REMOVE_SPEC, 0), bad(404), 2000).phase, 'polling');
    assert.equal(pollStep(pollStart(REMOVE_SPEC, 0), bad(0), 2000).phase, 'polling');
    assert.equal(pollStep(pollStart(REMOVE_SPEC, 0), bad(502), 2000).phase, 'polling');
});

test('remove poll: a row that goes back to applied/failed after removing ended without removing', () => {
    let s = pollStep(pollStart(REMOVE_SPEC, 0), ok(row('removing')), 2000);
    s = pollStep(s, ok(row('failed', { failures: [{ reason: 'busy', title: 'T' }] })), 4000);
    assert.equal(s.phase, 'failed');
    assert.equal(s.row?.failures.length, 1);
});

test('remove poll: applied/failed BEFORE removing was ever seen keeps polling', () => {
    const s = pollStep(pollStart(REMOVE_SPEC, 0), ok(row('applied')), 2000);
    assert.equal(s.phase, 'polling');
});

test('remove poll: also gives up after three minutes', () => {
    assert.equal(
        pollStep(pollStart(REMOVE_SPEC, 0), ok(row('removing')), GIVE_UP_MS).phase,
        'timeout',
    );
});

// --- failures -------------------------------------------------------------

test('describeAlbumFailure: older lb-bot is a 405 or a code-less 404, never an error text', () => {
    assert.equal(describeAlbumFailure({ error: 'x', status: 405 }).kind, 'older');
    assert.equal(describeAlbumFailure({ error: 'x', status: 404 }).kind, 'older');
    assert.equal(
        describeAlbumFailure({ code: 'unknown_album', error: 'No such album.', status: 404 }).kind,
        'answer',
    );
});

test('describeAlbumFailure: lb-bot own text is shown as is for coded answers', () => {
    const f = describeAlbumFailure({
        code: 'unknown_release',
        error: 'MusicBrainz has no such release.',
        status: 404,
    });
    assert.equal(f.message, 'MusicBrainz has no such release.');
    assert.equal(f.kind, 'answer');
    const busy = describeAlbumFailure({ code: 'busy', error: 'A fill is running.', status: 409 });
    assert.equal(busy.message, 'A fill is running.');
    const inProgress = describeAlbumFailure({
        code: 'in_progress',
        error: 'Already applying.',
        status: 409,
    });
    assert.equal(inProgress.message, 'Already applying.');
    assert.equal(describeAlbumFailure({ error: 'Bad id.', status: 400 }).message, 'Bad id.');
});

test('describeAlbumFailure: poor_match carries the counts and is its own kind', () => {
    const f = describeAlbumFailure({
        code: 'poor_match',
        error: 'Few files match.',
        matched: 3,
        status: 409,
        total: 12,
    });
    assert.equal(f.kind, 'poor_match');
    assert.equal(f.matched, 3);
    assert.equal(f.total, 12);
});

test('describeAlbumFailure: poor_match without numbers is not offered a forced retry', () => {
    const f = describeAlbumFailure({ code: 'poor_match', error: 'Few files match.', status: 409 });
    assert.equal(f.kind, 'answer');
});

test('describeAlbumFailure: a retryable 502 is retryable with lb-bot own text', () => {
    const f = describeAlbumFailure({
        error: 'MusicBrainz did not answer; nothing was written.',
        retryable: true,
        status: 502,
    });
    assert.equal(f.kind, 'retry');
    assert.match(f.message, /^MusicBrainz did not answer; nothing was written\./);
});

test('describeAlbumFailure: a 502 without retryable is the hub saying busy - also retryable, hub text', () => {
    const f = describeAlbumFailure({ error: 'lb-bot is busy or unreachable.', status: 502 });
    assert.equal(f.kind, 'retry');
});

test('describeAlbumFailure: status 0 (no hub) says so', () => {
    const f = describeAlbumFailure({ error: 'Could not reach the hub.', status: 0 });
    assert.equal(f.kind, 'retry');
    assert.equal(f.message, 'Could not reach the hub.');
});

// --- outcome ---------------------------------------------------------------

test('outcomeSentence: applied states what was written, nothing about favourites', () => {
    const text = outcomeSentence('apply', row('applied', { done: 10, total: 10 }));
    assert.equal(text, 'lb-bot wrote the tags of 10 files.');
    assert.doesNotMatch(text, /favou?rite|rating|play count/i);
});

test('outcomeSentence: partial result says how many failed', () => {
    const text = outcomeSentence(
        'apply',
        row('applied', {
            done: 8,
            failures: [
                { reason: 'r', title: 't' },
                { reason: 'r', title: 'u' },
            ],
            total: 10,
        }),
    );
    assert.match(text, /8 of 10 files/);
    assert.match(text, /2 could not be written/);
});

test('outcomeSentence: failed and removed', () => {
    assert.match(outcomeSentence('apply', row('failed', { done: 2, total: 10 })), /did not finish/);
    assert.equal(outcomeSentence('remove', null), 'lb-bot put the previous tags back.');
});

test('nextAfterOverride: the new album when lb-bot knows its id, else the artist', () => {
    assert.deepEqual(nextAfterOverride('al-9', 'ar-1'), { id: 'al-9', kind: 'album' });
    assert.deepEqual(nextAfterOverride('', 'ar-1'), { id: 'ar-1', kind: 'artist' });
    assert.deepEqual(nextAfterOverride('', ''), { kind: 'none' });
});

// --- editions --------------------------------------------------------------

const edition = (releaseMbid: string, extra: object = {}) => ({
    country: 'GB',
    coverUrl: '',
    format: 'CD',
    label: 'CD',
    releaseMbid,
    year: '1996',
    ...extra,
});

test('editionRows: flattens variants and marks the one the album is tagged as', () => {
    const rows = editionRows(
        [
            {
                coverUrl: '',
                disambiguation: '',
                editions: [edition('r1'), edition('r2', { country: 'US' })],
                releaseMbid: 'r1',
                title: 'Tigermilk',
                trackCount: 11,
                year: '1996',
            },
            {
                coverUrl: '',
                disambiguation: 'deluxe',
                editions: [],
                releaseMbid: 'r3',
                title: 'Tigermilk (deluxe)',
                trackCount: 15,
                year: '2010',
            },
        ],
        'r2',
    );
    assert.deepEqual(
        rows.map((r) => [r.releaseMbid, r.current, r.trackCount]),
        [
            ['r1', false, 11],
            ['r2', true, 11],
            ['r3', false, 15],
        ],
    );
    assert.equal(rows[1].country, 'US');
    assert.equal(rows[2].disambiguation, 'deluxe');
});

test('editionRows: an edition listed twice appears once', () => {
    const variant = (id: string) => ({
        coverUrl: '',
        disambiguation: '',
        editions: [edition(id)],
        releaseMbid: id,
        title: 'T',
        trackCount: 1,
        year: '',
    });
    assert.equal(editionRows([variant('r1'), variant('r1')], '').length, 1);
});
