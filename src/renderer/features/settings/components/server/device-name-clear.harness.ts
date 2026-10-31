import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_DEVICE_NAME, resolveDeviceName, resolvePublicServerUrl } from './hub-fields.ts';

/**
 * F2:  node --test src/renderer/features/settings/components/server/device-name-clear.harness.ts
 *
 * Two field bugs of the old hub section (audit finding 4). Clearing "Device name" kept the old
 * name in the store while the field showed blank; a rejected Public server URL stayed in the field
 * while the store kept the old value. In both the field must end up showing what is stored.
 */

test('clearingTheDeviceNameRestoresTheDefaultInTheFieldAndTheStore', () => {
    const r = resolveDeviceName('', 'Desk');
    assert.equal(r.draft, DEFAULT_DEVICE_NAME);
    assert.equal(r.name, DEFAULT_DEVICE_NAME);
    assert.equal(r.changed, true);
});

test('aNameOfOnlySpacesCountsAsCleared', () => {
    const r = resolveDeviceName('   ', 'Desk');
    assert.equal(r.draft, DEFAULT_DEVICE_NAME);
    assert.equal(r.name, DEFAULT_DEVICE_NAME);
});

test('clearingWhileTheNameIsAlreadyTheDefaultChangesNothingButStillFillsTheField', () => {
    const r = resolveDeviceName('', DEFAULT_DEVICE_NAME);
    assert.equal(r.draft, DEFAULT_DEVICE_NAME);
    assert.equal(r.changed, false);
});

test('aTypedNameIsTrimmedShownAndStored', () => {
    const r = resolveDeviceName('  Living room PC ', 'Desk');
    assert.deepEqual(r, { changed: true, draft: 'Living room PC', name: 'Living room PC' });
    assert.equal(resolveDeviceName('Desk', 'Desk').changed, false);
});

const HUB = 'ws://192.168.1.10:4790';

test('aPublicUrlThatIsTheHubIsRejectedAndTheFieldGoesBackToTheStoredValue', () => {
    const r = resolvePublicServerUrl('http://192.168.1.10:4533', 'https://music.example.com', HUB);
    assert.equal(r.error, 'hub');
    assert.equal(r.draft, 'https://music.example.com');
    assert.equal(r.value, 'https://music.example.com');
    assert.equal(r.changed, false);
});

test('aRejectedPublicUrlWithNothingStoredGoesBackToEmpty', () => {
    const r = resolvePublicServerUrl('http://192.168.1.10:4533', '', HUB);
    assert.equal(r.error, 'hub');
    assert.equal(r.draft, '');
});

test('aPublicUrlThatIsNotAWebAddressIsRejectedToo', () => {
    const r = resolvePublicServerUrl('music dot example', 'https://music.example.com', HUB);
    assert.equal(r.error, 'invalid');
    assert.equal(r.draft, 'https://music.example.com');
});

test('anUnparseableHubAddressDoesNotMakeEveryPublicUrlTheHub', () => {
    // both hosts null used to compare equal and reject a perfectly good public address
    const r = resolvePublicServerUrl('https://music.example.com', '', 'not an address');
    assert.equal(r.error, null);
    assert.equal(r.value, 'https://music.example.com');
});

test('aGoodPublicUrlIsTrimmedAndStoredAndAnEmptyOneClearsIt', () => {
    assert.deepEqual(resolvePublicServerUrl(' https://music.example.com ', '', HUB), {
        changed: true,
        draft: 'https://music.example.com',
        error: null,
        value: 'https://music.example.com',
    });
    assert.deepEqual(resolvePublicServerUrl('', 'https://music.example.com', HUB), {
        changed: true,
        draft: '',
        error: null,
        value: '',
    });
});
