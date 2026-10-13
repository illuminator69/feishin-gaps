import assert from 'node:assert/strict';
import test from 'node:test';

import type { ActPins, HubMirror } from './act-pins.ts';

import {
    ACT_PIN_MS,
    NO_PINS,
    pinAct,
    pinsOnTrack,
    playPauseAct,
    prunePins,
    releasePin,
    shownDeviceVolume,
    shownPlaying,
    shownPositionMs,
    shownVolume,
} from './act-pins.ts';

/**
 * I-031:  node --test src/renderer/features/hub/utils/act-pins.harness.ts
 *
 * A controller's bar over a slow link, replayed as a timeline (ms from the first press). An
 * `act` is a control pressed here: remote-queue's sendAct mints its `cid` and pins. A `frame` is
 * a `session` / `progress` / `devices` frame arriving: use-hub writes it into the mirror, and
 * keeps only the pins that belong to the track the frame names (pinsOnTrack). An `ack` is the
 * hub's answer to one act, which use-hub releases the pin by. `shown` is what the remote-aware
 * hooks render after each step.
 *
 * The device picker's row sliders (I-033) are replayed the same way further down: there an act
 * names its `target`, a frame is a `devices` frame, and what is shown is each row's slider.
 */

const SPEAKER = 'speaker';

interface Shown {
    playing: boolean;
    positionMs: number;
    volume: number;
}

interface Step {
    ack?: string;
    act?: { action: string; cid: string; level?: number; positionMs?: number; target?: string };
    at: number;
    frame?: Partial<HubMirror> & { volume?: number };
}

interface World {
    mirror: HubMirror;
    pins: ActPins;
    volume: number;
}

const world = (mirror: Partial<HubMirror> = {}, volume = 30): World => ({
    mirror: {
        activeDeviceId: SPEAKER,
        index: 0,
        isPlaying: false,
        positionAt: 0,
        positionMs: 0,
        trackId: 'a',
        ...mirror,
    },
    pins: NO_PINS,
    volume,
});

const shown = (w: World, now: number): Shown => ({
    playing: shownPlaying(w.pins, w.mirror, now),
    positionMs: shownPositionMs(w.pins, w.mirror, now),
    volume: shownVolume(w.pins, w.mirror, now) ?? w.volume,
});

/** What the bar shows after each step. */
const replay = (w: World, steps: Step[]): Shown[] =>
    steps.map((step) => {
        if (step.frame) {
            const { volume, ...mirror } = step.frame;
            w.mirror = { ...w.mirror, ...mirror };
            // A frame that carries a position was received now.
            if (mirror.positionMs !== undefined) w.mirror.positionAt = step.at;
            if (volume !== undefined) w.volume = volume;
            w.pins = pinsOnTrack(w.pins, w.mirror);
        }
        if (step.act) w.pins = pinAct(w.pins, step.act, step.act.cid, w.mirror, step.at);
        if (step.ack) w.pins = releasePin(w.pins, step.ack);
        return shown(w, step.at);
    });

const playing = (rows: Shown[]) => rows.map((row) => row.playing);
const positions = (rows: Shown[]) => rows.map((row) => row.positionMs);
const volumes = (rows: Shown[]) => rows.map((row) => row.volume);

// --- Play state ------------------------------------------------------------------------------

test('the play button answers at the press, not when the frame comes back', () => {
    // 300 ms each way. A progress frame sampled before the press still says "paused".
    const rows = replay(world(), [
        { act: { action: 'play', cid: 'a1' }, at: 0 },
        { at: 100, frame: { isPlaying: false } },
        { at: 600, frame: { isPlaying: true } },
        { ack: 'a1', at: 601 },
    ]);
    assert.deepEqual(playing(rows), [true, true, true, true]);
});

test("at the ack the mirror shows through, another controller's change included", () => {
    // The hub applied our play, then somebody else's pause, and acked ours after its own frames.
    const w = world();
    const rows = replay(w, [
        { act: { action: 'play', cid: 'a1' }, at: 0 },
        { at: 600, frame: { isPlaying: true } },
        { at: 610, frame: { isPlaying: false } },
        { ack: 'a1', at: 611 },
    ]);
    assert.deepEqual(playing(rows), [true, true, true, false]);
    assert.equal(w.pins.playing, null);
});

