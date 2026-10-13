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
//   - `welcome` and a lost socket clear all of them (the caller's part: NO_PINS);
//   - a pinned position belongs to the track it was sought on. When a frame puts the session on
//     another row, or another track on the same row, the pin is dropped for good (pinsOnTrack):
//     the ack may still be on its way, or lost, and the position means nothing on the new track.
// Pinned: play state, position, volume. Skips and queue edits are not, because under shuffle a
// controller cannot know which track comes next.
//
// A volume is pinned per device (I-033). The bar's slider sets the active device's, and a row in
// the device picker sets the one its act names as `target`; each device has its own newest act,
// its own ack and its own 2.5 s, so a level asked of the kitchen speaker neither shows on the
// bar nor is let go by the ack of a level asked of the device that is playing.
//
// A hub without `actAck` gets no pins: the callers keep volume-hold.ts and the seek bar's own
// 1 s hold, and nothing is shown early.

/** How long a pin stands without its ack. */
export const ACT_PIN_MS = 2500;

export interface ActPins {
    playing: null | PlayingPin;
    position: null | PositionPin;
    /** By the id of the device the level was asked of. Empty with none pinned. */
    volume: Readonly<Record<string, VolumePin>>;
}

/** What the hub last said, as far as a pin can stand in for it. */
export interface HubMirror {
    activeDeviceId: null | string;
    /** The session's row in its queue. */
    index: number;
    isPlaying: boolean;
    /** Wall-clock ms `positionMs` was received. */
    positionAt: number;
    positionMs: number;
    /** The id of the track on that row; null with an empty queue. */
    trackId: null | string;
}

export interface PlayingPin extends Pin {
    playing: boolean;
}

export interface PositionPin extends Pin {
    /** The row the mirror was on when the seek was sent - see pinsOnTrack. */
    index: number;
    /** Wall-clock ms `positionMs` was true: while "playing" is shown it runs on from here. */
    positionAt: number;
    positionMs: number;
    /** The track on that row. */
    trackId: null | string;
}

export interface VolumePin extends Pin {
    level: number;
}

interface Pin {
    /** Wall-clock ms the act was sent: the 2.5 s run from here. */
    at: number;
    /** The act whose ack releases the pin: the newest one sent on this value. */
    cid: string;
}

export const NO_PINS: ActPins = { playing: null, position: null, volume: {} };

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
    act: { action: string; level?: unknown; positionMs?: unknown; target?: unknown },
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
                position: {
                    at: now,
                    cid,
                    index: mirror.index,
                    positionAt: now,
                    positionMs: act.positionMs,
                    trackId: mirror.trackId,
                },
            };
        case 'volume': {
            if (typeof act.level !== 'number') return pins;
            // The device the act is for: the one it names, else the active one, which is
            // where the hub sends a volume without a `target`.
            const deviceId = typeof act.target === 'string' ? act.target : mirror.activeDeviceId;
            if (deviceId === null) return pins;
            return {
                ...pins,
                volume: { ...pins.volume, [deviceId]: { at: now, cid, level: act.level } },
            };
        }
        default:
            return pins;
    }
}

/**
 * A frame has put the session on row `index`, holding `trackId`: drop a position pinned on any
 * other track. Dropped, not hidden - going back to that row starts the track again, and the pin
 * must not come back with it. Returns `pins` itself when the session is still where the seek was
 * sent (every `progress` frame of the same track).
 */
export function pinsOnTrack(pins: ActPins, session: Pick<HubMirror, 'index' | 'trackId'>): ActPins {
    const pin = pins.position;
    if (pin === null || (pin.index === session.index && pin.trackId === session.trackId)) {
        return pins;
    }
    return { ...pins, position: null };
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
        volume: volumesWhere(pins.volume, (pin) => standing(pin, now) !== null),
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
    const volume = volumesWhere(pins.volume, (pin) => !holds(pin));
    if (!holds(pins.playing) && !holds(pins.position) && volume === pins.volume) return pins;
    return {
        playing: holds(pins.playing) ? null : pins.playing,
        position: holds(pins.position) ? null : pins.position,
        volume,
    };
}

/**
 * The level this client just asked of the device `deviceId`, or null when that device's row is
 * the truth: nothing pinned for it, or a pin that has lapsed.
 */
export function shownDeviceVolume(pins: ActPins, deviceId: string, now: number): null | number {
    // Own keys only: a device id is the hub's string and must not find Object's members.
    const pin = Object.prototype.hasOwnProperty.call(pins.volume, deviceId)
        ? pins.volume[deviceId]
        : null;
    return standing(pin, now)?.level ?? null;
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
    if (mirror.activeDeviceId === null) return null;
    return shownDeviceVolume(pins, mirror.activeDeviceId, now);
}

/** The volume pins `keep` accepts; `volume` itself when it accepts them all. */
function volumesWhere(
    volume: ActPins['volume'],
    keep: (pin: VolumePin) => boolean,
): ActPins['volume'] {
    const kept = Object.entries(volume).filter(([, pin]) => keep(pin));
    return kept.length === Object.keys(volume).length ? volume : Object.fromEntries(kept);
}
