import { pinnedRowBox } from '/@/renderer/components/item-list/item-table-list/utils/shell-pinned-top';

/**
 * Write a pinned row (`position: fixed`) so it sits at viewport `top`, spanning `table`. The block it
 * is fixed to is read off the row itself: its on-screen corner minus its own `left` / `top`, so the
 * row lands right whether that block is the viewport or a transformed ancestor (B-221).
 */
export const placePinnedRow = (row: HTMLElement, table: HTMLElement, top: number) => {
    const style = getComputedStyle(row);
    const rect = row.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const box = pinnedRowBox({
        blockOrigin: {
            x: rect.left - (Number.parseFloat(style.left) || 0),
            y: rect.top - (Number.parseFloat(style.top) || 0),
        },
        table: { left: tableRect.left, width: tableRect.width },
        top,
    });
    row.style.top = `${box.top}px`;
    row.style.left = `${box.left}px`;
    row.style.width = `${box.width}px`;
};
