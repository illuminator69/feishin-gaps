import { ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './clamp-fold.module.css';

import {
    ABOUT_LINES,
    clampFolds,
    clampHeight,
    lineHeightPx,
} from '/@/renderer/features/motion/clamp';
import { FOLD_EASING, growTarget } from '/@/renderer/features/motion/grow';
import { scrollParentOf, USER_INPUT } from '/@/renderer/features/motion/scroll-parent';
import { Icon } from '/@/shared/components/icon/icon';

interface ClampFoldProps {
    children: ReactNode;
    /** The text's own type (font size and line height), on the element the lines are counted in. */
    className?: string;
    /** Room the folded text may fill with more whole lines (`clampHeight`). */
    fillPx?: number;
    initialOpen?: boolean;
    lines?: number;
    /** The test hook, `data-clamp`. */
    name?: string;
    onOpenChange?: (open: boolean) => void;
}

/**
 * R13 (B-243): an About text folded to whole lines, with the arrow under the cut (the artist page's,
 * now on the album page too). A text that fits shows whole, with no arrow and no reserved space. The
 * arrow, not the text, opens it; the height moves on the fold's clock (`--fold-ms`, 450 ms past
 * 240 px, `--fold-ease`, as `GrowBox`), the text stays drawn while it closes, and under reduced
 * motion the height just changes. Closing keeps the arrow where it is on screen (the page scrolls up
 * with the fold, until the user scrolls), so the reader is not left a long text's height down the
 * page.
 */
export const ClampFold = ({
    children,
    className,
    fillPx,
    initialOpen = false,
    lines = ABOUT_LINES,
    name,
    onOpenChange,
}: ClampFoldProps) => {
    const { t } = useTranslation();
    const id = useId();
    const outer = useRef<HTMLDivElement>(null);
    const inner = useRef<HTMLDivElement>(null);
    const button = useRef<HTMLButtonElement>(null);
    const from = useRef<null | number>(null);
    /** The arrow's screen top when a close was pressed with it in view. */
    const arrowTop = useRef<null | number>(null);
    const moving = useRef<Animation | null>(null);
    const [open, setOpen] = useState(initialOpen);
    const [size, setSize] = useState({ collapsed: 0, full: 0 });

    // The text's whole height and the folded one, kept current as the width or the text changes.
    useLayoutEffect(() => {
        const el = inner.current;
        if (!el) return undefined;
        const measure = () => {
            const style = getComputedStyle(el.firstElementChild ?? el);
            const collapsed = clampHeight({
                fillPx,
                lineHeight: lineHeightPx(style.lineHeight, style.fontSize),
                lines,
            });
            const full = el.offsetHeight;
            setSize((prev) =>
                prev.collapsed === collapsed && prev.full === full ? prev : { collapsed, full },
            );
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [fillPx, lines]);

    // After a toggle: from the height drawn at the press (mid-move included) to the new one.
    useLayoutEffect(() => {
        const box = outer.current;
        const start = from.current;
        const anchor = arrowTop.current;
        from.current = null;
        arrowTop.current = null;
        if (!box || start === null) return undefined;
        const end = box.getBoundingClientRect().height;
        // Asked at the moment of the change, so a preference changed while the page is open counts.
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const { animate, ms } = growTarget(start, end, reduced);
        moving.current?.cancel();
        moving.current = null;
        let animation: Animation | null = null;
        if (animate) {
            box.setAttribute('data-moving', '');
            animation = box.animate([{ height: `${start}px` }, { height: `${end}px` }], {
                duration: ms,
                easing: FOLD_EASING,
            });
            moving.current = animation;
            const running = animation;
            running.onfinish = () => {
                if (moving.current !== running) return;
                moving.current = null;
                box.removeAttribute('data-moving');
            };
        } else {
            box.removeAttribute('data-moving');
        }
        if (anchor === null) return undefined;
        // Closing: the page follows the arrow up, frame by frame with the fold, until it settles or
        // the user scrolls.
        const scroller = scrollParentOf(box);
        let frame = 0;
        const hold = () => {
            const arrow = button.current;
            if (scroller && arrow) {
                const moved = arrow.getBoundingClientRect().top - anchor;
                if (Math.abs(moved) > 0.5) scroller.scrollTop += moved;
            }
            if (animation && moving.current === animation) frame = requestAnimationFrame(hold);
            else stop();
        };
        const stop = () => {
            cancelAnimationFrame(frame);
            USER_INPUT.forEach((name) => window.removeEventListener(name, stop, true));
        };
        USER_INPUT.forEach((name) =>
            window.addEventListener(name, stop, { capture: true, passive: true }),
        );
        hold();
        return stop;
    }, [open]);

    useEffect(() => () => moving.current?.cancel(), []);

    const folds = clampFolds(size.full, size.collapsed);
    const clamped = folds && !open;

    const toggle = () => {
        if (outer.current) from.current = outer.current.getBoundingClientRect().height;
        const top = button.current?.getBoundingClientRect().top;
        arrowTop.current =
            open && top !== undefined && top >= 0 && top <= window.innerHeight ? top : null;
        const next = !open;
        setOpen(next);
        onOpenChange?.(next);
    };

    return (
        <div className={styles.clamp} data-clamp={name}>
            <div
                className={styles.box}
                data-clamp-box=""
                data-clamped={clamped ? 'true' : undefined}
                id={id}
                ref={outer}
                style={clamped ? { height: size.collapsed } : undefined}
            >
                <div className={className} ref={inner}>
                    {children}
                </div>
            </div>
            {folds && (
                <button
                    aria-controls={id}
                    aria-expanded={open}
                    aria-label={t(open ? 'common.collapse' : 'common.expand')}
                    className={styles.toggle}
                    data-clamp-toggle=""
                    data-open={open ? 'true' : 'false'}
                    onClick={toggle}
                    ref={button}
                    title={t(open ? 'common.collapse' : 'common.expand')}
                    type="button"
                >
                    <Icon icon="arrowDownS" size="lg" />
                </button>
            )}
        </div>
    );
};
