import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { CoverSeed, Role, Roles } from './cover-roles.ts';

import { NEUTRAL_SEED, rolesFor, surfaceOver } from './cover-roles.ts';
import { composite, contrast, oklchToRgb } from './oklch.ts';

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

/**
 * F2 Task 7: the light page over the darkest possible artwork (solid black), with the wash values read
 * from the CSS itself, so this pins the file. The artwork is lifted with white, drawn at its opacity
 * over the tone gradient, then veiled with the band's role (`ov1` at the top, `ov2` from 46%); over
 * black the blur changes nothing. Measured on rendered pixels with the board's values (white lift
 * 55%), the accent on the raised surface was 4.34 at hue 120 and the error and success colours were
 * 4.45 to 4.48 on the top band; this case failed then.
 */
test('lightWashOverBlackArtKeepsTextPassing', () => {
    const css = readFileSync(
        new URL('../../layouts/default-layout/window-wash.module.css', import.meta.url),
        'utf8',
    );
    const light = /\.wash\.light\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    const num = (re: RegExp, text: string) => Number(re.exec(text)?.[1]);
    const ov1 = num(/--wash-ov1:\s*([\d.]+)%/, light) / 100;
    const ov2 = num(/--wash-ov2:\s*([\d.]+)%/, light) / 100;
    const artOpacity = num(/--wash-art-opacity:\s*([\d.]+)/, light);
    const lift = num(/rgb\(255 255 255 \/ ([\d.]+)%\)/, css) / 100;
    for (const value of [ov1, ov2, artOpacity, lift])
        assert.ok(value > 0 && value <= 1, String(value));

    for (const hue of HUES) {
        const roles = rolesFor(seed(hue), true);
        for (const [band, veil] of [
            ['top', ov1],
            ['mid', ov2],
        ] as const) {
            const tone = rgb(roles[band]);
            const art = composite(composite([1, 1, 1], [0, 0, 0], lift), tone, artOpacity);
            const page = composite(tone, art, veil);
            const raised = composite(rgb(roles.surf2), page, roles.surf2.a ?? 1);
            for (const name of ['on', 'on2', 'acc', ...STATES] as const) {
                const ratio = contrast(rgb(roles[name]), page);
                assert.ok(
                    ratio >= 4.5,
                    `${name} on ${band} over black, hue ${hue}: ${ratio.toFixed(2)}`,
                );
            }
            for (const name of ['on2', 'acc'] as const) {
                const ratio = contrast(rgb(roles[name]), raised);
                assert.ok(
                    ratio >= 4.5,
                    `${name} on raised ${band} over black, hue ${hue}: ${ratio.toFixed(2)}`,
                );
            }
        }
    }
});
