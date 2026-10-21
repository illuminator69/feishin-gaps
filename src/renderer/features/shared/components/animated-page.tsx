import type { ReactNode, Ref } from 'react';

import { forwardRef } from 'react';

import styles from './animated-page.module.css';

import { useNavDirection } from '/@/renderer/features/motion/use-nav-direction';

interface AnimatedPageProps {
    children: ReactNode;
}

/**
 * A route's page. It arrives with the grammar's push or pop (design brief 8): 18 px from the right on a
 * push, from the left on a back, a fade otherwise, 220 ms, and no exit (the old page leaves at once).
 */
export const AnimatedPage = forwardRef(
    ({ children }: AnimatedPageProps, ref: Ref<HTMLDivElement>) => {
        const direction = useNavDirection();

        return (
            <main className={styles.animatedPage} data-nav={direction} ref={ref}>
                {children}
            </main>
        );
    },
);
