// navi-connect: whose word counts for the volume while a change is still on its way. Pure, so the
// two decisions can be tested without React or the hub store (volume-hold.harness.ts).
//
// While another device plays, the level the bar shows is that device's row in the hub's `devices`
// frame, and the hub rewrites that row only when somebody sends `act:volume`. So every level this
// client sends comes back as a frame one round trip later, and until it does the store still
// holds the old one. Two readers used to believe the frame over what had just been asked for:
//   - the slider copied every frame into itself, so a drag was overwritten by the echoes of its
//     own earlier sends - and then sent the value it had been handed back;
//   - the relative changes (wheel, volume hotkeys, mute) stepped from the frame, so a second
//     press inside the round trip stepped from the level before the first.
// Both now prefer what was asked for, for a short while: the slider its own value (SliderHold),
// the relative changes the last level sent (VolumeCommand, marked in remote-queue's remoteAct).
//
// There is no ack on the wire, so "the echo arrived" is "the observed level equals the one asked
// for". A drag that passes through a level twice can match the earlier echo and let the ones
// still in flight show for a moment; it ends on the right level either way.

/** How long a level this client asked for outranks the one it observes. */
export const VOLUME_HOLD_MS = 2500;

/** The slider's own value, while it outranks the volume it observes. */
export interface SliderHold {
    /** Still being dragged: an echo does not end it, only the deadline or another device. */
    dragging: boolean;
    /** Whose volume it set: the active remote device's id, or null for this machine's. */
    scope: null | string;
    /** Wall-clock ms it lapses, whatever was observed. */
    until: number;
    value: number;
}

/** The last `act:volume` this client sent. */
export interface VolumeCommand {
    /** Wall-clock ms it was sent. */
    at: number;
    /** The device it was sent to - the active one at the time. */
    deviceId: string;
    level: number;
}

/**
 * The level a relative change steps from in place of the `devices` frame: the last one sent,
 * while it is young and still about the device that is active. Null when the frame is the truth.
 */
export function commandedVolume(
    command: null | VolumeCommand,
    activeDeviceId: null | string,
    now: number,
): null | number {
    if (command === null || command.deviceId !== activeDeviceId) return null;
    const age = now - command.at;
    // ponytail: age only. A level another client sets inside the window is stepped over by the
    // next relative change made here; forget the command once its echo is observed if that shows.
    // `age >= 0`: a clock set back must not turn "young" into "for as long as that takes".
    return age >= 0 && age < VOLUME_HOLD_MS ? command.level : null;
}

/**
 * Ms the slider goes on showing its own value instead of the observed volume; 0 = the hold is
 * over. It ends when the level it asked for is observed (once let go), when the volume it would
 * be compared with is another device's, or at its deadline.
 */
export function sliderHoldRemaining(
    hold: null | SliderHold,
    scope: null | string,
    observed: number,
    now: number,
): number {
    if (hold === null || hold.scope !== scope) return 0;
    if (!hold.dragging && observed === hold.value) return 0;
    return Math.min(VOLUME_HOLD_MS, Math.max(0, hold.until - now));
}
