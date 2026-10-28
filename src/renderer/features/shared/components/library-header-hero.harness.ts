import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { heroTitleSize } from './hero-title-size.ts';

/**
 * Short artist page, Task 2:  node --test src/renderer/features/shared/components/library-header-hero.harness.ts
 *
 * LibraryHeader grows an opt-in `hero` size for the artist and album boards. Without the prop every
 * page must render as before, and a short name gets the board's size while a long one steps down.
 */

test('heroTitleSizeShortIsMax', () => {
    assert.equal(heroTitleSize('Hollow Orchard', 54), '54px');
});

test('heroTitleSizeLongSteps', () => {
    const px = Number.parseFloat(heroTitleSize('A'.repeat(60), 54));
    assert.ok(px < 54, `expected a step down, got ${px}`);
    assert.ok(px >= 28, `expected at least 28, got ${px}`);
});

test('noHeroWithoutProp', () => {
    const src = readFileSync(new URL('library-header.tsx', import.meta.url), 'utf8');
    const uses = [...src.matchAll(/styles\.hero\b/g)];
    assert.ok(uses.length > 0, 'the hero class is never applied');
    for (const use of uses) {
        const before = src.slice(Math.max(0, use.index - 40), use.index);
        assert.ok(/hero\s*&&\s*$/.test(before), `styles.hero outside "hero &&": ${before}`);
    }
});
