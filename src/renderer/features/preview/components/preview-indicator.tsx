import styles from './preview-indicator.module.css';

import { isPreviewId } from '/@/renderer/features/preview/preview-track';

/**
 * "This is not your copy."
 *
 * A preview sits in the same queue, on the same playerbar, next to tracks the
 * library actually holds — and it behaves identically, which is the point of the
 * design and also its one hazard: without a marker there is nothing to
 * distinguish a record you own from a stream that stops working when its
 * capability token expires.
 *
 * Rendered from the id alone rather than from a flag on the row, so every list
 * gets it for free and none of them can forget to pass it. Absent — not
 * greyed — for an ordinary track, so a library with no previews in it looks
 * exactly as it did before.
 */
export const PreviewIndicator = ({ id }: { id: null | string | undefined }) => {
    if (!isPreviewId(id)) return null;
    return (
        <span aria-label="Preview" className={styles.root} title="Preview — not in your library">
            Preview
        </span>
    );
};