test('an ack for an earlier press does not release a later one', () => {
    // Pause, then play 200 ms later. The first ack arrives while the mirror holds the answer to
    // the PAUSE; letting it through would show "paused" until the second ack.
    const w = world({ isPlaying: true });
    const rows = replay(w, [
        { act: { action: 'pause', cid: 'a1' }, at: 0 },
        { act: { action: 'play', cid: 'a2' }, at: 200 },
        { at: 600, frame: { isPlaying: false } },
        { ack: 'a1', at: 601 },
        { at: 800, frame: { isPlaying: true } },
        { ack: 'a2', at: 801 },
    ]);
    assert.deepEqual(playing(rows), [false, true, true, true, true, true]);
    assert.equal(w.pins.playing, null, 'its own ack released it');
});

test('an ack that says no releases the pin too', () => {
    // `ok:false`: the act changed nothing, so the mirror is the truth again (and use-hub toasts).
    const rows = replay(world({ isPlaying: true }), [
        { act: { action: 'pause', cid: 'a1' }, at: 0 },
        { ack: 'a1', at: 300 },
    ]);
    assert.deepEqual(playing(rows), [false, true]);
});

test('with no ack the pin lapses after 2.5 s, as a check made when it is read', () => {
    const w = world({ isPlaying: true });
    replay(w, [{ act: { action: 'pause', cid: 'a1' }, at: 0 }]);
    assert.equal(shownPlaying(w.pins, w.mirror, ACT_PIN_MS - 1), false);
    assert.equal(shownPlaying(w.pins, w.mirror, ACT_PIN_MS), true, 'nothing had to run for this');
    assert.equal(shownPlaying(w.pins, w.mirror, -1), true, 'the clock was set back');
    // The store is tidied by a timer, which changes nothing a reader sees.
    assert.equal(prunePins(w.pins, ACT_PIN_MS - 1), w.pins, 'nothing lapsed: the same object');
    assert.deepEqual(prunePins(w.pins, ACT_PIN_MS), NO_PINS);
});

test('the play/pause control sends what it was showing, also inside the round trip', () => {
    const w = world({ isPlaying: true });
    assert.equal(playPauseAct(w.pins, w.mirror, 0), 'pause');
    w.pins = pinAct(w.pins, { action: 'pause' }, 'a1', w.mirror, 0);
    // The mirror still says "playing": a hub-side toggle sent now would be told to pause again
    // by a client that reads the mirror, and undo nothing. The user sees "paused" and wants play.
    assert.equal(playPauseAct(w.pins, w.mirror, 150), 'play');
    w.pins = pinAct(w.pins, { action: 'play' }, 'a2', w.mirror, 150);
    assert.equal(playPauseAct(w.pins, w.mirror, 300), 'pause');
});

// --- Position --------------------------------------------------------------------------------

test('a seek is shown from the send, and runs on while playing', () => {
    // Playing at 10 s; seek to 91 s. A progress frame from before the seek arrives at 150.
    const rows = replay(world({ isPlaying: true, positionMs: 10_000 }), [
        { act: { action: 'seek', cid: 's1', positionMs: 91_000 }, at: 0 },
        { at: 150, frame: { positionMs: 10_400 } },
        { at: 400 },
        { at: 600, frame: { positionMs: 91_300 } },
        { ack: 's1', at: 601 },
        { at: 1000 },
    ]);
    assert.deepEqual(positions(rows), [91_000, 91_150, 91_400, 91_600, 91_301, 91_700]);
});

test('a seek while paused stays where it was dropped', () => {
    const rows = replay(world({ positionMs: 10_000 }), [
        { act: { action: 'seek', cid: 's1', positionMs: 91_000 }, at: 0 },
        { at: 1100 },
        { at: 1200, frame: { positionMs: 91_000 } },
        { ack: 's1', at: 1201 },
    ]);
    // 1100: the seek bar's own hold used to end at 1 s and show 10 s again until a frame came.
    assert.deepEqual(positions(rows), [91_000, 91_000, 91_000, 91_000]);
});

