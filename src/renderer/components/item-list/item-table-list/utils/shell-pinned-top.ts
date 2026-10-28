/**
 * Where a pinned table row sits in the window: under the window bar, the top bar and the page's
 * own sticky title row (`PageHeader`). All three heights are the shell's CSS variables, set on the
 * default layout (`default-layout.module.css`): `--window-bar-height` is 30 px under the Windows
 * and macOS bars and 0 otherwise, `--top-bar-height` is 0 on the login and action-required shells.
 * Read from an element inside the layout; a variable that is not set counts as 0.
 */
export const SHELL_PINNED_TOP_VARS = [
    '--window-bar-height',
    '--top-bar-height',
    '--page-header-height',
] as const;

export const shellPinnedTop = (style: Pick<CSSStyleDeclaration, 'getPropertyValue'>): number =>
    SHELL_PINNED_TOP_VARS.reduce(
        (sum, name) => sum + (Number.parseFloat(style.getPropertyValue(name)) || 0),
        0,
    );
