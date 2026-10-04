import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldPersistLbBotQuery } from './persisted-queries.ts';

/**
 * A failed refetch must not drop the last good body from the next snapshot (the
 * offline behaviour the overrides map and the listening summary promise).
 *
 *     node --test src/renderer/features/lbbot/utils/persisted-queries.harness.ts
 */

const q = (kind: string, status: string, data: unknown, ageMs = 1000) =>
    ({
        queryKey: ['lbbot', kind],
        state: { data, dataUpdatedAt: Date.now() - ageMs, status },
    }) as never;

test('a success persists', () => {
    assert.equal(shouldPersistLbBotQuery(q('overrides', 'success', { byNdId: {} })), true);
});

test('an errored refetch that still holds good data keeps persisting', () => {
    assert.equal(shouldPersistLbBotQuery(q('overrides', 'error', { byNdId: {} })), true);
    assert.equal(shouldPersistLbBotQuery(q('listening-summary', 'error', { totals: {} })), true);
});

test('an error with no data, or a pending query, does not persist', () => {
    assert.equal(shouldPersistLbBotQuery(q('overrides', 'error', undefined)), false);
    assert.equal(shouldPersistLbBotQuery(q('overrides', 'pending', undefined)), false);
});

test('the age window still applies, and unlisted kinds never persist', () => {
    assert.equal(shouldPersistLbBotQuery(q('overrides', 'error', {}, 40 * 86_400_000)), false);
    assert.equal(shouldPersistLbBotQuery(q('listening-recent', 'success', {})), false);
});
