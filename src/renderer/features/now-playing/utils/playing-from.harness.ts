import assert from 'node:assert/strict';
import test from 'node:test';

import type { PlayingFromInput } from './playing-from.ts';

import { playingFrom } from './playing-from.ts';

/**
 * node --test --test-reporter=tap src/renderer/features/now-playing/utils/playing-from.harness.ts
 *
 * What the side queue's header says the queue is playing from: the title, the kind, the
 * autoplay state and, while another device plays, that device. No English: the component
 * builds the sentences.
 */

const input = (over: Partial<PlayingFromInput> = {}): PlayingFromInput => ({
    autoplay: true,
    character: 'balanced',
    device: null,
    engine: true,
    kind: 'album',
    name: null,
    sourceName: 'Lantern Season',
    stationName: null,
    stationState: 'absent',
    ...over,
});

test('anAlbumQueueWithTheStationBoundContinues', () => {
    const out = playingFrom(input({ stationName: 'Lantern Season radio', stationState: 'bound' }));
    assert.deepEqual(out, {
        character: 'balanced',
        device: null,
        kind: 'album',
        state: 'continues',
        title: 'Lantern Season',
    });
});

test('aRadioShowsItsOwnNameAndRuns', () => {
    const out = playingFrom(
        input({
            kind: 'radio',
            sourceName: null,
            stationName: 'Hollow Orchard radio',
            stationState: 'bound',
        }),
    );
    assert.equal(out.kind, 'radio');
    assert.equal(out.title, 'Hollow Orchard radio');
    assert.equal(out.state, 'running');
});

test('aRadioPrefersTheStationNameOverTheSeedName', () => {
    const out = playingFrom(
        input({
            kind: 'radio',
            sourceName: 'Hollow Orchard',
            stationName: 'Hollow Orchard radio',
            stationState: 'bound',
        }),
    );
    assert.equal(out.title, 'Hollow Orchard radio');
});

test('aRadioWithoutAStationNameUsesTheSourceName', () => {
    const out = playingFrom(
        input({ kind: 'radio', sourceName: 'Hollow Orchard', stationName: null }),
    );
    assert.equal(out.title, 'Hollow Orchard');
});

test('aStoppedStationIsStopped', () => {
    const out = playingFrom(
        input({
            autoplay: false,
            kind: 'radio',
            stationName: 'Hollow Orchard radio',
            stationState: 'stopped',
        }),
    );
    assert.equal(out.state, 'stopped');
    assert.equal(out.title, 'Hollow Orchard radio');
});

test('aUserNameBeatsTheSourceName', () => {
    assert.equal(playingFrom(input({ name: 'Sunday morning' })).title, 'Sunday morning');
    assert.equal(
        playingFrom(
            input({
                kind: 'radio',
                name: 'My radio',
                stationName: 'Hollow Orchard radio',
            }),
        ).title,
        'My radio',
    );
});

test('aManualQueueWithANameKeepsIt', () => {
    const out = playingFrom(input({ kind: 'manual', name: 'Search: hollow', sourceName: null }));
    assert.equal(out.title, 'Search: hollow');
    assert.equal(out.kind, null);
});

test('aManualQueueWithNoNameSaysNothing', () => {
    const out = playingFrom(input({ kind: 'manual', name: null, sourceName: null }));
    assert.equal(out.title, null);
    assert.equal(playingFrom(input({ kind: 'manual', name: '  ', sourceName: null })).title, null);
    assert.equal(playingFrom(input({ kind: null, name: null, sourceName: null })).title, null);
});

test('anUnknownKindKeepsTheTitle', () => {
    const out = playingFrom(input({ kind: 'somethingNew', sourceName: 'Odd source' }));
    assert.equal(out.kind, null);
    assert.equal(out.title, 'Odd source');
});

test('withoutTheEngineItIsAutoDjOrOff', () => {
    assert.equal(playingFrom(input({ autoplay: true, engine: false })).state, 'autoDj');
    assert.equal(playingFrom(input({ autoplay: false, engine: false })).state, 'off');
    assert.equal(
        playingFrom(input({ autoplay: true, engine: false, stationState: 'stopped' })).state,
        'autoDj',
    );
});

test('noStationAndAutoplayOnContinues', () => {
    assert.equal(playingFrom(input({ autoplay: true, stationState: 'absent' })).state, 'continues');
});

test('noStationAndAutoplayOffIsOff', () => {
    assert.equal(playingFrom(input({ autoplay: false, stationState: 'absent' })).state, 'off');
});

test('aRemoteSessionCarriesTheDeviceName', () => {
    const out = playingFrom(
        input({ device: 'Pixel 8', name: 'Wren Songs', stationState: 'bound' }),
    );
    assert.equal(out.device, 'Pixel 8');
    assert.equal(out.title, 'Wren Songs');
    assert.equal(out.character, 'balanced');
});
