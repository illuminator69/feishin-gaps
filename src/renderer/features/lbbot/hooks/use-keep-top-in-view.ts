import { animate } from 'motion/react';
import { RefObject, useLayoutEffect, useRef } from 'react';

import { shellPinnedTop } from '/@/renderer/components/item-list/item-table-list/utils/shell-pinned-top';
import { scrollToKeepTop } from '/@/renderer/features/lbbot/keep-top';
import { readMotionClock } from '/@/shared/components/animations/motion-tokens';

/** How far under the bar's bottom the box's top comes to rest: the shell's `--panel-gap`. */
const KEEP_TOP_GAP_PX = 8;

/** A press, a wheel, a touch or a key during the move: the user's scroll wins. */
const USER_INPUT = ['keydown', 'pointerdown', 'touchstart', 'wheel'] as const;

const scrollParentOf = (el: HTMLElement | null): HTMLElement | null => {
    for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
        const { overflowY } = getComputedStyle(node);
        if (
            (overflowY === 'auto' || overflowY === 'scroll') &&
            node.scrollHeight > node.clientHeight
        ) {
            return node;
        }
    }
    return null;
};

/**
 * R12 (B-236): when `view` changes in a way `shrinks` names, and the box's top is then above the line
 * under the sticky bar, the page scrolls once so the top sits just under the bar. The line is the
 * bar's real bottom from the shell's variables (`shellPinnedTop`, the one R9's pinned table rows sit
 * under). The move uses the shell's tween (`readMotionClock`), is instant under reduced motion, and
 * stops at the user's first wheel, touch, press or key; nothing happens on any later scroll.
 *
 * A layout effect: the box's top is read after the new view is in the DOM and before it paints. The
 * box follows its content's height (`GrowBox`), which never moves its top.
 */
export const useKeepTopInView = (
    ref: RefObject<HTMLElement | null>,
    view: string,
    shrinks: (prev: string, next: string) => boolean,
) => {
    const last = useRef(view);
    useLayoutEffect(() => {
        const prev = last.current;
        last.current = view;
        const box = ref.current;
        if (prev === view || !box || !shrinks(prev, view)) return undefined;
        const scroller = scrollParentOf(box);
        if (!scroller) return undefined;
        const delta = scrollToKeepTop({
            barBottom: shellPinnedTop(getComputedStyle(box)),
            boxTop: box.getBoundingClientRect().top,
            gap: KEEP_TOP_GAP_PX,
        });
        if (delta === null) return undefined;
        const from = scroller.scrollTop;
        const to = Math.max(0, from + delta);
        // Asked at the moment of the change, so a preference changed while the page is open counts.
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            scroller.scrollTop = to;
            return undefined;
        }
        const clock = readMotionClock();
        const controls = animate(from, to, {
            duration: clock.ms / 1000,
            ease: clock.ease,
            onUpdate: (top) => {
                scroller.scrollTop = top;
            },
        });
        const stop = () => {
            controls.stop();
            USER_INPUT.forEach((name) => window.removeEventListener(name, stop, true));
        };
        USER_INPUT.forEach((name) =>
            window.addEventListener(name, stop, { capture: true, passive: true }),
        );
        void controls.then(stop);
        return stop;
    }, [ref, shrinks, view]);
};
