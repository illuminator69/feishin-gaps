import type { MotionProps } from 'motion/react';
import type { ReactNode, Ref } from 'react';

import { motion } from 'motion/react';
import { forwardRef } from 'react';

import styles from './animated-page.module.css';

import { animationProps } from '/@/shared/components/animations/animation-props';
import { pageTransition, pageVariants } from '/@/shared/components/animations/motion-tokens';
import { useExpressiveMotion } from '/@/renderer/store/settings.store';

interface AnimatedPageProps {
    children: ReactNode;
}

export const AnimatedPage = forwardRef(
    ({ children }: AnimatedPageProps, ref: Ref<HTMLDivElement>) => {
        const expressiveMotion = useExpressiveMotion();

        // Expressive motion: Navic-style shared-axis page change (fade + small slide).
        // Off: the prior plain fade, unchanged.
        const motionProps: MotionProps = expressiveMotion
            ? {
                  animate: 'show',
                  initial: 'hidden',
                  transition: pageTransition,
                  variants: pageVariants,
              }
            : { ...animationProps.fadeIn, transition: { duration: 0.5, ease: 'anticipate' } };

        return (
            <motion.main className={styles.animatedPage} ref={ref} {...motionProps}>
                {children}
            </motion.main>
        );
    },
);
