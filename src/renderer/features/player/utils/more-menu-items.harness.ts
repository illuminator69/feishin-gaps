import assert from 'node:assert/strict';
import test from 'node:test';

import { moreMenuItems } from './more-menu-items.ts';

/**
 * F1:  node --test src/renderer/features/player/utils/more-menu-items.harness.ts
 *
 * The rows of the player bar's More menu, in order.
 */

const ids = (ctx: { isElectron: boolean; isRadioActive: boolean }) =>
    moreMenuItems(ctx).map((item) => item.id);

test('thePlainOrder', () => {
    assert.deepEqual(ids({ isElectron: false, isRadioActive: false }), [
        'sleepTimer',
        'equaliser',
        'lyrics',
        'playbackOptions',
        'autoDj',
        'stop',
    ]);
});

test('dlnaOnlyInElectron', () => {
    assert.deepEqual(ids({ isElectron: true, isRadioActive: false }), [
        'sleepTimer',
        'equaliser',
        'lyrics',
        'dlna',
        'playbackOptions',
        'autoDj',
        'stop',
    ]);
});

test('stopIsLastAndSeparated', () => {
    for (const isElectron of [false, true]) {
        const items = moreMenuItems({ isElectron, isRadioActive: false });
        const last = items[items.length - 1];
        assert.equal(last.id, 'stop');
        assert.equal(last.separatorBefore, true);
        assert.equal(items.filter((item) => item.separatorBefore).length, 1);
    }
});

test('panelsAndActions', () => {
    const kinds = Object.fromEntries(
        moreMenuItems({ isElectron: true, isRadioActive: false }).map((i) => [i.id, i.kind]),
    );
    assert.deepEqual(kinds, {
        autoDj: 'panel',
        dlna: 'panel',
        equaliser: 'action',
        lyrics: 'action',
        playbackOptions: 'panel',
        sleepTimer: 'panel',
        stop: 'action',
    });
});

test('radioActiveKeepsTheSameRows', () => {
    for (const isElectron of [false, true]) {
        assert.deepEqual(
            moreMenuItems({ isElectron, isRadioActive: true }),
            moreMenuItems({ isElectron, isRadioActive: false }),
        );
    }
});
