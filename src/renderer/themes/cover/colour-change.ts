/**
 * How a cover change is shown (audit A-01). The wash's backdrop is drawn on two layers that each carry
 * fixed colours, and a change cross-fades their opacity, which the compositor animates. The page's own
 * roles (text, accent, surfaces) switch once, at the fade's midpoint: easing them meant restyling every
 * element on every frame. Pure: no app imports, so node can load it for the harness.
 */

import type { Role, Roles } from './cover-roles.ts';

import { oklchCss } from './oklch.ts';

/** The backdrop's cross-fade, with `--fold-ease` (design brief 8: colour changes ease over 300 ms). */
export const COLOUR_FADE_MS = 300;

/** When the page's roles switch: the backdrop is half-way. */
export const ROLE_SWITCH_MS = 150;

export type WashMode = 'dark' | 'light' | 'neutral';

/** The first application (a cold start, Cover colours turned on) and reduced motion switch at once. */
export const switchDelayMs = ({ first, reduced }: { first: boolean; reduced: boolean }): number =>
    first || reduced ? 0 : ROLE_SWITCH_MS;

/** How much of the band's tone the veil lays over the artwork, top and middle. */
const VEIL: Record<WashMode, [string, string]> = {
    dark: ['78%', '86%'],
    light: ['50%', '60%'],
    neutral: ['100%', '100%'],
};

const css = (role: Role) => oklchCss(role, role.a);

/** One backdrop layer's own variables: fixed colours, never a `var()` that would change under it. */
export const toneVars = (roles: Roles, mode: WashMode): Record<string, string> => ({
    '--tone-bar': css(roles.bar),
    '--tone-bot': css(roles.bot),
    '--tone-mid': css(roles.mid),
    '--tone-ov1': VEIL[mode][0],
    '--tone-ov2': VEIL[mode][1],
    '--tone-top': css(roles.top),
});

/** Two layers; the front one is shown (or fading in), the other is what it fades in over. */
export interface LayerPair<T> {
    front: 0 | 1;
    items: [null | T, null | T];
}

/**
 * Puts `next` on the other slot and makes it the front. The current front item stays in its slot:
 * it is what is shown, even if it was itself still fading in. Returns `pair` when `next` is already
 * the front item.
 */
export const flipLayers = <T>(
    pair: LayerPair<T>,
    next: T,
    same: (a: T, b: T) => boolean,
): LayerPair<T> => {
    const current = pair.items[pair.front];
    if (current !== null && same(current, next)) return pair;
    const front = pair.front === 0 ? 1 : 0;
    const items: LayerPair<T>['items'] = [...pair.items];
    items[front] = next;
    return { front, items };
};
