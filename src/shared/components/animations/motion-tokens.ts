/**
 * Durations and easings for the two motion/react transitions the shell keeps (the sidebar and
 * rail crossfade, the command palette's group fold). Both turn off under reduced motion; CSS
 * motion uses the tokens in global.css (the arrival grammar, design brief 8).
 */

// Material 3 duration tokens (ms).
export const DURATION = {
    long1: 450,
    long2: 500,
    medium1: 250,
    medium2: 300,
} as const;

// Emphasized easings as cubic-bezier control points (motion/react `ease` arrays).
type Bezier = [number, number, number, number];

export const EASING: Record<
    'emphasized' | 'emphasizedAccelerate' | 'emphasizedDecelerate',
    Bezier
> = {
    emphasized: [0.2, 0, 0, 1],
    emphasizedAccelerate: [0.3, 0, 0.8, 0.15],
    emphasizedDecelerate: [0.05, 0.7, 0.1, 1],
};