test('a second seek keeps the thumb through the ack of the first', () => {
    const w = world({ positionMs: 10_000 });
    const rows = replay(w, [
        { act: { action: 'seek', cid: 's1', positionMs: 50_000 }, at: 0 },
        { act: { action: 'seek', cid: 's2', positionMs: 70_000 }, at: 200 },
        { at: 600, frame: { positionMs: 50_000 } },
        { ack: 's1', at: 601 },
        { at: 800, frame: { positionMs: 70_000 } },
        { ack: 's2', at: 801 },
    ]);
    assert.deepEqual(positions(rows), [50_000, 70_000, 70_000, 70_000, 70_000, 70_000]);
    assert.equal(w.pins.position, null);
});

test('a pause pressed after a seek stops the thumb where it was, not where it was dropped', () => {
    const rows = replay(world({ isPlaying: true, positionMs: 10_000 }), [
        { act: { action: 'seek', cid: 's1', positionMs: 91_000 }, at: 0 },
        { act: { action: 'pause', cid: 'a1' }, at: 400 },
        { at: 550 },
    ]);
    assert.deepEqual(positions(rows), [91_000, 91_400, 91_400]);
});

test('a play pressed after a paused seek starts the thumb at the press', () => {
    const rows = replay(world({ positionMs: 10_000 }), [
        { act: { action: 'seek', cid: 's1', positionMs: 91_000 }, at: 0 },
        { act: { action: 'play', cid: 'a1' }, at: 400 },
        { at: 550 },
    ]);
    assert.deepEqual(positions(rows), [91_000, 91_000, 91_150]);
});

test('the play-state pin does not release the position pin, nor the other way round', () => {
    const w = world({ isPlaying: true, positionMs: 10_000 });
    replay(w, [
        { act: { action: 'seek', cid: 's1', positionMs: 91_000 }, at: 0 },
        { act: { action: 'pause', cid: 'a1' }, at: 100 },
        { ack: 's1', at: 300 },
    ]);
    assert.equal(w.pins.position, null);
    assert.equal(w.pins.playing?.cid, 'a1');
    w.pins = pinAct(w.pins, { action: 'seek', positionMs: 5000 }, 's2', w.mirror, 310);
    w.pins = releasePin(w.pins, 'a1');
    assert.equal(w.pins.playing, null);
    assert.equal(w.pins.position?.cid, 's2');
});

test('a pinned position does not follow the session onto another track', () => {
    // A seek to 3:20 on row 2, playing. Before its ack (held behind a transfer, or lost) the
    // device moves on to row 3. Without the rule the bar read 3:20 on a track that just began.
    const w = world({ index: 2, isPlaying: true, positionMs: 10_000, trackId: 'c' });
    const rows = replay(w, [
        { act: { action: 'seek', cid: 's1', positionMs: 200_000 }, at: 0 },
        { at: 200, frame: { positionMs: 10_300 } },
        { at: 300, frame: { index: 3, positionMs: 0, trackId: 'd' } },
        { at: 500 },
    ]);
    assert.deepEqual(positions(rows), [200_000, 200_200, 0, 200]);
    assert.equal(w.pins.position, null);
});

test('going back to the row a seek was pinned on does not bring the pin back', () => {
    // Next, then previous, inside the 2.5 s: row 2 starts again from the top.
    const w = world({ index: 2, positionMs: 10_000, trackId: 'c' });
    const rows = replay(w, [
        { act: { action: 'seek', cid: 's1', positionMs: 200_000 }, at: 0 },
        { at: 300, frame: { index: 3, positionMs: 0, trackId: 'd' } },
        { at: 600, frame: { index: 2, positionMs: 0, trackId: 'c' } },
    ]);
    assert.deepEqual(positions(rows), [200_000, 0, 0]);
});

test('another queue loaded at the same row drops the pinned position too', () => {
    const w = world({ index: 0, positionMs: 10_000, trackId: 'a' });
    const rows = replay(w, [
        { act: { action: 'seek', cid: 's1', positionMs: 200_000 }, at: 0 },
        { at: 300, frame: { positionMs: 0, trackId: 'z' } },
    ]);
    assert.deepEqual(positions(rows), [200_000, 0]);
});

