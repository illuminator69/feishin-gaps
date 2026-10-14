import assert from 'node:assert/strict';
import test from 'node:test';

import type { RowDevice, RowSession } from './device-rows.ts';

import {
    deviceIcon,
    deviceStatus,
    deviceStatusLabel,
    rowTakesVolume,
    sortDeviceRows,
} from './device-rows.ts';

/**
 * I-032:  node --test src/renderer/features/hub/utils/device-rows.harness.ts
 *
 * The device picker's rows, from a `devices` frame and the session the hub store holds: which
 * icon, in what order, saying what.
 */

const ME = 'desk';

const device = (id: string, name: string, patch: Partial<RowDevice> = {}): RowDevice => ({
    id,
    name,
    online: true,
    ...patch,
});

const session = (patch: Partial<RowSession> = {}): RowSession => ({
    activeDeviceId: null,
    isPlaying: false,
    myDeviceId: ME,
    ...patch,
});

const ids = (rows: RowDevice[]) => rows.map((row) => row.id);

// --- Icon ------------------------------------------------------------------------------------

test('every kind the protocol names has its own icon', () => {
    assert.equal(deviceIcon('computer'), 'deviceComputer');
    assert.equal(deviceIcon('phone'), 'devicePhone');
    assert.equal(deviceIcon('tablet'), 'deviceTablet');
    assert.equal(deviceIcon('speaker'), 'deviceSpeaker');
    assert.equal(deviceIcon('tv'), 'deviceTv');
    assert.equal(deviceIcon('group'), 'deviceGroup');
});

test('a kind this build does not know, or none, draws the generic icon', () => {
    assert.equal(deviceIcon('watch'), 'deviceGeneric', 'a later protocol value');
    assert.equal(deviceIcon(undefined), 'deviceGeneric', 'an older client sends none');
    assert.equal(deviceIcon(null), 'deviceGeneric');
    assert.equal(deviceIcon(''), 'deviceGeneric');
    assert.equal(deviceIcon('TV'), 'deviceGeneric', 'the hub relays lowercase only');
    assert.equal(deviceIcon('constructor'), 'deviceGeneric');
    assert.equal(deviceIcon(7), 'deviceGeneric');
});

// --- Order -----------------------------------------------------------------------------------

test('the playing device, this device, the rest by name, then the ones that cannot be played to', () => {
    const rows = sortDeviceRows(
        [
            device('tv', 'Living room TV', { reachable: false }),
            device('zoe', 'zoe phone'),
            device(ME, 'Workstation'),
            device('old', 'Bedroom tablet', { online: false }),
            device('amp', 'Amp'),
            device('kit', 'Kitchen speaker'),
        ],
        session({ activeDeviceId: 'kit' }),
    );
    assert.deepEqual(ids(rows), ['kit', ME, 'amp', 'zoe', 'old', 'tv']);
});

test('names are ordered without regard to case', () => {
    const rows = sortDeviceRows(
        [device('c', 'charlie'), device('b', 'Bravo'), device('a', 'alpha'), device('d', 'Delta')],
        session(),
    );
    assert.deepEqual(ids(rows), ['a', 'b', 'c', 'd']);
});

test('this device is first when the session is on it, and listed once', () => {
    const rows = sortDeviceRows(
        [device('amp', 'Amp'), device(ME, 'Workstation')],
        session({ activeDeviceId: ME }),
    );
    assert.deepEqual(ids(rows), [ME, 'amp']);
});

test('with nothing playing this device leads', () => {
    const rows = sortDeviceRows([device('amp', 'Amp'), device(ME, 'Workstation')], session());
    assert.deepEqual(ids(rows), [ME, 'amp']);
});

test('the session stays on top when its device stops responding', () => {
    // The hub lets go of the slot when a bridge reports its speaker gone; until that frame the
    // row is still the one that says where the music is.
    const rows = sortDeviceRows(
        [device('amp', 'Amp'), device('tv', 'TV', { reachable: false })],
        session({ activeDeviceId: 'tv' }),
    );
    assert.deepEqual(ids(rows), ['tv', 'amp']);
});

test('a bridge that has not said yet counts as responding', () => {
    const rows = sortDeviceRows(
        [device('b', 'Bravo', { reachable: null }), device('a', 'Alpha', { reachable: true })],
        session(),
    );
    assert.deepEqual(ids(rows), ['a', 'b']);
});

test('two devices of one name never swap places between frames', () => {
    const one = [device('p2', 'Pixel'), device('p1', 'Pixel')];
    const other = [device('p1', 'Pixel'), device('p2', 'Pixel')];
    assert.deepEqual(ids(sortDeviceRows(one, session())), ['p1', 'p2']);
    assert.deepEqual(ids(sortDeviceRows(other, session())), ['p1', 'p2']);
});

test('sorting leaves the list it was given alone', () => {
    const given = [device('b', 'Bravo'), device('a', 'Alpha')];
    sortDeviceRows(given, session());
    assert.deepEqual(ids(given), ['b', 'a']);
});

// --- Status ----------------------------------------------------------------------------------

