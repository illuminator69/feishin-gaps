import assert from 'node:assert/strict';
import test from 'node:test';

import { logSafeStreamId } from './log-id.ts';

/** B-049:  node --test src/main/features/core/cast/log-id.harness.ts */

test('returns the id param', () => {
    assert.equal(logSafeStreamId('https://h/rest/stream?id=abc123&u=bob&t=tok&s=salt'), 'abc123');
});

test('never returns the URL or credentials when there is no id', () => {
    for (const u of [
        'https://h/rest/stream?u=bob&t=tok&s=salt',
        'not a url?t=secrettoken',
        'https://h/x?api_key=SECRET',
        '',
        null,
        undefined,
    ]) {
        const out = logSafeStreamId(u);
        assert.equal(out, '?');
    }
});
