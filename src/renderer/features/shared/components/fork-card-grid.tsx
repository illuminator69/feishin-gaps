import type { CSSProperties, ReactNode } from 'react';

import clsx from 'clsx';

import styles from './fork-card-grid.module.css';

import { useGridCarouselContainerQuery } from '/@/renderer/components/grid-carousel/grid-carousel-v2';

/**
 * A grid of cards that is not a carousel (a week of Fresh releases, an artist's
 * discography from lb-bot), with the carousel's own column counts: 8 from 1440px of
 * container, 7, 6, 5, 4, 3, else 2, the breakpoints `GridCarousel` pages by. So a card
 * here is the size of a card in the Home rows beside it at every window width. These
 * grids were `repeat(auto-fill, minmax(150px, 1fr))`: about 13 columns of small covers
 * on a wide screen where the app's own rows show eight.
 */
export const ForkCardGrid = ({ children }: { children: ReactNode }) => {
    const cq = useGridCarouselContainerQuery();
    const columns = cq.is3xl
        ? 8
        : cq.is2xl
          ? 7
          : cq.isXl
            ? 6
            : cq.isLg
              ? 5
              : cq.isMd
                ? 4
                : cq.isSm
                  ? 3
                  : 2;

    return (
        <div
            className={clsx(styles.grid, { [styles.measuring]: !cq.isCalculated })}
            ref={cq.ref}
            style={{ '--columns': columns } as CSSProperties}
        >
            {children}
        </div>
    );
};
