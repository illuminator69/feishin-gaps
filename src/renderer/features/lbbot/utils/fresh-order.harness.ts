import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    FRESH_SCOPE_WORDS,
    FRESH_SHELF_SIZE,
    freshBuckets,
    freshScopeInEffect,
    freshShelf,
    freshShelfReason,
    freshTypeBucket,
    WEEK_BUCKETS,
    weekBucketFor,
} from './fresh-order.ts';

/**
 * B-286:  node --test src/renderer/features/lbbot/utils/fresh-order.harness.ts
 *
 * Home's and Discover's Fresh shelf kept owned artists' rows in feed order from a fixed 30-day
 * window, while the Fresh page read the persisted filters (window, scope, type, sort) and ordered
 * its rows in week buckets or A-Z. The page's ordering is now one pure function, and the shelf is
 * the first N rows of the very same answer, read from the same store and the same query key.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const NOW = Date.parse('2026-10-30T12:00:00Z');

interface Row {
    artist: string;
    artistOwned: boolean;
    artistPlays?: number;
    releaseDate: string;
    releaseName: string;
    type: string;
}

const row = (artist: string, releaseDate: string, patch: Partial<Row> = {}): Row => ({
    artist,
    artistOwned: true,
    releaseDate,
    releaseName: `${artist} LP`,
    type: 'Album',
    ...patch,
});

// A feed covering every case: every week bucket, an undated row, owned and unowned artists, plays
// on some rows, every type including an empty and an unknown one. In feed order (not the page's).
const FEED: Row[] = [
    row('Earl', '2026-09-01', { artistPlays: 3 }),
    row('Undated', '', { type: '' }),
    row('Thea', '2026-10-28', { artistOwned: false, artistPlays: 40, type: 'EP' }),
    row('Upco', '2026-11-05', { type: 'Single' }),
    row('Lars', '2026-10-20', { artistPlays: 12, type: 'single' }),
    row('Twon', '2026-10-14', { type: 'Broadcast' }),
    row('Abel', '2026-10-28', { type: 'ep' }),
    row('Thri', '2026-10-08', { artistOwned: false }),
    row('Zed', '2026-10-29', { artistOwned: false, type: '' }),
];

const names = (rows: readonly Row[]) => rows.map((r) => r.artist);
const flat = (buckets: { releases: Row[] }[]) => buckets.flatMap((b) => b.releases);

test('weekBucketFor: upcoming, this week back to three weeks, and an undated row sinks to Earlier', () => {
    assert.deepEqual(
        [
            '2026-11-05',
            '2026-10-28',
            '2026-10-20',
            '2026-10-14',
            '2026-10-08',
            '2026-09-01',
            '',
            'x',
        ].map((date) => weekBucketFor(date, NOW)),
        [
            'Upcoming',
            'This week',
            'Last week',
            '2 weeks ago',
            '3 weeks ago',
            'Earlier',
            'Earlier',
            'Earlier',
        ],
    );
    assert.deepEqual(
        [...WEEK_BUCKETS],
        ['Upcoming', 'This week', 'Last week', '2 weeks ago', '3 weeks ago', 'Earlier'],
    );
});

test('freshTypeBucket: the three known types any case, everything else (empty too) is other', () => {
    assert.equal(freshTypeBucket('Album'), 'album');
    assert.equal(freshTypeBucket('EP'), 'ep');
    assert.equal(freshTypeBucket('single'), 'single');
    assert.equal(freshTypeBucket(''), 'other');
    assert.equal(freshTypeBucket('Broadcast'), 'other');
    assert.equal(freshTypeBucket(undefined), 'other');
});

test('newest: week buckets newest first, newest first inside a bucket, the artist breaking ties', () => {
    const buckets = freshBuckets(FEED, { scope: 'all', sort: 'newest', type: 'all' }, NOW);
    assert.deepEqual(
        buckets.map((b) => [b.label, names(b.releases)]),
        [
            ['Upcoming', ['Upco']],
            ['This week', ['Zed', 'Abel', 'Thea']],
            ['Last week', ['Lars']],
            ['2 weeks ago', ['Twon']],
            ['3 weeks ago', ['Thri']],
            ['Earlier', ['Earl', 'Undated']],
        ],
    );
});

test('scope: mine keeps owned artists, all keeps every row', () => {
    const mine = freshBuckets(FEED, { scope: 'mine', sort: 'newest', type: 'all' }, NOW);
    assert.deepEqual(names(flat(mine)), ['Upco', 'Abel', 'Lars', 'Twon', 'Earl', 'Undated']);
    assert.equal(
        flat(freshBuckets(FEED, { scope: 'all', sort: 'newest', type: 'all' }, NOW)).length,
        9,
    );
});

test('plays: one unlabelled bucket, most played first, whatever the sort says', () => {
    for (const sort of ['newest', 'artist'] as const) {
        const buckets = freshBuckets(FEED, { scope: 'plays', sort, type: 'all' }, NOW);
        assert.deepEqual(
            buckets.map((b) => [b.label, names(b.releases)]),
            [['', ['Thea', 'Lars', 'Earl']]],
        );
    }
});

test('a stored plays scope with no plays data reads as mine, on the shelf as on the page', () => {
    const noPlays = FEED.map((r) => ({ ...r, artistPlays: undefined }));
    assert.equal(freshScopeInEffect(noPlays, 'plays'), 'mine');
    assert.equal(freshScopeInEffect(FEED, 'plays'), 'plays');
    assert.deepEqual(
        freshBuckets(noPlays, { scope: 'plays', sort: 'newest', type: 'all' }, NOW),
        freshBuckets(noPlays, { scope: 'mine', sort: 'newest', type: 'all' }, NOW),
    );
    assert.deepEqual(
        freshShelf(noPlays, { scope: 'plays', sort: 'newest', type: 'all' }, NOW),
        freshShelf(noPlays, { scope: 'mine', sort: 'newest', type: 'all' }, NOW),
    );
});

test('type: each bucket, other catching the empty and the unknown types', () => {
    const of = (type: 'album' | 'ep' | 'other' | 'single') =>
        names(flat(freshBuckets(FEED, { scope: 'all', sort: 'newest', type }, NOW)));
    assert.deepEqual(of('album'), ['Thri', 'Earl']);
    assert.deepEqual(of('ep'), ['Abel', 'Thea']);
    assert.deepEqual(of('single'), ['Upco', 'Lars']);
    assert.deepEqual(of('other'), ['Zed', 'Twon', 'Undated']);
});

test('artist: one unlabelled A-Z bucket, the release name breaking ties', () => {
    const rows = [...FEED, row('Abel', '2026-01-01', { releaseName: 'Abel Early' })];
    const buckets = freshBuckets(rows, { scope: 'all', sort: 'artist', type: 'all' }, NOW);
    assert.equal(buckets.length, 1);
    assert.equal(buckets[0].label, '');
    assert.deepEqual(
        buckets[0].releases.map((r) => r.releaseName),
        [
            'Abel Early',
            'Abel LP',
            'Earl LP',
            'Lars LP',
            'Thea LP',
            'Thri LP',
            'Twon LP',
            'Undated LP',
            'Upco LP',
            'Zed LP',
        ],
    );
});

test('nothing: no rows, or a filter leaving none, is no bucket at all', () => {
    assert.deepEqual(
        freshBuckets(undefined, { scope: 'all', sort: 'newest', type: 'all' }, NOW),
        [],
    );
    assert.deepEqual(
        freshBuckets(
            [row('Only', '2026-10-28', { artistOwned: false })],
            {
                scope: 'mine',
                sort: 'newest',
                type: 'all',
            },
            NOW,
        ),
        [],
    );
    assert.deepEqual(freshShelf([], { scope: 'all', sort: 'newest', type: 'all' }, NOW), []);
});

test('theShelfIsThePagesFirstRows, for every combination of the filters', () => {
    // A long feed so the shelf's cut matters: 60 rows across the buckets, types and owners.
    const many: Row[] = Array.from({ length: 60 }, (_, i) =>
        row(
            `A${String(i).padStart(2, '0')}`,
            i % 7 === 0
                ? ''
                : `2026-${i % 2 ? '10' : '09'}-${String((i % 28) + 1).padStart(2, '0')}`,
            {
                artistOwned: i % 3 !== 0,
                artistPlays: i % 4 === 0 ? i : undefined,
                type: ['Album', 'EP', 'Single', '', 'Other'][i % 5],
            },
        ),
    );
    assert.equal(FRESH_SHELF_SIZE, 20);
    for (const scope of ['all', 'mine', 'plays'] as const) {
        for (const type of ['all', 'album', 'ep', 'single', 'other'] as const) {
            for (const sort of ['newest', 'artist'] as const) {
                const filters = { scope, sort, type };
                const page = flat(freshBuckets(many, filters, NOW));
                const shelf = freshShelf(many, filters, NOW);
                assert.deepEqual(shelf, page.slice(0, FRESH_SHELF_SIZE), JSON.stringify(filters));
                assert.ok(shelf.length <= FRESH_SHELF_SIZE);
            }
        }
    }
});

test('theReasonFollowsTheScopeAndNamesAWindowThatIsNot30Days', () => {
    assert.equal(freshShelfReason('mine', 30), FRESH_SCOPE_WORDS.mine.reason);
    assert.match(freshShelfReason('mine', 30), /artists already in your library/);
    assert.doesNotMatch(freshShelfReason('all', 30), /in your library/);
    assert.doesNotMatch(freshShelfReason('plays', 30), /already in your library/);
    assert.doesNotMatch(freshShelfReason('mine', 30), /days/);
    assert.match(freshShelfReason('all', 7), /7 days/);
    assert.match(freshShelfReason('plays', 90), /90 days/);
    // The page's scope chips read the same words.
    assert.deepEqual(
        Object.values(FRESH_SCOPE_WORDS)
            .map((w) => w.label)
            .sort(),
        ['All', 'Artists you play', 'Your artists'],
    );
});

test('thePageAndTheShelfReadTheSameFunctionsAndTheSameQuery', () => {
    const page = read('../routes/lbbot-fresh-route.tsx');
    assert.match(page, /freshBuckets\(/);
    assert.match(page, /FRESH_SCOPE_WORDS/);
    // The ordering lives in one place now.
    assert.doesNotMatch(page, /const weekBucketFor|const WEEK_BUCKETS|const typeBucket/);
    assert.doesNotMatch(page, /'Your artists'|'Artists you play'/);

    const shelf = read('../../discover/components/fresh-row.tsx');
    assert.match(shelf, /freshShelf\(/);
    assert.match(shelf, /freshScopeInEffect\(/);
    assert.match(shelf, /freshShelfReason\(/);
    for (const hook of ['useFreshDays', 'useFreshScope', 'useFreshSort', 'useFreshType']) {
        assert.match(shelf, new RegExp(`${hook}\\(\\)`), hook);
    }
    // The page's query key for the window, never a second fixed window.
    assert.match(shelf, /useLbBotFreshReleases\(days\)/);
    assert.doesNotMatch(shelf, /useLbBotFreshReleases\(30\)/);
    assert.doesNotMatch(shelf, /\.filter\(\(r\) => r\.artistOwned\)/);
    // A placeholder answer (the previous window) is held dimmed, never shown as this window's, and
    // dropped when lb-bot cannot answer, as on the page.
    assert.match(shelf, /isPlaceholderData/);
    assert.match(shelf, /switching && !available \? undefined : query\.data/);
    assert.match(shelf, /isStale=\{switching\}/);
});
