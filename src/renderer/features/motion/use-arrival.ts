import { useReducedMotion } from 'motion/react';
import { CSSProperties, useRef } from 'react';

import styles from './arrival.module.css';

import {
    arrivalFor,
    type ArrivalWindow,
    openArrival,
} from '/@/shared/components/animations/arrival';

export type ArrivalProps = { className: string; 'data-arrive': string; style: CSSProperties };

/**
 * One arrival window per mounted list: it opens on the first render where `ready` is true and closes
 * 900 ms later, so items that mount afterwards (a page flip, a scroll, a refetch) never animate.
 * `propsFor(index)` is fresh on every call: a list of memoised children computes it once per change
 * of the list (useMemo), not on every render. Nothing under reduced motion.
 */
export const useArrival = (ready: boolean) => {
    const reduced = useReducedMotion();
    const windowRef = useRef<ArrivalWindow>({ openedAt: null });
    // The window is the time the list first rendered with content: reading the clock here is the point,
    // and openArrival never moves a window once it is open, so a re-render gives the same answer.
    // eslint-disable-next-line react-hooks/purity
    windowRef.current = openArrival(windowRef.current, performance.now(), ready);

    const propsFor = (index: number): ArrivalProps | undefined => {
        if (reduced) return undefined;
        const arrival = arrivalFor(windowRef.current, performance.now(), index);
        if (!arrival) return undefined;
        return {
            className: styles.arrive,
            'data-arrive': '',
            style: { '--arrive-delay': `${arrival.delayMs}ms` } as CSSProperties,
        };
    };

    return { propsFor };
};
