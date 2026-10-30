import clsx from 'clsx';
import {
    type ComponentPropsWithoutRef,
    type MouseEvent,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import styles from './sideways-row.module.css';
import {
    hiddenSides,
    scrollStep,
    type SidewaysWheel,
    sidewaysWheelTarget,
} from './sideways-scroll';

import { ActionIcon } from '/@/shared/components/action-icon/action-icon';

type SidewaysRowProps = ComponentPropsWithoutRef<'div'> & {
    /** The scrolling element's tag: `nav` for the Library's sections. */
    as?: 'div' | 'nav';
    /** Whether a plain vertical wheel scrolls the row (`sideways-scroll.ts`). */
    wheel: SidewaysWheel;
};

const keepFocus = (event: MouseEvent) => event.preventDefault();

const behavior = (): ScrollBehavior =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

/**
 * B-285: one line of chips that scrolls sideways with no scrollbar, the one mechanism every such
 * row uses. A side with hidden content fades out at its edge and, under the pointer or with focus
 * in the row, shows a chevron button that moves the row most of a width that way; a side with
 * nothing hidden shows neither, so a row that fits looks like a plain row. On a row in fixed chrome
 * (`wheel="chrome"`) a vertical mouse wheel scrolls it sideways until it reaches that end, then
 * goes on to the page; a row in a scrolling page leaves the plain wheel to the page. A touchpad's
 * sideways swipe and Shift+wheel are the browser's own on both. Focus moving to a hidden chip
 * scrolls it into view natively, clear of the buttons (`scroll-padding-inline`).
 *
 * The props other than `as` and `wheel` go to the scrolling element, which holds the chips.
 */
export const SidewaysRow = ({
    as: Tag = 'div',
    children,
    className,
    wheel,
    ...props
}: SidewaysRowProps) => {
    const { t } = useTranslation();
    const ref = useRef<HTMLDivElement>(null);
    const [sides, setSides] = useState({ end: false, start: false });
    // Where a glide in progress is heading, so quick notches and presses add up; cleared at its end.
    const goingTo = useRef<null | number>(null);
    const observer = useRef<null | ResizeObserver>(null);

    const measure = () => {
        const row = ref.current;
        if (!row) return;
        const next = hiddenSides(row);
        setSides((previous) =>
            previous.start === next.start && previous.end === next.end ? previous : next,
        );
    };

    const glideTo = (left: number) => {
        const row = ref.current;
        if (!row || left === row.scrollLeft) return;
        const how = behavior();
        goingTo.current = how === 'smooth' ? left : null;
        row.scrollTo({ behavior: how, left });
    };

    // Every render: the chips may have changed. New chips are observed for their own size too.
    useLayoutEffect(() => {
        measure();
        const row = ref.current;
        if (!row || !observer.current) return;
        for (const chip of Array.from(row.children)) observer.current.observe(chip);
    });

    useEffect(() => {
        const row = ref.current;
        if (!row) return undefined;
        const onScroll = () => measure();
        const onScrollEnd = () => {
            goingTo.current = null;
            measure();
        };
        row.addEventListener('scroll', onScroll, { passive: true });
        row.addEventListener('scrollend', onScrollEnd);
        // The row resizing (a window, the queue docking) and a chip resizing (a label arriving).
        const resize = new ResizeObserver(() => measure());
        resize.observe(row);
        for (const chip of Array.from(row.children)) resize.observe(chip);
        observer.current = resize;
        return () => {
            row.removeEventListener('scroll', onScroll);
            row.removeEventListener('scrollend', onScrollEnd);
            resize.disconnect();
            observer.current = null;
        };
    }, []);

    useEffect(() => {
        const row = ref.current;
        if (!row || wheel !== 'chrome') return undefined;
        const onWheel = (event: WheelEvent) => {
            const left = sidewaysWheelTarget(row, event, wheel, goingTo.current ?? row.scrollLeft);
            if (left === null) return;
            event.preventDefault();
            glideTo(left);
        };
        // Not passive: a wheel the row takes must not also scroll the page.
        row.addEventListener('wheel', onWheel, { passive: false });
        return () => row.removeEventListener('wheel', onWheel);
    }, [wheel]);

    const press = (direction: -1 | 1) => {
        const row = ref.current;
        if (row) glideTo(scrollStep(row, direction, goingTo.current ?? row.scrollLeft));
    };

    return (
        <div
            className={styles.frame}
            data-end={sides.end || undefined}
            data-start={sides.start || undefined}
        >
            <Tag {...props} className={clsx(styles.scroller, className)} ref={ref}>
                {children}
            </Tag>
            {/* Pointer buttons: Tab moves through the chips themselves, each scrolled into view. A
                press leaves focus where it was, so the buttons do not stay up after the pointer
                leaves. */}
            <ActionIcon
                aria-label={t('action.scrollLeft')}
                className={styles.button}
                data-side="start"
                icon="arrowLeftS"
                inert={!sides.start}
                onClick={() => press(-1)}
                onMouseDown={keepFocus}
                radius="xl"
                size="xs"
                tabIndex={-1}
                variant="default"
            />
            <ActionIcon
                aria-label={t('action.scrollRight')}
                className={styles.button}
                data-side="end"
                icon="arrowRightS"
                inert={!sides.end}
                onClick={() => press(1)}
                onMouseDown={keepFocus}
                radius="xl"
                size="xs"
                tabIndex={-1}
                variant="default"
            />
        </div>
    );
};
