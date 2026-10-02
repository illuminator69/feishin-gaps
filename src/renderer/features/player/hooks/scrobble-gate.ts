/**
 * Q-041: should a seek-driven pause/unpause report be skipped because the current
 * queue item has never actually played?
 *
 * An adopt / queue restore reloads the queue paused; the store gives the item a fresh
 * `_uniqueId` and the seek target resets to 0, which used to be reported as
 * `pause @ 0 ms` (and started the 1 s seek throttle, swallowing the real seek).
 * A paused item that has not played since it became current has nothing to report.
 *
 * Pure so it can be tested without React (see scrobble-gate.harness.ts).
 */
export function shouldSkipUnplayedSeekReport(params: {
    currentUniqueId: string | undefined;
    isPlaying: boolean;
    playedUniqueId: string | undefined;
}): boolean {
    if (params.isPlaying) return false;
    return params.playedUniqueId !== params.currentUniqueId;
}
