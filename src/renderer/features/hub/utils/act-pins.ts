// navi-connect (I-031): a value this client has just commanded, shown until the hub has answered
// for it. Pure, so the rule can be tested without React or the hub store (act-pins.harness.ts).
//
// While another device plays, the bar shows the hub's mirror: the play state and position of the
// last `session` or `progress` frame, the volume in the active device's row. A press here changes
// none of that until the frame it causes has made the round trip. Over a slow link the control
// answered late (the play button two link delays after the tap), and a frame already on its way
// could show the old value once more after the press.
//
// A hub that lists `actAck` in `welcome.features` answers every act that carries a `cid` with
// `{t:'ack', cid, ok}`, written AFTER every frame that act caused (PROTOCOL §5.1). So:
//   - the value is pinned when the act is sent, and readers show the pin over the mirror;
//   - the pin is released by the ack of the NEWEST act on that value, and by nothing else that
//     arrives: an ack for an earlier press must not let the mirror show through while a later
//     press is on its way. At that ack the mirror holds the hub's answer, another controller's
//     change included;
//   - with no ack inside 2.5 s (the socket died, the hub restarted) the pin lapses. That is
//     checked when the pin is read, not by a timer, so nothing can leave one stuck;
//   - `welcome` and a lost socket clear all of them (the caller's part: NO_PINS).
// Pinned: play state, position, volume. Skips and queue edits are not, because under shuffle a
// controller cannot know which track comes next.
//
// A hub without `actAck` gets no pins: the callers keep volume-hold.ts and the seek bar's own
// 1 s hold, and nothing is shown early.

/** How long a pin stands without its ack. */
export const ACT_PIN_MS = 2500;

export interface ActPins {
    playing: null | PlayingPin;
    position: null | PositionPin;
    volume: null | VolumePin;
}

/** What the hub last said, as far as a pin can stand in for it. */
export interface HubMirror {
    activeDeviceId: null | string;
    isPlaying: boolean;
    /** Wall-clock ms `positionMs` was received. */
    positionAt: number;
    positionMs: number;
}

export interface PlayingPin extends Pin {
    playing: boolean;
}

export interface PositionPin extends Pin {
    /** Wall-clock ms `positionMs` was true: while "playing" is shown it runs on from here. */
    positionAt: number;
    positionMs: number;
}

export interface VolumePin extends Pin {
    /** The device it was sent to - the active one at the time. */
    deviceId: string;
    level: number;
}

interface Pin {
    /** Wall-clock ms the act was sent: the 2.5 s run from here. */
    at: number;
    /** The act whose ack releases the pin: the newest one sent on this value. */
    cid: string;
}

export const NO_PINS: ActPins = { playing: null, position: null, volume: null };

/** The pin while it stands; null once it has lapsed (or the clock was set back behind it). */
const standing = <T extends Pin>(pin: null | T, now: number): null | T => {
    if (pin === null) return null;
    const age = now - pin.at;
    return age >= 0 && age < ACT_PIN_MS ? pin : null;
};

/**
 * Pin what the act `act`, just sent under `cid`, commands - replacing an earlier pin on the same
 * value, so that only this act's ack releases it. Returns `pins` itself for an act that
 * commands none of the three.
 */
export function pinAct(
    pins: ActPins,
    act: { action: string; level?: unknown; positionMs?: unknown },
    cid: string,
    mirror: HubMirror,
    now: number,
): ActPins {
    switch (act.action) {
        case 'pause':
        case 'play': {
            // A pinned position runs on only while "playing" is shown. Changing what is shown
            // must not move it: take it at this instant, and let it stop (or start) from here.
            const position = standing(pins.position, now);
            return {
                ...pins,
                playing: { at: now, cid, playing: act.action === 'play' },
                position: position && {
                    ...position,
                    positionAt: now,
                    positionMs: shownPositionMs(pins, mirror, now),
                },
            };
        }
        case 'seek':
            if (typeof act.positionMs !== 'number') return pins;
            return {
                ...pins,
                position: { at: now, cid, positionAt: now, positionMs: act.positionMs },
            };
        case 'volume':
            if (typeof act.level !== 'number' || mirror.activeDeviceId === null) return pins;
            return {
                ...pins,
                volume: { at: now, cid, deviceId: mirror.activeDeviceId, level: act.level },
            };
        default:
            return pins;
    }
}

/**
 * The act the play/pause control sends to a hub that acknowledges acts: the one the user was
 * shown. The hub-side toggle `playpause` can disagree with a pin when the mirror is a frame
 * behind - a second press inside the round trip would toggle the hub back to what the first
 * press had already changed here.
 */
export function playPauseAct(pins: ActPins, mirror: HubMirror, now: number): 'pause' | 'play' {
    return shownPlaying(pins, mirror, now) ? 'pause' : 'play';
}

/** `pins` without the ones that have lapsed; `pins` itself when none has. */
export function prunePins(pins: ActPins, now: number): ActPins {
    const next: ActPins = {
        playing: standing(pins.playing, now),
        position: standing(pins.position, now),
        volume: standing(pins.volume, now),
    };
    return next.playing === pins.playing &&
        next.position === pins.position &&
        next.volume === pins.volume
        ? pins
        : next;
}

/**
 * The hub acknowledged the act `cid`, whichever way (`ok` or not): drop the pin that act is the
 * newest on. An ack for an earlier act matches no pin - a later act on the same value took its
 * place - so it releases nothing. Returns `pins` itself then.
 */
export function releasePin(pins: ActPins, cid: string): ActPins {
    const holds = (pin: null | Pin) => pin !== null && pin.cid === cid;
    if (!holds(pins.playing) && !holds(pins.position) && !holds(pins.volume)) return pins;
    return {
        playing: holds(pins.playing) ? null : pins.playing,
        position: holds(pins.position) ? null : pins.position,
        volume: holds(pins.volume) ? null : pins.volume,
    };
}

/** Is the session playing, as this client shows it: the play or pause just sent, else the hub's. */
export function shownPlaying(pins: ActPins, mirror: HubMirror, now: number): boolean {
    return standing(pins.playing, now)?.playing ?? mirror.isPlaying;
}

/**
 * The position (ms) this client shows. Where it just sought to, running on while it shows
 * "playing"; else the hub's last position, running on while the HUB says playing - the device
 * keeps playing until a pause sent from here has reached it, so the mirror is not stopped early.
 */
export function shownPositionMs(pins: ActPins, mirror: HubMirror, now: number): number {
    const pin = standing(pins.position, now);
    if (pin !== null) {
        const running = shownPlaying(pins, mirror, now) ? Math.max(0, now - pin.positionAt) : 0;
        return Math.max(0, pin.positionMs + running);
    }
    return Math.max(0, mirror.positionMs + (mirror.isPlaying ? now - mirror.positionAt : 0));
}

/**
 * The level this client just asked of the active device, or null when its row is the truth: no
 * pin, a lapsed one, or one made for a device that is no longer the active one.
 */
export function shownVolume(pins: ActPins, mirror: HubMirror, now: number): null | number {
    const pin = standing(pins.volume, now);
    return pin !== null && pin.deviceId === mirror.activeDeviceId ? pin.level : null;
}
