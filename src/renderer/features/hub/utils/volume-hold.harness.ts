import assert from 'node:assert/strict';
import test from 'node:test';

import type { SliderHold, VolumeCommand } from './volume-hold.ts';

import { commandedVolume, sliderHoldRemaining, VOLUME_HOLD_MS } from './volume-hold.ts';

/**
 * node --test src/renderer/features/hub/utils/volume-hold.harness.ts
 *
 * The volume slider against the echoes of its own sends, replayed over a timeline (ms from the
 * first send). `shown` is what VolumeButton renders: the hold's value while sliderHoldRemaining
 * is above 0, else the observed volume - the component clears the hold in an effect the moment it
 * reads 0, which the replay does too (that is what makes "ended" stay ended).
 */

const DEVICE = 'speaker';

interface Step {
    at: number;
    /** A `devices` frame: the active device's volume. */
    frame?: number;
    /** The slider moved (onChange), or was let go (onChangeEnd). */
    slider?: { end?: boolean; value: number };
}

/** What the slider shows after each step. */
const replay = (steps: Step[], start: number, scope: null | string = DEVICE): number[] => {
    let observed = start;
    let hold: null | SliderHold = null;
    return steps.map((step) => {
        if (step.frame !== undefined) observed = step.frame;
        if (step.slider) {
            hold = {
                dragging: !step.slider.end,
                scope,
                until: step.at + VOLUME_HOLD_MS,
                value: step.slider.value,
            };
        }
        if (sliderHoldRemaining(hold, scope, observed, step.at) === 0) hold = null;
        return hold ? hold.value : observed;
    });
};

// --- The slider ----------------------------------------------------------------------------

test('a drag is not overwritten by the echoes of its own earlier sends', () => {
    // 30 -> 60 in three sends 100 ms apart, each echoed 150 ms later.
    const shown = replay(
        [
            { at: 0, slider: { value: 40 } },
            { at: 100, slider: { value: 50 } },
            { at: 150, frame: 40 },
            { at: 200, slider: { value: 60 } },
            { at: 250, frame: 50 },
            { at: 260, slider: { end: true, value: 60 } },
            { at: 350, frame: 60 },
        ],
        30,
    );
    assert.deepEqual(shown, [40, 50, 50, 60, 60, 60, 60]);
});

test('an echo that equals the thumb mid-drag does not end the hold', () => {
    // The thumb rests on 40 while the echoes of 40, 60 and 40 again are still to come.
    const shown = replay(
        [
            { at: 0, slider: { value: 40 } },
            { at: 100, slider: { value: 60 } },
            { at: 200, slider: { value: 40 } },
            { at: 210, frame: 40 },
            { at: 310, frame: 60 },
            { at: 410, frame: 40 },
        ],
        30,
    );
    assert.deepEqual(shown, [40, 60, 40, 40, 40, 40]);
});

test('once let go, the hold ends at the echo and a change made elsewhere shows at once', () => {
    const shown = replay(
        [
            { at: 0, slider: { end: true, value: 50 } },
            { at: 120, frame: 50 },
            { at: 900, frame: 20 },
        ],
        30,
    );
    assert.deepEqual(shown, [50, 50, 20]);
});

test('an echo that never comes gives the slider back to the device after 2.5 s', () => {
    const steps: Step[] = [
        { at: 0, slider: { end: true, value: 50 } },
        { at: VOLUME_HOLD_MS - 1 },
        { at: VOLUME_HOLD_MS },
    ];
    assert.deepEqual(replay(steps, 30), [50, 50, 30]);
});

test('a drag whose release never arrives lapses too, and the next move takes it back', () => {
    const shown = replay(
        [
            { at: 0, slider: { value: 50 } },
            { at: 100, frame: 50 },
            { at: 4000, frame: 20 },
            { at: 4100, slider: { value: 55 } },
        ],
        30,
    );
    assert.deepEqual(shown, [50, 50, 20, 55]);
});

test("a hold is dropped when the volume becomes another device's, or this machine's", () => {
    const hold: SliderHold = { dragging: false, scope: DEVICE, until: 2500, value: 50 };
    assert.ok(sliderHoldRemaining(hold, DEVICE, 30, 100) > 0);
    assert.equal(sliderHoldRemaining(hold, 'kitchen', 30, 100), 0, 'another device is active');
    assert.equal(sliderHoldRemaining(hold, null, 30, 100), 0, 'playback came back here');
    const dragging: SliderHold = { ...hold, dragging: true };
    assert.equal(sliderHoldRemaining(dragging, 'kitchen', 30, 100), 0, 'mid-drag as well');
});

test('the local slider holds only until its throttled write lands', () => {
    // scope null = this machine. The store is written at most every 100 ms, so on release it
    // can be one value behind; the trailing write catches up.
    const shown = replay(
        [
            { at: 0, slider: { value: 40 } },
            { at: 0, frame: 40 },
            { at: 60, slider: { value: 47 } },
            { at: 70, slider: { end: true, value: 47 } },
            { at: 100, frame: 47 },
            { at: 500, frame: 80 },
        ],
        30,
        null,
    );
    assert.deepEqual(shown, [40, 40, 47, 47, 47, 80]);
});

test('the time left is bounded: none without a hold or past the deadline, never above 2.5 s', () => {
    assert.equal(sliderHoldRemaining(null, DEVICE, 30, 0), 0);
    const hold: SliderHold = { dragging: true, scope: DEVICE, until: 2500, value: 50 };
    assert.equal(sliderHoldRemaining(hold, DEVICE, 30, 2400), 100);
    assert.equal(sliderHoldRemaining(hold, DEVICE, 30, 9000), 0);
    assert.equal(sliderHoldRemaining(hold, DEVICE, 30, -3_600_000), VOLUME_HOLD_MS);
});

// --- The relative changes (wheel, hotkeys, mute) ---------------------------------------------

/** remoteActiveVolume(): the commanded level while it stands, else the device's row. */
const base = (command: null | VolumeCommand, observed: number, now: number, active = DEVICE) =>
    commandedVolume(command, active, now) ?? observed;

test('a second step inside the round trip builds on the first', () => {
    // Volume up twice, 80 ms apart, step 5, the first echo 150 ms out.
    const first: VolumeCommand = { at: 0, deviceId: DEVICE, level: base(null, 50, 0) + 5 };
    assert.equal(first.level, 55);
    assert.equal(base(first, 50, 80) + 5, 60, 'not 55 again');
});

test('mute, then unmute before the echo: the second press sees the mute', () => {
    const muted: VolumeCommand = { at: 0, deviceId: DEVICE, level: 0 };
    assert.equal(base(muted, 50, 40), 0);
});

test('the commanded level stands for 2.5 s and only for the device it was sent to', () => {
    const command: VolumeCommand = { at: 1000, deviceId: DEVICE, level: 70 };
    assert.equal(commandedVolume(command, DEVICE, 1000), 70);
    assert.equal(commandedVolume(command, DEVICE, 1000 + VOLUME_HOLD_MS - 1), 70);
    assert.equal(commandedVolume(command, DEVICE, 1000 + VOLUME_HOLD_MS), null, 'too old');
    assert.equal(commandedVolume(command, 'kitchen', 1100), null, 'the session moved');
    assert.equal(commandedVolume(command, null, 1100), null, 'nobody is active');
    assert.equal(commandedVolume(command, DEVICE, 0), null, 'the clock was set back');
    assert.equal(commandedVolume(null, DEVICE, 1100), null, 'nothing sent yet');
});
