import assert from 'node:assert/strict';
import test from 'node:test';

import { announcementKindFor, announcementLinkPathFor } from './fill-announce-logic.ts';

/**
 * B-026 (Feishin half): pure-function coverage for the settled-row decision, run
 * the same way as `../index-mirror/mirror-logic.harness.ts` (Node 24 strips
 * TypeScript's erasable syntax natively — no build step, no devDependency):
 *
 *     node --test src/renderer/features/lbbot/hooks/fill-announce-logic.harness.ts
 *
 * (a `MODULE_TYPELESS_PACKAGE_JSON` warning on stderr is expected and
 * harmless — this repo's package.json has no "type" field and none should be
 * added just for this file; it does not affect the exit code.)
 */

test('a real failure (no stall, no needs_match) still reads couldntGet', () => {
    assert.equal(
        announcementKindFor({ isGap: false, outcome: 'failed', state: 'failed' }),
        'couldntGet',
    );
});

test('a stalled gap placement reads needsSorting, not couldntGet', () => {
    // lb-bot only ever sets `stalledPlacement` alongside `state: 'failed'` — it
    // never pairs it with `'picking'` (Feishin's gap watcher settles a `picking`
    // row as `needsPick`, not `failed`, before `stalledPlacement` would matter).
    assert.equal(
        announcementKindFor({
            isGap: true,
            outcome: 'failed',
            stalledPlacement: true,
            state: 'failed',
        }),
        'needsSorting',
    );
});

test('an album fill in needs_match reads needsSorting, not couldntGet', () => {
    assert.equal(
        announcementKindFor({ isGap: false, outcome: 'failed', state: 'needs_match' }),
        'needsSorting',
    );
});

test('done stays done', () => {
    assert.equal(announcementKindFor({ isGap: false, outcome: 'done' }), 'done');
});

test('cancelled announces nothing here', () => {
    assert.equal(announcementKindFor({ isGap: false, outcome: 'cancelled' }), null);
});

test('needsPick and gaveUp announce nothing here either', () => {
    assert.equal(announcementKindFor({ isGap: true, outcome: 'needsPick' }), null);
    assert.equal(announcementKindFor({ isGap: false, outcome: 'gaveUp' }), null);
});

test('running (mid-flight) announces nothing', () => {
    assert.equal(announcementKindFor({ isGap: false, outcome: 'running' }), null);
});

// --- announcementLinkPathFor -----------------------------------------------
//
// Final-review fix: an album fill's `groupId` at `needs_match` is an
// import-recovery record id (`rec<N>`), not a review-group id — lb-bot's
// `#/gaps/<id>` route 404s on it ("Group not found"). Only a gap's `groupId`
// is a real review group.

test('an album fill never gets a #/gaps link, even when it happens to carry a groupId', () => {
    assert.equal(announcementLinkPathFor({ groupId: 'rec17', isGap: false }), '#/downloads');
    assert.equal(announcementLinkPathFor({ isGap: false }), '#/downloads');
});

test('a stalled gap gets #/gaps/<groupId>', () => {
    assert.equal(announcementLinkPathFor({ groupId: 'grp-1', isGap: true }), '#/gaps/grp-1');
});

test('a gap with no groupId yet gets no link', () => {
    assert.equal(announcementLinkPathFor({ isGap: true }), '');
});

test('a groupId with characters that need escaping is encoded', () => {
    assert.equal(announcementLinkPathFor({ groupId: 'a b/c', isGap: true }), '#/gaps/a%20b%2Fc');
});
