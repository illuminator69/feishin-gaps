import { useEffect } from 'react';

import { placePinnedRow } from '/@/renderer/components/item-list/item-table-list/utils/place-pinned-row';

interface UseStickyGroupRowPositioningProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    shouldRenderStickyGroupRow: boolean;
    stickyGroupRowRef: React.RefObject<HTMLDivElement | null>;
    /** The viewport line the row pins under. */
    top: number;
}

/**
 * Hook to update the position and width of the sticky group row based on container position: top and
 * left are written against the block the row is fixed to (`placePinnedRow`).
 */
export const useStickyGroupRowPositioning = ({
    containerRef,
    shouldRenderStickyGroupRow,
    stickyGroupRowRef,
    top,
}: UseStickyGroupRowPositioningProps) => {
    useEffect(() => {
        if (!shouldRenderStickyGroupRow || !stickyGroupRowRef.current || !containerRef.current) {
            return;
        }

        const stickyGroupRow = stickyGroupRowRef.current;
        const container = containerRef.current;
        let isMounted = true;

        const updatePosition = () => {
            // Guard against updates after unmount
            if (!isMounted || !stickyGroupRow || !container) {
                return;
            }
            try {
                placePinnedRow(stickyGroupRow, container, top);
            } catch {
                // Silently handle errors if elements are no longer in DOM
            }
        };

        updatePosition();

        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        // The page's arrival animation moves the block the row is fixed to; place it again at its end.
        window.addEventListener('animationend', updatePosition, true);

        return () => {
            isMounted = false;
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
            window.removeEventListener('animationend', updatePosition, true);
        };
    }, [containerRef, shouldRenderStickyGroupRow, stickyGroupRowRef, top]);
};
