/**
 * R13 (B-243): the About text on the album, artist and lb-bot pages folds to a few whole lines with
 * an arrow at the cut (`ClampFold`). Pure, for the harness; the component measures and moves.
 */

/** Lines an About shows while folded, on every page that has one. */
export const ABOUT_LINES = 5;

/** Under this many pixels a measure counts as on the line (subpixel layout). */
const ON_THE_LINE_PX = 1;

/**
 * A computed `line-height` in pixels. `normal` (or anything unparsed) falls back to the app's body
 * ratio, 1.55 of the font size.
 */
export const lineHeightPx = (lineHeight: string, fontSize: string): number => {
    const px = Number.parseFloat(lineHeight);
    if (lineHeight.trim().endsWith('px') && px > 0) return px;
    const size = Number.parseFloat(fontSize);
    return size > 0 ? size * 1.55 : 0;
};

/** The folded height: `lines` whole lines; zero when the line height is unknown. */
export const clampHeight = ({
    lineHeight,
    lines,
}: {
    lineHeight: number;
    lines: number;
}): number => (lineHeight > 0 ? lines * lineHeight : 0);

/** Whether the text runs past the folded height, so it folds and shows the arrow. */
export const clampFolds = (fullPx: number, collapsedPx: number): boolean =>
    collapsedPx > 0 && fullPx > collapsedPx + ON_THE_LINE_PX;
