import assert from 'node:assert/strict';
import test from 'node:test';

import { hashForPath, pathnameFromHash } from './leave-page.ts';

/**
 * The route the HashRouter is showing, read from `location.hash`, and the hash that
 * shows a route - the two halves of leaving a dead page without a mounted component.
 *
 *     node --test src/renderer/features/lbbot/utils/leave-page.harness.ts
 */

test('pathnameFromHash drops the # and any query or second hash', () => {
    assert.equal(pathnameFromHash('#/library/albums/al-1'), '/library/albums/al-1');
    assert.equal(pathnameFromHash('#/library/albums/al-1?x=1'), '/library/albums/al-1');
    assert.equal(pathnameFromHash('#/library/albums/al-1#top'), '/library/albums/al-1');
    assert.equal(pathnameFromHash(''), '');
    assert.equal(pathnameFromHash('#'), '');
});

test('hashForPath is the hash a HashRouter reads back as that path', () => {
    assert.equal(hashForPath('/library/albums/al-2'), '#/library/albums/al-2');
    assert.equal(
        pathnameFromHash(hashForPath('/library/album-artists/ar')),
        '/library/album-artists/ar',
    );
    assert.equal(hashForPath('library/albums'), '#/library/albums');
});