test('a track change drops only the position: play state and volume are not about a track', () => {
    const w = world({ index: 2, isPlaying: true, trackId: 'c' }, 50);
    replay(w, [
        { act: { action: 'seek', cid: 's1', positionMs: 200_000 }, at: 0 },
        { act: { action: 'pause', cid: 'a1' }, at: 10 },
        { act: { action: 'volume', cid: 'v1', level: 70 }, at: 20 },
        { at: 300, frame: { index: 3, positionMs: 0, trackId: 'd' } },
    ]);
    assert.equal(w.pins.position, null);
    assert.equal(w.pins.playing?.cid, 'a1');
    assert.equal(w.pins.volume[SPEAKER]?.cid, 'v1');
    const still = pinsOnTrack(w.pins, w.mirror);
    assert.equal(still, w.pins, 'nothing to drop: the same object');
});

test('without a pin the mirror runs as it always did', () => {
    const playingAt10 = world({ isPlaying: true, positionAt: 1000, positionMs: 10_000 });
    assert.equal(shownPositionMs(NO_PINS, playingAt10.mirror, 1750), 10_750);
    const pausedAt10 = world({ positionAt: 1000, positionMs: 10_000 });
    assert.equal(shownPositionMs(NO_PINS, pausedAt10.mirror, 1750), 10_000);
    // A pause pinned over a mirror that still says "playing": the device plays on until the
    // pause reaches it, so the position does too.
    const pins = pinAct(NO_PINS, { action: 'pause' }, 'a1', playingAt10.mirror, 1500);
    assert.equal(shownPositionMs(pins, playingAt10.mirror, 1750), 10_750);
});

// --- Volume ----------------------------------------------------------------------------------

test('a volume step is shown at once and the next one builds on it', () => {
    // Volume up twice 80 ms apart, step 5, the row 600 ms behind.
    const w = world({}, 50);
    const first = (shownVolume(w.pins, w.mirror, 0) ?? w.volume) + 5;
    w.pins = pinAct(w.pins, { action: 'volume', level: first }, 'v1', w.mirror, 0);
    const second = (shownVolume(w.pins, w.mirror, 80) ?? w.volume) + 5;
    assert.equal(second, 60, 'not 55 again');
    const rows = replay(w, [
        { act: { action: 'volume', cid: 'v2', level: second }, at: 80 },
        { at: 600, frame: { volume: 55 } },
        { ack: 'v1', at: 601 },
        { at: 680, frame: { volume: 60 } },
        { ack: 'v2', at: 681 },
        { at: 900, frame: { volume: 20 } },
    ]);
    // 601: the row says 55 and the ack is for the FIRST step - the slider must not dip to it.
    assert.deepEqual(volumes(rows), [60, 60, 60, 60, 60, 20]);
});

test('a volume pin is about the device it was sent to', () => {
    const w = world({}, 50);
    w.pins = pinAct(w.pins, { action: 'volume', level: 70 }, 'v1', w.mirror, 0);
    assert.equal(shownVolume(w.pins, w.mirror, 100), 70);
    assert.equal(
        shownVolume(w.pins, { ...w.mirror, activeDeviceId: 'kitchen' }, 100),
        null,
        'the session moved to another device',
    );
    assert.equal(
        shownVolume(w.pins, { ...w.mirror, activeDeviceId: null }, 100),
        null,
        'nobody is active',
    );
    assert.equal(shownVolume(w.pins, w.mirror, ACT_PIN_MS), null, 'lapsed');
    const nobody = { ...w.mirror, activeDeviceId: null };
    assert.equal(
        pinAct(NO_PINS, { action: 'volume', level: 70 }, 'v2', nobody, 0),
        NO_PINS,
        'and none is made with nobody to send it to',
    );
});

// --- Volume of a device that is not playing: the picker's row sliders --------------------------

const KITCHEN = 'kitchen';
const TV = 'tv';

interface RowStep {
    ack?: string;
    act?: { cid: string; level: number; target: string };
    at: number;
    /** A `devices` frame: the rows' levels as the hub holds them. */
    frame?: Record<string, number>;
}

/** The picker over a session playing on SPEAKER: each row's level in the last `devices` frame. */
const picker = (rows: Record<string, number>) => ({
    mirror: world().mirror,
    pins: NO_PINS as ActPins,
    rows: { ...rows },
});

/** What the sliders of `devices` show after each step. */
const replayRows = (p: ReturnType<typeof picker>, devices: string[], steps: RowStep[]) =>
    steps.map((step) => {
        if (step.frame) p.rows = { ...p.rows, ...step.frame };
        if (step.act) {
            const { cid, ...act } = step.act;
            p.pins = pinAct(p.pins, { ...act, action: 'volume' }, cid, p.mirror, step.at);
        }
        if (step.ack) p.pins = releasePin(p.pins, step.ack);
        return devices.map((id) => shownDeviceVolume(p.pins, id, step.at) ?? p.rows[id]);
    });

