import assert from 'node:assert/strict';
import test from 'node:test';

import type { DeviceControlInput } from './device-control-state.ts';

import { deviceControlState } from './device-control-state.ts';

/**
 * F1:  node --test src/renderer/features/player/utils/device-control-state.harness.ts
 *
 * What the player bar's device control shows: nothing, the icon, "Transfer here" or
 * "Switch to <name>".
 */

const PIXEL = { id: 'pixel', name: 'Pixel 8' };

const input = (patch: Partial<DeviceControlInput> = {}): DeviceControlInput => ({
    arrival: null,
    connected: true,
    hubEnabled: true,
    localHasSong: true,
    pickerOpen: false,
    remoteActive: false,
    remoteName: 'Pixel 8',
    ...patch,
});

test('noHubIsAbsent', () => {
    assert.deepEqual(deviceControlState(input({ hubEnabled: false })), { kind: 'absent' });
    assert.deepEqual(deviceControlState(input({ connected: false })), { kind: 'absent' });
    assert.deepEqual(
        deviceControlState(input({ arrival: PIXEL, connected: false, remoteActive: true })),
        { kind: 'absent' },
    );
});

test('connectedAndQuietIsTheIcon', () => {
    assert.deepEqual(deviceControlState(input()), { kind: 'icon' });
});

test('anotherDeviceActiveIsTransferWithItsName', () => {
    assert.deepEqual(deviceControlState(input({ remoteActive: true })), {
        fromName: 'Pixel 8',
        kind: 'transfer',
    });
});

test('anArrivalWithALocalSongIsSwitch', () => {
    assert.deepEqual(deviceControlState(input({ arrival: PIXEL })), {
        kind: 'switch',
        target: PIXEL,
    });
});

test('anArrivalWithNoLocalSongIsTheIcon', () => {
    assert.deepEqual(deviceControlState(input({ arrival: PIXEL, localHasSong: false })), {
        kind: 'icon',
    });
});

test('transferBeatsSwitch', () => {
    assert.equal(
        deviceControlState(input({ arrival: PIXEL, remoteActive: true })).kind,
        'transfer',
    );
});

test('anOpenPickerIsTheIcon', () => {
    const cases: Partial<DeviceControlInput>[] = [
        {},
        { remoteActive: true },
        { arrival: PIXEL },
        { arrival: PIXEL, localHasSong: false },
        { arrival: PIXEL, remoteActive: true },
    ];
    for (const patch of cases) {
        assert.deepEqual(deviceControlState(input({ ...patch, pickerOpen: true })), {
            kind: 'icon',
        });
    }
    assert.deepEqual(deviceControlState(input({ hubEnabled: false, pickerOpen: true })), {
        kind: 'absent',
    });
});
