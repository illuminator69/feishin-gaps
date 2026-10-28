import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * R5:  node --test src/shared/components/animations/one-clock.harness.ts
 *
 * One gesture, one animation clock (audit A-06, B-206). Upstream's motion layer must not run beside
 * the kit's on the same gesture: lists fade once (the page's fade), the sidebar crossfade keeps the
 * grid tween's clock, the carousel pages by the kit's rise, the player bar projects no layout.
 */

const src = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, src), 'utf8');

test('listsHaveNoOwnFade', () => {
    for (const path of [
        'renderer/components/item-list/item-grid-list/item-grid-list.tsx',
        'renderer/components/item-list/item-table-list/item-table-list.tsx',
    ]) {
        assert.ok(!read(path).includes('animationProps.fadeIn'), path);
    }
});
