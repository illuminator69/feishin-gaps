import assert from 'node:assert/strict';
import test from 'node:test';

import {
    COLOUR_FADE_MS,
    flipLayers,
    type LayerPair,
    ROLE_SWITCH_MS,
    switchDelayMs,
    toneVars,
} from './colour-change.ts';
import { NEUTRAL_SEED, rolesFor } from './cover-roles.ts';

/**
 * R1 Task 1:  node --test src/renderer/themes/cover/colour-change.harness.ts
 *
 * A cover change cross-fades the wash's backdrop on two layers and switches the page's roles once, at
 * the fade's midpoint (audit A-01: easing 22 inherited colours restyled every element per frame).
 */

const eq = (a: string, b: string) => a === b;
const seed = { hue: 30, k: 0.8, meanL: 0.4 };
const TONE_KEYS = [
    '--tone-bar',
    '--tone-bot',
    '--tone-mid',
    '--tone-ov1',
    '--tone-ov2',
    '--tone-top',
];

test('theNumbers', () => {
    assert.equal(COLOUR_FADE_MS, 300);
    assert.equal(ROLE_SWITCH_MS, 150);
});

test('rolesSwitchAtTheMidpointExceptFirstAndReduced', () => {
    assert.equal(switchDelayMs({ first: true, reduced: false }), 0);
    assert.equal(switchDelayMs({ first: false, reduced: true }), 0);
    assert.equal(switchDelayMs({ first: true, reduced: true }), 0);
    assert.equal(switchDelayMs({ first: false, reduced: false }), 150);
});

test('toneVarsCarryTheBackdropAndTheVeilPerMode', () => {
    const dark = toneVars(rolesFor(seed, false), 'dark');
    assert.deepEqual(Object.keys(dark).sort(), TONE_KEYS);
    assert.equal(dark['--tone-ov1'], '78%');
    assert.equal(dark['--tone-ov2'], '86%');

    const light = toneVars(rolesFor(seed, true), 'light');
    assert.deepEqual(Object.keys(light).sort(), TONE_KEYS);
    assert.equal(light['--tone-ov1'], '50%');
    assert.equal(light['--tone-ov2'], '60%');

    const neutral = toneVars(rolesFor(NEUTRAL_SEED, false), 'neutral');
    assert.deepEqual(Object.keys(neutral).sort(), TONE_KEYS);
    assert.equal(neutral['--tone-ov1'], '100%');
    assert.equal(neutral['--tone-ov2'], '100%');
});

test('toneVarsAreFixedColoursNotReferences', () => {
    for (const [mode, light] of [
        ['dark', false],
        ['light', true],
        ['neutral', false],
    ] as const) {
        const vars = toneVars(rolesFor(seed, light), mode);
        for (const [key, value] of Object.entries(vars)) {
            assert.ok(!value.includes('var('), `${mode} ${key}: ${value}`);
        }
        // The bar keeps its alpha (0.94 dark, 0.97 light), as `--wash-bar` had it.
        assert.match(vars['--tone-bar'], light ? / \/ 0\.97\)$/ : / \/ 0\.94\)$/);
        assert.match(vars['--tone-top'], /^oklch\(/);
    }
});

test('flipLayersKeepsTheSameItem', () => {
    const pair: LayerPair<string> = { front: 0, items: ['a', null] };
    assert.equal(flipLayers(pair, 'a', eq), pair);
});

test('flipLayersPutsTheNewItemOnTheOtherSlot', () => {
    assert.deepEqual(flipLayers({ front: 0, items: ['a', null] }, 'b', eq), {
        front: 1,
        items: ['a', 'b'],
    });
});

test('aBurstAlwaysKeepsTheShownItemUnderTheNewOne', () => {
    let pair: LayerPair<string> = { front: 0, items: ['a', null] };
    pair = flipLayers(pair, 'b', eq);
    assert.deepEqual(pair, { front: 1, items: ['a', 'b'] });
    pair = flipLayers(pair, 'c', eq);
    assert.deepEqual(pair, { front: 0, items: ['c', 'b'] });
    pair = flipLayers(pair, 'd', eq);
    assert.deepEqual(pair, { front: 1, items: ['c', 'd'] });
    // Back to what is under: it comes in on top again, it is not just re-fronted.
    pair = flipLayers(pair, 'c', eq);
    assert.deepEqual(pair, { front: 0, items: ['c', 'd'] });
});