test('the device the session is on reads "playing" only while the session plays', () => {
    const kit = device('kit', 'Kitchen speaker');
    assert.equal(deviceStatus(kit, session({ activeDeviceId: 'kit', isPlaying: true })), 'playing');
    assert.equal(deviceStatus(kit, session({ activeDeviceId: 'kit' })), 'paused');
    assert.equal(deviceStatusLabel('paused'), 'paused');
});

test('this device says so, unless the session is on it', () => {
    const me = device(ME, 'Workstation');
    assert.equal(deviceStatus(me, session()), 'thisDevice');
    assert.equal(deviceStatus(me, session({ activeDeviceId: 'kit' })), 'thisDevice');
    assert.equal(deviceStatus(me, session({ activeDeviceId: ME })), 'paused');
    assert.equal(deviceStatus(me, session({ activeDeviceId: ME, isPlaying: true })), 'playing');
});

test('another device is available, not responding or offline', () => {
    const s = session({ activeDeviceId: 'kit', isPlaying: true });
    assert.equal(deviceStatus(device('amp', 'Amp'), s), 'available');
    assert.equal(deviceStatus(device('amp', 'Amp', { reachable: null }), s), 'available');
    assert.equal(deviceStatus(device('tv', 'TV', { reachable: false }), s), 'notResponding');
    assert.equal(deviceStatus(device('old', 'Tablet', { online: false }), s), 'offline');
    // Offline with a stale verdict: the socket is gone, which is all there is to say.
    assert.equal(
        deviceStatus(device('old', 'TV', { online: false, reachable: false }), s),
        'offline',
    );
});

test('a refused target says so in place of "available", never in place of the session', () => {
    const s = session({ activeDeviceId: 'tv', isPlaying: true });
    assert.equal(deviceStatus(device('amp', 'Amp'), s, true), 'blocked');
    assert.equal(deviceStatus(device('tv', 'TV'), s, true), 'playing');
    assert.equal(
        deviceStatus(device('gone', 'TV 2', { reachable: false }), s, true),
        'notResponding',
    );
});

test('every status but the refusal has its wording', () => {
    assert.deepEqual(
        (['playing', 'paused', 'thisDevice', 'available', 'notResponding', 'offline'] as const).map(
            deviceStatusLabel,
        ),
        ['playing', 'paused', 'this device', 'available', 'not responding', 'offline'],
    );
});

// --- The volume slider of a device that is not playing ---------------------------------------

const TARGETS = ['cmdEcho', 'actAck', 'volumeTarget', 'sleepTimer'];
const idle = (id: string, patch: Partial<RowDevice> = {}) =>
    device(id, id, { caps: ['receiver', 'idleVolume'], ...patch });

test('a reachable device that takes a level while idle gets a slider', () => {
    const s = session({ activeDeviceId: 'kit', isPlaying: true });
    assert.equal(rowTakesVolume(idle('phone'), s, TARGETS), true);
    assert.equal(rowTakesVolume(idle('tv', { reachable: true }), s, TARGETS), true);
    assert.equal(rowTakesVolume(idle('tv', { reachable: null }), s, TARGETS), true);
    assert.equal(rowTakesVolume(idle('phone'), session(), TARGETS), true, 'nothing playing');
});

test('the device the session is on keeps its slider in its row, playing or paused, on any hub', () => {
    assert.equal(
        rowTakesVolume(idle('kit'), session({ activeDeviceId: 'kit', isPlaying: true }), TARGETS),
        true,
    );
    assert.equal(rowTakesVolume(idle('kit'), session({ activeDeviceId: 'kit' }), TARGETS), true);
    assert.equal(
        rowTakesVolume(device('kit', 'Kit'), session({ activeDeviceId: 'kit' }), []),
        true,
    );
    // Not this device's own row, even while it plays.
    assert.equal(rowTakesVolume(idle(ME), session({ activeDeviceId: ME }), TARGETS), false);
});

test('not this device', () => {
    assert.equal(rowTakesVolume(idle(ME), session({ activeDeviceId: 'kit' }), TARGETS), false);
    assert.equal(rowTakesVolume(idle(ME), session(), TARGETS), false);
});

test('not a device that did not say it applies a level while idle', () => {
    const s = session({ activeDeviceId: 'kit' });
    assert.equal(
        rowTakesVolume(device('cast', 'Speaker', { caps: ['receiver'] }), s, TARGETS),
        false,
    );
    assert.equal(rowTakesVolume(device('old', 'Old client'), s, TARGETS), false, 'no caps at all');
});

test('not a device that cannot be reached', () => {
    const s = session({ activeDeviceId: 'kit' });
    assert.equal(rowTakesVolume(idle('tv', { reachable: false }), s, TARGETS), false);
    assert.equal(rowTakesVolume(idle('phone', { online: false }), s, TARGETS), false);
});

test('not against a hub that would set the active device instead', () => {
    const s = session({ activeDeviceId: 'kit' });
    assert.equal(rowTakesVolume(idle('phone'), s, ['cmdEcho', 'actAck']), false);
    assert.equal(rowTakesVolume(idle('phone'), s, []), false, 'an older hub, or no connection');
});
