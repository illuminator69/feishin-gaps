import { useEffect } from 'react';

import { placePinnedRow } from '/@/renderer/components/item-list/item-table-list/utils/place-pinned-row';

interface UseStickyHeaderPositioningProps {
    containerRef: React.RefObject<HTMLDivElement | null>;
    shouldShowStickyHeader: boolean;
    stickyHeaderRef: React.RefObject<HTMLDivElement | null>;
    /** The viewport line the row pins under. */
    top: number;
}

/**
 * Hook to update the position and width of the sticky header based on container position: top and
 * left are written against the block the row is fixed to (`placePinnedRow`).
 * Scroll synchronization is handled separately in useStickyTableHeader.
 */
export const useStickyHeaderPositioning = ({
    containerRef,
    shouldShowStickyHeader,
    stickyHeaderRef,
    top,
}: UseStickyHeaderPositioningProps) => {
    useEffect(() => {
        if (!shouldShowStickyHeader || !stickyHeaderRef.current || !containerRef.current) {
            return;
        }

        const stickyHeader = stickyHeaderRef.current;
        const container = containerRef.current;
        let isMounted = true;

        const updatePosition = () => {
            // Guard against updates after unmount
            if (!isMounted || !stickyHeader || !container) {
                return;
            }
            try {
                placePinnedRow(stickyHeader, container, top);
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
    }, [containerRef, shouldShowStickyHeader, stickyHeaderRef, top]);
};
