import assert from 'node:assert/strict';
import test from 'node:test';

import { announcementKindFor } from './fill-announce-logic.ts';

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
    assert.equal(announcementKindFor({ outcome: 'failed', state: 'failed' }), 'couldntGet');
});

test('a stalled gap placement reads needsSorting, not couldntGet', () => {
    assert.equal(
        announcementKindFor({ outcome: 'failed', stalledPlacement: true, state: 'picking' }),
        'needsSorting',
    );
});

test('an album fill in needs_match reads needsSorting, not couldntGet', () => {
    assert.equal(announcementKindFor({ outcome: 'failed', state: 'needs_match' }), 'needsSorting');
});

test('done stays done', () => {
    assert.equal(announcementKindFor({ outcome: 'done' }), 'done');
});

test('cancelled announces nothing here', () => {
    assert.equal(announcementKindFor({ outcome: 'cancelled' }), null);
});

test('needsPick and gaveUp announce nothing here either', () => {
    assert.equal(announcementKindFor({ outcome: 'needsPick' }), null);
    assert.equal(announcementKindFor({ outcome: 'gaveUp' }), null);
});

test('running (mid-flight) announces nothing', () => {
    assert.equal(announcementKindFor({ outcome: 'running' }), null);
});
