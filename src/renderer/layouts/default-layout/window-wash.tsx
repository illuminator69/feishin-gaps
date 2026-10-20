import clsx from 'clsx';
import { useEffect, useState } from 'react';

import styles from './window-wash.module.css';

import { useCoverWashOn, useCoverWashStore } from '/@/renderer/themes/cover/cover-wash.store';

interface ArtLayers {
    front: 0 | 1;
    /** Nothing shown: set when nothing plays, cleared once the next cover is on a layer. */
    neutral: boolean;
    srcs: [null | string, null | string];
}

/**
 * The cover wash behind the whole window: tone gradient, blurred artwork, veil. Rendered only while
 * `Cover colours` is on, and then always the same elements whatever the state (only values change). A new
 * cover is decoded first, then fades in on the other art layer over the old one. After nothing
 * playing, the artwork stays hidden until the new cover is on its layer (not the old one again).
 */
export const WindowWash = () => {
    const on = useCoverWashOn();
    const artSrc = useCoverWashStore((state) => state.artSrc);
    const light = useCoverWashStore((state) => state.light);
    const [art, setArt] = useState<ArtLayers>({
        front: 0,
        neutral: !artSrc,
        srcs: [artSrc, null],
    });

    useEffect(() => {
        if (!artSrc) {
            setArt((current) => (current.neutral ? current : { ...current, neutral: true }));
            return undefined;
        }
        let live = true;
        const image = new Image();
        image.src = artSrc;
        // A cover that cannot decode is swapped in anyway: an empty layer, not the previous cover.
        image
            .decode()
            .catch(() => undefined)
            .then(() => {
                if (!live) return;
                setArt((current) => {
                    if (current.srcs[current.front] === artSrc) {
                        return current.neutral ? { ...current, neutral: false } : current;
                    }
                    const front = current.front === 0 ? 1 : 0;
                    // Out of nothing playing, the old cover is dropped rather than shown under the new one.
                    const srcs: ArtLayers['srcs'] = current.neutral
                        ? [null, null]
                        : [...current.srcs];
                    srcs[front] = artSrc;
                    return { front, neutral: false, srcs };
                });
            });
        return () => {
            live = false;
        };
    }, [artSrc]);

    if (!on) return null;

    return (
        <div
            aria-hidden
            className={clsx(styles.wash, {
                [styles.light]: light,
                [styles.neutral]: !artSrc || art.neutral,
            })}
        >
            <div className={styles.art}>
                {art.srcs.map((src, index) => (
                    <div
                        className={clsx(styles.layer, { [styles.front]: index === art.front })}
                        key={index}
                        style={{ backgroundImage: src ? `url(${JSON.stringify(src)})` : undefined }}
                    />
                ))}
            </div>
            <div className={styles.veil} />
        </div>
    );
};