test("a row's slider keeps the level it was let go at until the hub has answered", () => {
    // Released at 20 over a row that says 60, 300 ms each way. A `devices` frame caused by
    // somebody else's act arrives first and still says 60.
    const p = picker({ [KITCHEN]: 60 });
    const shown = replayRows(
        p,
        [KITCHEN],
        [
            { act: { cid: 'r1', level: 20, target: KITCHEN }, at: 0 },
            { at: 150, frame: { [SPEAKER]: 45 } },
            { at: 600, frame: { [KITCHEN]: 20 } },
            { ack: 'r1', at: 601 },
        ],
    );
    assert.deepEqual(shown, [[20], [20], [20], [20]], 'never 60 after the release');
    assert.deepEqual(p.pins.volume, {});
});

test('at the ack the row shows what the device said, not what was asked', () => {
    // A phone with 15 volume steps lands on 36 for 37 and reports it; the hub's frame says 36.
    const p = picker({ [KITCHEN]: 60 });
    const shown = replayRows(
        p,
        [KITCHEN],
        [
            { act: { cid: 'r1', level: 37, target: KITCHEN }, at: 0 },
            { at: 600, frame: { [KITCHEN]: 37 } },
            { ack: 'r1', at: 601 },
            { at: 700, frame: { [KITCHEN]: 36 } },
        ],
    );
    assert.deepEqual(shown, [[37], [37], [37], [36]]);
});

test("a refused level goes back to the row's own, at the ack", () => {
    // `ok:false` (target_offline, not_supported): the hub recorded nothing and sent no frame.
    const p = picker({ [KITCHEN]: 60 });
    const shown = replayRows(
        p,
        [KITCHEN],
        [
            { act: { cid: 'r1', level: 20, target: KITCHEN }, at: 0 },
            { ack: 'r1', at: 600 },
        ],
    );
    assert.deepEqual(shown, [[20], [60]]);
});

test('each row has its own pin, released by its own ack', () => {
    const p = picker({ [KITCHEN]: 60, [TV]: 80 });
    const shown = replayRows(
        p,
        [KITCHEN, TV],
        [
            { act: { cid: 'r1', level: 20, target: KITCHEN }, at: 0 },
            { act: { cid: 'r2', level: 30, target: TV }, at: 100 },
            { at: 600, frame: { [KITCHEN]: 20 } },
            { ack: 'r1', at: 601 },
            { at: 700, frame: { [TV]: 30 } },
            { ack: 'r2', at: 701 },
        ],
    );
    assert.deepEqual(shown, [
        [20, 80],
        [20, 30],
        [20, 30],
        [20, 30],
        [20, 30],
        [20, 30],
    ]);
    assert.deepEqual(p.pins.volume, {});
});

test('on one row the ack of an earlier release does not let go of a later one', () => {
    const p = picker({ [KITCHEN]: 60 });
    const shown = replayRows(
        p,
        [KITCHEN],
        [
            { act: { cid: 'r1', level: 20, target: KITCHEN }, at: 0 },
            { act: { cid: 'r2', level: 40, target: KITCHEN }, at: 200 },
            { at: 600, frame: { [KITCHEN]: 20 } },
            { ack: 'r1', at: 601 },
            { at: 800, frame: { [KITCHEN]: 40 } },
            { ack: 'r2', at: 801 },
        ],
    );
    assert.deepEqual(shown, [[20], [40], [40], [40], [40], [40]]);
});

test("a row's level and the bar's do not stand in for each other", () => {
    // The bar's slider sets the active device (no target); a row sets the one it names.
    const p = picker({ [KITCHEN]: 60, [SPEAKER]: 45 });
    p.pins = pinAct(p.pins, { action: 'volume', level: 20, target: KITCHEN }, 'r1', p.mirror, 0);
    assert.equal(shownVolume(p.pins, p.mirror, 10), null, 'the bar still shows the speaker row');
    p.pins = pinAct(p.pins, { action: 'volume', level: 70 }, 'v1', p.mirror, 20);
    assert.equal(shownVolume(p.pins, p.mirror, 30), 70);
    assert.equal(shownDeviceVolume(p.pins, KITCHEN, 30), 20);
    p.pins = releasePin(p.pins, 'v1');
    assert.equal(shownVolume(p.pins, p.mirror, 40), null);
    assert.equal(shownDeviceVolume(p.pins, KITCHEN, 40), 20, "the bar's ack released the bar's");
});

