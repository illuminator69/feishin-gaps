import assert from 'node:assert/strict';
import test from 'node:test';

import type { CoverSeed, Role, Roles } from './cover-roles.ts';

import { NEUTRAL_SEED, rolesFor, surfaceOver } from './cover-roles.ts';
import { contrast, oklchToRgb } from './oklch.ts';

/**
 * F2 Task 1:  node --test src/renderer/themes/cover/cover-roles.harness.ts
 *
 * The cover role table, checked against the Colour board's contrast table (hue 40, tolerance
 * 0.15; the board's model: chroma reduced into gamut, raised surface composited in
 * gamma-encoded sRGB, WCAG 2.x) and over hues 0 to 350 in both modes.
 */

const BANDS = ['top', 'mid', 'bot'] as const;
const HUES = Array.from({ length: 36 }, (_, i) => i * 10);
const TOLERANCE = 0.15;

/** The roles that follow the seed; `light` is a flag and `warn`, `bad`, `good` are constants. */
const SEEDED = [
    'acc',
    'accc',
    'accct',
    'accOn',
    'bar',
    'bot',
    'line',
    'mid',
    'on',
    'on2',
    'surf',
    'surf2',
    'top',
] as const;
const STATES = ['warn', 'bad', 'good'] as const;

const seed = (hue: number): CoverSeed => ({ hue, k: 1, meanL: 0.5 });
const rgb = (role: Role) => oklchToRgb(role);

const onBands = (roles: Roles, text: Role) => BANDS.map((b) => contrast(rgb(text), rgb(roles[b])));
const onRaised = (roles: Roles, text: Role) =>
    BANDS.map((b) => contrast(rgb(text), surfaceOver(roles, b, true)));

const near = (label: string, got: number[], want: number[]) => {
    got.forEach((value, i) => {
        assert.ok(
            Math.abs(value - want[i]) <= TOLERANCE,
            `${label}: got ${got.map((v) => v.toFixed(2)).join(' / ')}, board ${want.join(' / ')}`,
        );
    });
};

const atLeast = (label: string, got: number[], min: number) => {
    got.forEach((value, i) => {
        assert.ok(value >= min, `${label} ${BANDS[i]}: ${value.toFixed(2)} < ${min}`);
    });
};

// --- The board's table at hue 40 -----------------------------------------------------------

test('darkHue40MatchesTheBoard', () => {
    const roles = rolesFor(seed(40), false);
    near('secondary on bands', onBands(roles, roles.on2), [8.5, 11.0, 13.9]);
    near('secondary on raised', onRaised(roles, roles.on2), [6.0, 7.5, 9.8]);
    near('accent on bands', onBands(roles, roles.acc), [7.7, 9.9, 12.5]);
    near('accent on raised', onRaised(roles, roles.acc), [5.4, 6.7, 8.8]);
});

test('lightHue40MatchesTheBoard', () => {
    const roles = rolesFor(seed(40), true);
    near('secondary on bands', onBands(roles, roles.on2), [9.5, 8.6, 6.6]);
    near('secondary on raised', onRaised(roles, roles.on2), [7.5, 6.8, 5.3]);
    near('accent on bands', onBands(roles, roles.acc), [8.7, 7.9, 6.1]);
    near('accent on raised', onRaised(roles, roles.acc), [6.8, 6.3, 4.9]);
});

test('labelOnAccentAndContainerMatchTheBoard', () => {
    for (const [light, want] of [
        [false, [12.5, 6.4]],
        [true, [10.1, 8.0]],
    ] as const) {
        const roles = rolesFor(seed(40), light);
        near(
            light ? 'light' : 'dark',
            [
                contrast(rgb(roles.accOn), rgb(roles.acc)),
                contrast(rgb(roles.accct), rgb(roles.accc)),
            ],
            [...want],
        );
    }
});

// --- Every hue, both modes -----------------------------------------------------------------

for (const light of [false, true]) {
    const mode = light ? 'light' : 'dark';

    test(`secondaryOnRaisedPasses (${mode})`, () => {
        for (const hue of HUES) {
            const roles = rolesFor(seed(hue), light);
            atLeast(`hue ${hue}`, onRaised(roles, roles.on2), 4.5);
        }
    });

    test(`accentAsTextOnRaisedPasses (${mode})`, () => {
        for (const hue of HUES) {
            const roles = rolesFor(seed(hue), light);
            atLeast(`hue ${hue}`, onRaised(roles, roles.acc), 4.5);
        }
    });

    test(`textOnEveryBandPasses (${mode})`, () => {
        for (const hue of HUES) {
            const roles = rolesFor(seed(hue), light);
            atLeast(`hue ${hue}`, onBands(roles, roles.on), 4.5);
        }
    });

    test(`stateColoursPassOnEveryBand (${mode})`, () => {
        for (const hue of HUES) {
            const roles = rolesFor(seed(hue), light);
            for (const state of STATES) {
                atLeast(`${state} hue ${hue}`, onBands(roles, roles[state]), 4.5);
            }
        }
    });
}

// --- The seed --------------------------------------------------------------------------------

test('achromaticSeedHasNoChroma', () => {
    for (const light of [false, true]) {
        const roles = rolesFor({ hue: 40, k: 0, meanL: 0.5 }, light);
        for (const name of SEEDED) assert.equal(roles[name].c, 0, `${name} (light ${light})`);
    }
});

test('neutralSeedScalesChroma', () => {
    for (const light of [false, true]) {
        const coloured = rolesFor({ ...NEUTRAL_SEED, k: 1 }, light);
        const neutral = rolesFor(NEUTRAL_SEED, light);
        for (const name of SEEDED) {
            assert.ok(
                Math.abs(neutral[name].c - coloured[name].c * 0.22) < 1e-12,
                `${name} (light ${light})`,
            );
        }
        for (const name of STATES) assert.deepEqual(neutral[name], coloured[name]);
    }
});

test('hueIsTheSeedsHue', () => {
    for (const light of [false, true]) {
        const roles = rolesFor({ hue: 123, k: 1, meanL: 0.5 }, light);
        for (const name of SEEDED) assert.equal(roles[name].h, 123, `${name} (light ${light})`);
        assert.equal(roles.light, light);
    }
});
