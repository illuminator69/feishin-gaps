/**
 * B-175: a radio started from the song that is playing keeps that song playing.
 *
 * A station's queue is its seed, then what the station serves. Played with Play.NOW, that queue
 * replaced the playing row with a new one for the same song, so the song restarted from 0. When
 * the queue's first song is the current one, the current row is kept (same row id, same position)
 * and only what follows it is replaced.
 *
 * Kept free of imports so `node --test` can run it.
 */

/** The station queue starts with the song that is current (on this device, or the remote one). */
export const keepsCurrentSong = (
    songs: readonly { id: string }[],
    currentId: null | string | undefined,
): boolean => Boolean(currentId) && songs.length > 0 && songs[0].id === currentId;

/**
 * The queue order after a radio from the current song: the current row, then the tail, with the
 * current row at index 0. With track shuffle on, the tail's order is shuffled as Play.NOW and
 * Play.NEXT shuffle what they add, and the current row stays first in the shuffled order.
 */
export const keepCurrentThen = (
    currentUniqueId: string,
    tailUniqueIds: readonly string[],
    shuffle: ((indexes: number[]) => number[]) | null,
): { default: string[]; index: number; shuffled: number[] } => ({
    default: [currentUniqueId, ...tailUniqueIds],
    index: 0,
    shuffled: shuffle ? [0, ...shuffle(tailUniqueIds.map((_, i) => i + 1))] : [],
});
