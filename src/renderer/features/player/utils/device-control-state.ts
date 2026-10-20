// F1: what the player bar's device control shows. Pure (device-control-state.harness.ts);
// use-device-control-state.ts gathers the input from the hub store.
//
//   absent    no hub (disabled, not Electron, or not connected): no control and no gap
//   icon      the device icon alone, which opens the device list
//   transfer  another device holds the session: "Transfer here" moves it to this computer
//   switch    a device just connected and this computer has a song: "Switch to <name>"
//
// An open list shows only the icon: the list itself offers every device.

export interface DeviceControlInput {
    /** A device that just connected (device-arrivals.ts), or null. */
    arrival: null | { id: string; name: string };
    connected: boolean;
    hubEnabled: boolean;
    /** This computer has a song to hand over. */
    localHasSong: boolean;
    pickerOpen: boolean;
    /** The session is on another device, playing or paused. */
    remoteActive: boolean;
    remoteName: string;
}

export type DeviceControlState =
    | { fromName: string; kind: 'transfer' }
    | { kind: 'absent' }
    | { kind: 'icon' }
    | { kind: 'switch'; target: { id: string; name: string } };

export function deviceControlState(input: DeviceControlInput): DeviceControlState {
    if (!input.hubEnabled || !input.connected) return { kind: 'absent' };
    if (input.pickerOpen) return { kind: 'icon' };
    if (input.remoteActive) return { fromName: input.remoteName, kind: 'transfer' };
    if (input.arrival && input.localHasSong) {
        return { kind: 'switch', target: { id: input.arrival.id, name: input.arrival.name } };
    }
    return { kind: 'icon' };
}
