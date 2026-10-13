// navi-connect: what a kick does. Pure, so the decision can be tested without Electron or a
// socket (kick.harness.ts); the hub client (index.ts) carries it out.
//
// The client reconnects on a backoff that reaches 30 s and finds a dead socket by a 10 s
// heartbeat. Both suit a hub that is down, and neither suits the two moments when the link is
// known to have just changed - the machine woke, the network came back - where the client could
// sit disconnected for most of a minute. A kick is "look now".

/** Kicks arrive in bursts (a wake fires `resume` and `online` together): one attempt per this. */
export const KICK_FLOOR_MS = 2000;

/**
 * - `connect`: nothing is connected or connecting (the backoff is being waited out) - connect now.
 * - `replace`: a handshake is in flight - abandon it for a fresh one.
 * - `probe`: the socket is open - ask it, and drop it only if it does not answer.
 * - `none`: not meant to run, kicked a moment ago, or a socket already on its way out (its
 *   close reconnects).
 */
export type KickAction = 'connect' | 'none' | 'probe' | 'replace';

export interface KickState {
    /** The current socket's `readyState` (0 CONNECTING, 1 OPEN, 2 CLOSING); undefined without one. */
    readyState: number | undefined;
    /** Meant to be connected: switched on, and not refused by the hub. */
    shouldRun: boolean;
    /** Wall-clock ms since the last kick that did something. */
    sinceLastKick: number;
}

export function kickAction({ readyState, shouldRun, sinceLastKick }: KickState): KickAction {
    if (!shouldRun) return 'none';
    // Wall clock on purpose: a monotonic one may not count the time asleep, and the kick after a
    // long sleep must not look like the second of a burst. A clock set back (negative) is no burst.
    if (sinceLastKick >= 0 && sinceLastKick < KICK_FLOOR_MS) return 'none';
    switch (readyState) {
        case 0:
            return 'replace';
        case 1:
            return 'probe';
        case undefined:
            return 'connect';
        default:
            return 'none';
    }
}
