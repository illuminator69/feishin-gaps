/**
 * The images an image element shows while its request changes (BaseImage): the newest last. The one
 * kept underneath a new image is the last one that loaded, so changing twice fast never leaves an
 * empty frame; it goes once the new one has loaded (and faded in). Pure, for the harness.
 */
export type ShownEntry = { fade: boolean; loaded: boolean; src: string };

export const showNext = (list: ShownEntry[], src: string, fade: boolean): ShownEntry[] => {
    if (list[list.length - 1]?.src === src) return list;
    const under = [...list].reverse().find((entry) => entry.loaded && entry.src !== src);
    return [...(under ? [under] : []), { fade, loaded: false, src }];
};

export const markLoaded = (list: ShownEntry[], src: string): ShownEntry[] =>
    list.map((entry) => (entry.src === src && !entry.loaded ? { ...entry, loaded: true } : entry));

/** Drop what is underneath once the newest has loaded. */
export const dropUnder = (list: ShownEntry[]): ShownEntry[] => {
    const top = list[list.length - 1];
    return list.length > 1 && top?.loaded ? [top] : list;
};
