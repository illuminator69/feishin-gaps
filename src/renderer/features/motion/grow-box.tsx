import { ReactNode, useLayoutEffect, useRef } from 'react';

import styles from './grow-box.module.css';

import { growTarget } from '/@/renderer/features/motion/grow';

/**
 * A box that follows its content's height (the request box, brief 8): a step with more lines grows in
 * 300 ms, 450 ms when the change is tall, easing (.3, .7, .2, 1); it clips only while moving, the rows
 * below move with it rather than jumping, and it never takes focus. Under reduced motion the height
 * just changes.
 */
export const GrowBox = ({ children, name }: { children: ReactNode; name?: string }) => {
    const outer = useRef<HTMLDivElement>(null);
    const inner = useRef<HTMLDivElement>(null);
    const last = useRef(0);

    useLayoutEffect(() => {
        const box = outer.current;
        const content = inner.current;
        if (!box || !content) return undefined;
        let moving: Animation | null = null;
        const observer = new ResizeObserver(() => {
            const next = content.offsetHeight;
            const prev = last.current;
            last.current = next;
            // Asked at the moment of the change, so a preference changed while the page is open counts.
            const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            const { animate, ms } = growTarget(prev, next, reduced);
            // From wherever the box is drawn now (the last height, or mid-move), to the new content
            // height. The Web Animations API, not a CSS transition: a height set from inside a resize
            // observer did not register as a transition's start here.
            const from = moving ? box.getBoundingClientRect().height : prev;
            moving?.cancel();
            moving = null;
            if (!animate) {
                box.removeAttribute('data-moving');
                return;
            }
            box.setAttribute('data-moving', '');
            const animation = box.animate([{ height: `${from}px` }, { height: `${next}px` }], {
                duration: ms,
                easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)',
            });
            moving = animation;
            animation.onfinish = () => {
                if (moving !== animation) return;
                moving = null;
                box.removeAttribute('data-moving');
            };
        });
        observer.observe(content);
        return () => {
            observer.disconnect();
            moving?.cancel();
        };
    }, []);

    return (
        <div className={styles.box} data-grow={name} ref={outer}>
            <div ref={inner}>{children}</div>
        </div>
    );
};
