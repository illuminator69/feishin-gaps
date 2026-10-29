// Pure: the widths `autoFitColumns` gives a table's columns. No `/@/` import, no React.

export interface FitColumn {
    id: string;
    pinned: 'left' | 'right' | null;
    width: number;
}

/**
 * B-264, R15 review I2: the floor of a column other than Title and Rating: a duration ("3:45" is
 * about 24 px at the table's size) inside the `sm` cell padding (2 x 8 px). Small and absolute, so
 * a table scrolls sideways only when Title, Rating and these do not fit; a share of each column's
 * own width (0.4 x 300 px for Album or Genre) made the playlist, Now Playing and full-screen tables
 * scroll by slivers.
 */
export const GENERIC_MIN_WIDTH = 40;

/**
 * A column narrower than that by default (the row index, the heart, the cover, 60 to 70 px) keeps
 * this share of its own width as its floor instead: the side queue at its narrowest (a 250 px
 * panel) runs at about 0.44, so it stays as it was.
 */
export const MIN_SCALE = 0.4;

/**
 * The rating cell's five stars at the table's `xs` size: 5 x 11 px (`--theme-font-size-xs`), the
 * Rating's own 2 x 4 px padding and the cell's 2 x 8 px (`sm`, the tables' default). Narrower, the
 * stars spilled over the heart beside them.
 */
export const RATING_MIN_WIDTH = 80;

/**
 * The title: its 56 px cover (a default row) and about 15 characters. In a table narrower than
 * twice this (the side queue) the title keeps at most half the table instead, its share there.
 */
export const TITLE_MIN_WIDTH = 200;

/**
 * R15 review I1: a column the user dragged wider than the widest default (300 px of proportion)
 * raises its own floor with it, at the scale the widest default column has on the generic floor
 * (40 / 300). Without it every column sits on an absolute floor once the table overflows, and a
 * drag there would spring back. Default widths never reach this term.
 */
const RESIZED_SCALE = GENERIC_MIN_WIDTH / 300;

const TITLE_IDS: ReadonlySet<string> = new Set(['name', 'titleArtist', 'titleCombined']);
const RATING_ID = 'userRating';

/** The narrowest an unpinned column may be scaled to in a table `containerWidth` wide. */
export function columnMinWidth(column: FitColumn, containerWidth: number): number {
    let floor: number;
    if (TITLE_IDS.has(column.id)) floor = Math.min(TITLE_MIN_WIDTH, containerWidth / 2);
    else if (column.id === RATING_ID) floor = RATING_MIN_WIDTH;
    else floor = Math.min(GENERIC_MIN_WIDTH, column.width * MIN_SCALE);
    return Math.max(floor, column.width * RESIZED_SCALE);
}

/**
 * Unpinned widths are proportions scaled to the container; pinned columns keep their own width.
 * A column the scale would take below its minimum stays at the minimum and the rest share what
 * is left. When the minimums alone do not fit, every unpinned column is at its minimum and the
 * table is wider than its container: the grid scrolls sideways, as it does without autoFit.
 * A container not measured yet (0) or nothing unpinned leaves every column at its own width.
 */
export function fitColumnWidths(columns: readonly FitColumn[], containerWidth: number): number[] {
    const baseWidths = columns.map((c) => c.width);
    const pinnedWidth = columns.reduce((sum, c) => (c.pinned !== null ? sum + c.width : sum), 0);
    const unpinnedIndices: number[] = [];
    columns.forEach((c, idx) => {
        if (c.pinned === null) unpinnedIndices.push(idx);
    });

    const unpinnedReferenceWidth = unpinnedIndices.reduce((sum, idx) => sum + baseWidths[idx], 0);
    const availableForUnpinned = containerWidth - pinnedWidth;

    if (unpinnedReferenceWidth === 0 || availableForUnpinned <= 0) {
        return baseWidths.map((width) => Math.round(width));
    }

    const minWidths = columns.map((c) => columnMinWidth(c, containerWidth));
    const floored = new Set<number>();
    let scaleFactor = 0;
    for (;;) {
        const floorTotal = [...floored].reduce((sum, idx) => sum + minWidths[idx], 0);
        const free = unpinnedIndices.filter((idx) => !floored.has(idx));
        const freeReference = free.reduce((sum, idx) => sum + baseWidths[idx], 0);
        scaleFactor = freeReference > 0 ? (availableForUnpinned - floorTotal) / freeReference : 0;
        const below = free.filter((idx) => baseWidths[idx] * scaleFactor < minWidths[idx]);
        if (below.length === 0) break;
        below.forEach((idx) => floored.add(idx));
    }

    const scaledWidths = baseWidths.map((width, idx) => {
        if (columns[idx].pinned !== null) return Math.round(width);
        if (floored.has(idx)) return Math.round(minWidths[idx]);
        return Math.round(width * scaleFactor);
    });

    // Rounding errors go to the scaled columns only; an overflowing table has none of them.
    const scaledIndices = unpinnedIndices.filter((idx) => !floored.has(idx));
    const totalScaled = scaledWidths.reduce((sum, width) => sum + width, 0);
    const difference = containerWidth - totalScaled;

    if (difference !== 0 && scaledIndices.length > 0) {
        const sortedIndices = scaledIndices
            .map((idx) => ({ idx, width: scaledWidths[idx] }))
            .sort((a, b) => b.width - a.width);
        const adjustmentPerColumn = Math.sign(difference);
        const adjustmentCount = Math.abs(difference);
        for (let i = 0; i < adjustmentCount && i < sortedIndices.length; i++) {
            scaledWidths[sortedIndices[i].idx] += adjustmentPerColumn;
        }
    }

    return scaledWidths;
}

/**
 * R15 review I1: the own width to save when the user drags column `index` to `draggedWidth` px.
 * Under autoFit a column's own width is a proportion, not px, so saving the dragged px made a drag
 * wider show narrower in an overflowing table and a click on the handle shrink the column. This
 * finds the own width that fits back to the dragged px (the column's fitted width only grows with
 * its own width, so a search over it is exact up to rounding). A pinned column keeps px.
 */
export function ownWidthForResize(
    columns: readonly FitColumn[],
    containerWidth: number,
    index: number,
    draggedWidth: number,
): number {
    const target = Math.round(draggedWidth);
    const column = columns[index];
    if (!column || column.pinned !== null || containerWidth <= 0) return target;

    const shownAt = (own: number) =>
        fitColumnWidths(
            columns.map((c, i) => (i === index ? { ...c, width: own } : c)),
            containerWidth,
        )[index];

    // At this own width the column's floor alone is the target, so it shows at least that.
    let high = Math.max(1, Math.ceil(target / RESIZED_SCALE));
    let low = 1;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (shownAt(mid) >= target) high = mid;
        else low = mid + 1;
    }
    return low;
}