test('a target that is the active device is the pin the bar shows', () => {
    const w = world({}, 50);
    w.pins = pinAct(w.pins, { action: 'volume', level: 70, target: SPEAKER }, 'r1', w.mirror, 0);
    assert.equal(shownVolume(w.pins, w.mirror, 10), 70);
    w.pins = pinAct(w.pins, { action: 'volume', level: 65 }, 'v1', w.mirror, 20);
    assert.equal(shownDeviceVolume(w.pins, SPEAKER, 30), 65, 'one value, the newest act on it');
    assert.equal(releasePin(w.pins, 'r1'), w.pins, 'the earlier ack releases nothing');
});

test('a row can be set with nobody playing, and its pin lapses like any other', () => {
    const nobody = { ...world().mirror, activeDeviceId: null };
    const pins = pinAct(NO_PINS, { action: 'volume', level: 20, target: KITCHEN }, 'r1', nobody, 0);
    assert.equal(shownDeviceVolume(pins, KITCHEN, ACT_PIN_MS - 1), 20);
    assert.equal(shownDeviceVolume(pins, KITCHEN, ACT_PIN_MS), null, 'no ack: the row again');
    assert.equal(shownDeviceVolume(pins, TV, 10), null, 'nothing was asked of the TV');
    assert.equal(prunePins(pins, ACT_PIN_MS - 1), pins, 'nothing lapsed: the same object');
    assert.deepEqual(prunePins(pins, ACT_PIN_MS), NO_PINS);
});

test('only the lapsed row is tidied away', () => {
    const mirror = world().mirror;
    let pins = pinAct(NO_PINS, { action: 'volume', level: 20, target: KITCHEN }, 'r1', mirror, 0);
    pins = pinAct(pins, { action: 'volume', level: 30, target: TV }, 'r2', mirror, 1000);
    const pruned = prunePins(pins, ACT_PIN_MS + 10);
    assert.deepEqual(Object.keys(pruned.volume), [TV]);
    assert.equal(pruned.volume[TV], pins.volume[TV]);
});

test('a device id is only ever a key of its own pin', () => {
    const mirror = world().mirror;
    assert.equal(shownDeviceVolume(NO_PINS, 'constructor', 0), null);
    assert.equal(shownDeviceVolume(NO_PINS, 'toString', 0), null);
    const pins = pinAct(
        NO_PINS,
        { action: 'volume', level: 20, target: '__proto__' },
        'r1',
        mirror,
        0,
    );
    assert.equal(shownDeviceVolume(pins, '__proto__', 10), 20);
    assert.deepEqual(releasePin(pins, 'r1'), NO_PINS);
});

// --- What is not pinned ------------------------------------------------------------------------

test('skips, queue edits and the hub-side toggle pin nothing', () => {
    const mirror = world({ isPlaying: true }).mirror;
    for (const action of [
        'next',
        'previous',
        'jump',
        'playpause',
        'setQueue',
        'enqueue',
        'remove',
        'move',
        'clear',
        'transfer',
        'repeat',
        'shuffle',
        'syncSavedQueues',
    ]) {
        assert.equal(pinAct(NO_PINS, { action }, 'c1', mirror, 0), NO_PINS, action);
    }
    assert.equal(pinAct(NO_PINS, { action: 'seek' }, 'c1', mirror, 0), NO_PINS, 'no position');
    assert.equal(pinAct(NO_PINS, { action: 'volume' }, 'c1', mirror, 0), NO_PINS, 'no level');
});

test('an ack that matches no pin changes nothing', () => {
    const mirror = world().mirror;
    const pins = pinAct(NO_PINS, { action: 'play' }, 'a1', mirror, 0);
    assert.equal(releasePin(pins, 'n7'), pins, 'the ack of a skip: the same object');
    assert.equal(releasePin(NO_PINS, 'a1'), NO_PINS);
});
