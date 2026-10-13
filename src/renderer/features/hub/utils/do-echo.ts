// navi-connect (I-031): which of the hub's numbered directives this receiver has carried out.
// Pure, so the rule can be tested without React or the player (do-echo.harness.ts).
//
// A report used to be judged by a clock: for 2 s after a play, pause or seek the hub ignored a
// report that contradicted it. A report sampled before a directive took effect but sent after
// those 2 s (a pause held up behind a slow load), or one about a field the clock did not cover
// (the index, after a skip), moved the session back to the state just left.
//
// So the hub numbers the directives that change what a report says (`seq` on load, play, pause,
// seek, jump, queueChanged, clear) for a receiver with the cap `cmdEcho`, and every report
// carries `applied`: the highest number whose directive has ENDED here. The hub drops a report
// whose `applied` is behind the last number it sent. What that asks of this side (PROTOCOL
// §5.2-5.3):
//   - `applied` only moves forward, and only for a directive that arrived on the connection
//     that is current when it ends. `welcome` is the one reset, on both sides;
//   - it moves when the directive has ended, whichever way: carried out, refused, failed;
//   - when it moves a report follows at once, read from the player at that moment - except
//     after a transfer's load that was answered `loaded {ok:false}`, which the hub rolls back
//     (and after `release`, which carries no number and sends its own last report).

export interface DoEcho {
    /** The highest `seq` whose directive has ended on this connection; 0 before any. */
    applied: number;
    /** Counts connections, so a directive still running from an earlier one is told apart. */
    conn: number;
}

/** How a directive ended, for the report that follows `applied` moving: sent, or not. */
export type DoExit = 'echo' | 'silent';

export const NO_ECHO: DoEcho = { applied: 0, conn: 0 };

/** The socket went: a directive still waiting or running here belongs to no connection now. */
export function echoDisconnected(echo: DoEcho): DoEcho {
    return { applied: echo.applied, conn: echo.conn + 1 };
}

/**
 * A directive that arrived on connection `conn` has ended. The state with `applied` moved, or
 * null when it stays where it is: the directive carried no number, it arrived on an earlier
 * connection, or its number is not ahead of what is already applied.
 */
export function echoSettled(echo: DoEcho, seq: unknown, conn: number): DoEcho | null {
    if (typeof seq !== 'number' || !Number.isInteger(seq)) return null;
    if (conn !== echo.conn || seq <= echo.applied) return null;
    return { applied: seq, conn: echo.conn };
}

/** `welcome`: a new connection. The hub forgot what it had sent this device as it wrote it. */
export function echoWelcome(echo: DoEcho): DoEcho {
    return { applied: 0, conn: echo.conn + 1 };
}

/**
 * How a load that could not start ends. A transfer's (it carried a `transferId`) is rolled back
 * by the hub on the `loaded {ok:false}`, and a report now would describe a player the session
 * is about to leave. Any other load has nobody to roll it back: the caller pauses, and the
 * report says "not playing".
 */
export function failedLoadExit(transferId: unknown): DoExit {
    return transferId === undefined || transferId === null ? 'echo' : 'silent';
}
