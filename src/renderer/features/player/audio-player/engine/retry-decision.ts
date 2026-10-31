/**
 * B-138: what the web player does when its <audio> element reports an error.
 *
 * - A network error (code 2) is retried a few times, and each retry resumes where the track was,
 *   so a blip 2 s before the end costs 2 s, not a replay from 0.
 * - A file the browser cannot open (code 4) or decode (code 3) is not retried: retrying it gives
 *   the same error, and upstream's five retries from 0 cost about 18 minutes on one bad file.
 *   The track is skipped through the same path a normal end takes.
 * - An abort (code 1) or an error with no code is left alone, as before.
 *
 * Kept free of DOM globals and enums so `node --test` can run it.
 */

export const MEDIA_ERR_ABORTED = 1;
export const MEDIA_ERR_NETWORK = 2;
export const MEDIA_ERR_DECODE = 3;
export const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

export const MAX_NETWORK_RETRIES = 5;

/** Failed tracks in a row (none of them heard playing) before the player pauses instead of skipping. */
export const MAX_FAILED_IN_A_ROW = 3;

export type RetryDecision =
    | { action: 'ignore' }
    | { action: 'pause' }
    | { action: 'retry'; resumeAt: number }
    | { action: 'skip' };

/**
 * @param code the MediaError code, or undefined when the element has none
 * @param attempt network retries already made for this source
 * @param position the element's currentTime when the error fired, in seconds
 */
export const retryDecision = (
    code: number | undefined,
    attempt: number,
    position: number,
): RetryDecision => {
    if (code === MEDIA_ERR_DECODE || code === MEDIA_ERR_SRC_NOT_SUPPORTED) {
        return { action: 'skip' };
    }

    if (code === MEDIA_ERR_NETWORK) {
        if (attempt < MAX_NETWORK_RETRIES) {
            const resumeAt = Number.isFinite(position) && position > 0 ? position : 0;
            return { action: 'retry', resumeAt };
        }
        return { action: 'pause' };
    }

    return { action: 'ignore' };
};

/**
 * A skip must not come back to the track that just failed: under repeat-one, or repeat-all over a
 * one-track queue, the next track IS this one, so skipping would replay the failure for ever. A run
 * of failures with nothing heard in between (the server is down, every file errors) also pauses,
 * instead of racing through the queue, or round it for ever under repeat-all.
 *
 * @param failedInARow failed tracks in a row, counting this one
 * @param replaysSameTrack the queue's next automatic track is the one that failed
 */
export const afterFailedTrack = (
    failedInARow: number,
    replaysSameTrack: boolean,
): 'pause' | 'skip' => {
    if (replaysSameTrack) return 'pause';
    if (failedInARow >= MAX_FAILED_IN_A_ROW) return 'pause';
    return 'skip';
};

/** Whether the queue's next automatic track is the current one (mirrors calculateNextIndex). */
export const replaysSameTrack = (
    repeat: 'all' | 'none' | 'one',
    playbackLength: number,
): boolean => {
    if (repeat === 'one') return true;
    if (repeat === 'all') return playbackLength <= 1;
    return false;
};
