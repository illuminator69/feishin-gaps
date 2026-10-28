/**
 * The transport's width outer edge to outer edge (R6, B-211): the seek row under it takes this
 * width. Boxes with no width (a button not laid out) do not count; null when there is none.
 */
export const transportSpan = (boxes: readonly { left: number; right: number }[]): null | number => {
    const shown = boxes.filter((box) => box.right - box.left > 0);
    if (shown.length === 0) return null;
    const left = Math.min(...shown.map((box) => box.left));
    const right = Math.max(...shown.map((box) => box.right));
    return Math.round(right - left);
};
