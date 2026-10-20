// navi-connect (I-032): what the device picker says about a device - its icon, its place in the
// list and its status. Pure, so the rules can be tested without React or the hub store
// (device-rows.harness.ts); device-rows-list.tsx draws them.
//
// A row used to tell a speaker from a phone by an emoji in its name, the list came in the hub's
// order (the order devices first registered in), and the device that is playing could be
// anywhere in it. Now:
//   - a device says what it is in `hello` (`kind`), and the row draws an icon for it. A value
//     this build does not know, or none (an older client), draws the generic one;
//   - the order is: the device the session is on, this device, the rest by name, then the ones
//     that cannot be played to (not responding, offline);
//   - the device the session is on reads "playing" only while the session is: paused, it still
//     holds the session and says "paused";
//   - a device that is NOT playing gets a volume slider in its row when it can be set from
//     here (I-033, rowTakesVolume): the hub sends a level to the device an `act:volume` names
//     as `target`, and the device has said it applies one while idle. The session's device has
//     the bar's slider, and this device its own.

/** The icon a row draws: a key of the app's icon map (shared/components/icon). */
export type DeviceIcon =
    | 'deviceComputer'
    | 'deviceGeneric'
    | 'deviceGroup'
    | 'devicePhone'
    | 'deviceSpeaker'
    | 'deviceTablet'
    | 'deviceTv';

/**
 * `blocked`: online and able, but refused as a target for a reason the picker gives (a queue
 * holding a preview a cast receiver cannot fetch).
 */
export type DeviceStatus =
    | 'available'
    | 'blocked'
    | 'notResponding'
    | 'offline'
    | 'paused'
    | 'playing'
    | 'thisDevice';

/** `hello.device.caps`: this device applies `do:setVolume` while it is not the playing one. */
const IDLE_VOLUME = 'idleVolume';

/** `welcome.features`: the hub takes a `target` on `act:volume`. */
const VOLUME_TARGET = 'volumeTarget';

/** The fields of a hub `DeviceInfo` the rules read. */
export interface RowDevice {
    caps?: readonly string[];
    id: string;
    kind?: null | string;
    name: string;
    /** A socket claiming this id is attached. */
    online: boolean;
    /** A bridge's verdict on its hardware; null or absent for an ordinary client. */
    reachable?: boolean | null;
}

/** Who is who, from the hub store. */
export interface RowSession {
    /** The device the session is on, playing or paused. */
    activeDeviceId: null | string;
    isPlaying: boolean;
    myDeviceId: null | string;
}

/** The icon for a device's `kind`; the generic one for a value not known here, or none. */
export function deviceIcon(kind: unknown): DeviceIcon {
    switch (kind) {
        case 'computer':
            return 'deviceComputer';
        case 'group':
            return 'deviceGroup';
        case 'phone':
            return 'devicePhone';
        case 'speaker':
            return 'deviceSpeaker';
        case 'tablet':
            return 'deviceTablet';
        case 'tv':
            return 'deviceTv';
        default:
            return 'deviceGeneric';
    }
}

/** Can the device be played to at all: attached, and its hardware not known to be gone. */
const isPlayable = (device: RowDevice): boolean => device.online && device.reachable !== false;

/**
 * What the row says. The session's device first, whatever else is true of it: it is the one
 * row that must say whether music is running.
 */
export function deviceStatus(
    device: RowDevice,
    session: RowSession,
    blocked = false,
): DeviceStatus {
    if (device.id === session.activeDeviceId) return session.isPlaying ? 'playing' : 'paused';
    if (device.id === session.myDeviceId) return 'thisDevice';
    if (device.online && device.reachable === false) return 'notResponding';
    if (blocked) return 'blocked';
    return device.online ? 'available' : 'offline';
}

/** The row's status in words. `blocked` has no wording of its own: the picker names the reason. */
export function deviceStatusLabel(status: Exclude<DeviceStatus, 'blocked'>): string {
    switch (status) {
        case 'available':
            return 'available';
        case 'notResponding':
            return 'not responding';
        case 'offline':
            return 'offline';
        case 'paused':
            return 'paused';
        case 'playing':
            return 'playing';
        case 'thisDevice':
            return 'this device';
    }
}

/**
 * Does the row get a volume slider? Every other device's volume is set in its own row, playing
 * or not, so a device's slider stays where it was when playback moves: the playing device's
 * row used to have none, and its slider appeared only once the music had gone elsewhere.
 *
 * Only where a level set there lands, and only while the device can be reached: the playing
 * device always (it is the hub's default target, on any hub), any other only against a hub
 * that takes a `target` (an older one would set the PLAYING device's volume instead) and only
 * if it said it applies a volume while idle. Never this device (its own control is on screen).
 */
export function rowTakesVolume(
    device: RowDevice,
    session: Pick<RowSession, 'activeDeviceId' | 'myDeviceId'>,
    features: readonly string[],
): boolean {
    if (!isPlayable(device) || device.id === session.myDeviceId) return false;
    if (device.id === session.activeDeviceId) return true;
    return features.includes(VOLUME_TARGET) && (device.caps ?? []).includes(IDLE_VOLUME);
}

/**
 * The devices in the order the picker lists them: the session's device, this device, the rest
 * by name without regard to case, then those not responding or offline (by name too). Two
 * devices of one name keep a fixed order (by id), so a `devices` frame never swaps them.
 */
export function sortDeviceRows<T extends RowDevice>(
    devices: readonly T[],
    session: Pick<RowSession, 'activeDeviceId' | 'myDeviceId'>,
): T[] {
    const rank = (device: T): number => {
        if (device.id === session.activeDeviceId) return 0;
        if (device.id === session.myDeviceId) return 1;
        return isPlayable(device) ? 2 : 3;
    };
    return [...devices].sort(
        (a, b) =>
            rank(a) - rank(b) ||
            a.name.localeCompare(b.name, undefined, { sensitivity: 'accent' }) ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}
