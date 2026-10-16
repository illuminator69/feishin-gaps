import assert from 'node:assert/strict';
import test from 'node:test';

import { migrateAutoplayToStations } from './autoplay-migration.ts';

/**
 * I-040:  node --test src/renderer/store/autoplay-migration.harness.ts
 *
 * Settings v35 -> v36: the fork's Auto DJ fields (`autoplaySource`, `moodCharacter`) go, the
 * slice is upstream's again, and the old preset becomes `station.character`. Every stored
 * combination of source and preset is replayed, plus the shapes an import can bring.
 */

const UPSTREAM_AUTODJ = {
    albumStrategy: 'similar',
    allowDuplicates: false,
    itemCount: 5,
    mode: 'songs',
    onlySimilar: false,
    songStrategy: 'similar',
    timing: 1,
};

const v35 = (autoplaySource: string, moodCharacter: string, enabled: boolean) => ({
    autoDJ: { ...UPSTREAM_AUTODJ, autoplaySource, enabled, moodCharacter },
    general: { untouched: true },
});

const EXPECTED_CHARACTER: Record<string, string> = {
    echo: 'close',
    steady: 'balanced',
    transition: 'explore',
};

for (const source of ['autoDj', 'fingerprint', 'moodFlow']) {
    for (const mood of ['echo', 'steady', 'transition']) {
        for (const enabled of [true, false]) {
            test(`v35 ${source} + ${mood}, ${enabled ? 'on' : 'off'}: upstream Auto DJ + ${EXPECTED_CHARACTER[mood]}`, () => {
                const state = migrateAutoplayToStations(v35(source, mood, enabled));
                assert.deepEqual(state.autoDJ, { ...UPSTREAM_AUTODJ, enabled });
                assert.deepEqual(state.station, { character: EXPECTED_CHARACTER[mood] });
                assert.deepEqual(state.general, { untouched: true });
            });
        }
    }
}

test('Mood Flow + Transition Maestro, on, lands on autoplay On + Explore (walk S6)', () => {
    const state = migrateAutoplayToStations(v35('moodFlow', 'transition', true));
    assert.equal(state.autoDJ.enabled, true);
    assert.equal(state.station.character, 'explore');
});

test('a v35 slice without the fork fields (never touched) gets Balanced', () => {
    const state = migrateAutoplayToStations({ autoDJ: { ...UPSTREAM_AUTODJ, enabled: false } });
    assert.deepEqual(state.autoDJ, { ...UPSTREAM_AUTODJ, enabled: false });
    assert.deepEqual(state.station, { character: 'balanced' });
});

test('an unknown stored preset is Balanced, not an error', () => {
    const state = migrateAutoplayToStations(v35('moodFlow', 'wobbly', true));
    assert.equal(state.station.character, 'balanced');
    assert.equal('moodCharacter' in state.autoDJ, false);
});

test('an import with no autoDJ slice at all still gets a station slice', () => {
    const state = migrateAutoplayToStations({} as { autoDJ?: Record<string, unknown> });
    assert.deepEqual(state.station, { character: 'balanced' });
    assert.equal(state.autoDJ, undefined);
});

test('a v36 file migrated again keeps its own station.character', () => {
    const state = migrateAutoplayToStations({
        autoDJ: { ...UPSTREAM_AUTODJ, enabled: true },
        station: { character: 'close' },
    });
    assert.deepEqual(state.station, { character: 'close' });
});

test('a station.character that is not one of the three is replaced from the old preset', () => {
    const state = migrateAutoplayToStations({
        autoDJ: { ...UPSTREAM_AUTODJ, enabled: true, moodCharacter: 'transition' },
        station: { character: 'EXPLORE' },
    });
    assert.deepEqual(state.station, { character: 'explore' });
});

test('the same object is returned, changed in place, as the store migration expects', () => {
    const before = v35('fingerprint', 'echo', true);
    const after = migrateAutoplayToStations(before);
    assert.equal(after, before);
});
