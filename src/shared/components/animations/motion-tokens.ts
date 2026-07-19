import type { MantineTransition } from '@mantine/core';
import type { Transition, Variants } from 'motion/react';

/**
 * Shared "expressive" motion vocabulary, ported from Navic's Material3Transitions.kt so
 * the two clients feel related. Durations and emphasized easings live here; call sites
 * pull from them instead of hardcoding timing.
 *
 * Gated by the Appearance "Expressive motion" toggle (data-motion on the root). When the
 * toggle is off, call sites fall back to their prior/plain transitions — these tokens are
 * only applied on the enabled path, so motion can be turned off safely.
 */

// Material 3 duration tokens (ms).
export const DURATION = {
    long1: 450,
    long2: 500,
    medium1: 250,
    medium2: 300,
} as const;

// Emphasized easings as cubic-bezier control points (motion/react `ease` arrays).
// `emphasized` approximates Navic's two-segment PathEasing with the M3 standard-emphasized
// bezier (CSS/JS can't express an arbitrary path), which is a close visual match.
type Bezier = [number, number, number, number];

export const EASING: Record<'emphasized' | 'emphasizedAccelerate' | 'emphasizedDecelerate', Bezier> =
    {
        emphasized: [0.2, 0, 0, 1],
        emphasizedAccelerate: [0.3, 0, 0.8, 0.15],
        emphasizedDecelerate: [0.05, 0.7, 0.1, 1],
    };

const bezierCss = (points: Bezier) => `cubic-bezier(${points.join(', ')})`;

// Same easings as CSS strings (Mantine `timingFunction`, CSS custom properties).
export const EASING_CSS = {
    emphasized: bezierCss(EASING.emphasized),
    emphasizedAccelerate: bezierCss(EASING.emphasizedAccelerate),
    emphasizedDecelerate: bezierCss(EASING.emphasizedDecelerate),
};

/**
 * Navic's "Shared Z-axis" (fade + scale) as a Mantine custom transition, for modals.
 * Direction-specific easing isn't expressible in a single Mantine transition, so we
 * approximate decelerate-in / accelerate-out with asymmetric durations at the call site
 * (longer enter, shorter exit) and the emphasized easing.
 */
export const sharedZAxisTransition: MantineTransition = {
    common: { transformOrigin: 'center bottom' },
    in: { opacity: 1, transform: 'scale(1)' },
    out: { opacity: 0, transform: 'scale(0.9)' },
    transitionProperty: 'transform, opacity',
};

const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Mantine transitionProps for overlays. When motion is enabled, returns the emphasized
 * spec; when disabled, returns the component's prior/plain spec so behavior is unchanged.
 * If the OS prefers reduced motion, the emphasized path degrades to a quick opacity-only
 * fade (no scale).
 */
export const modalTransitionProps = (motionEnabled: boolean) => {
    if (!motionEnabled) {
        return { duration: 300, exitDuration: 300, transition: 'fade' as const };
    }

    if (prefersReducedMotion()) {
        return { duration: DURATION.medium1, exitDuration: DURATION.medium1, transition: 'fade' as const };
    }

    return {
        duration: DURATION.long1,
        exitDuration: DURATION.medium1,
        timingFunction: EASING_CSS.emphasized,
        transition: sharedZAxisTransition,
    };
};

/** Emphasized timing/easing for directional-fade overlays (popovers, dropdown menus). */
export const overlayTransitionProps = (motionEnabled: boolean, transition: MantineTransition) => {
    if (!motionEnabled) {
        return { transition };
    }

    if (prefersReducedMotion()) {
        return {
            duration: DURATION.medium1,
            exitDuration: DURATION.medium1,
            transition: 'fade' as const,
        };
    }

    return {
        duration: DURATION.medium2,
        exitDuration: DURATION.medium1,
        timingFunction: EASING_CSS.emphasized,
        transition,
    };
};

// motion/react variants for the context-menu surface: emphasized fade + subtle scale.
export const emphasizedMenuVariants: Variants = {
    hidden: { opacity: 0, scale: 0.96 },
    show: { opacity: 1, scale: 1 },
};

export const emphasizedMenuTransition: Transition = {
    duration: DURATION.medium2 / 1000,
    ease: EASING.emphasized,
};

// motion/react transition for route/page changes (Navic's shared-axis feel).
export const pageTransition: Transition = {
    duration: DURATION.long1 / 1000,
    ease: EASING.emphasized,
};

export const pageVariants: Variants = {
    hidden: { opacity: 0, x: 12 },
    show: { opacity: 1, x: 0 },
};
