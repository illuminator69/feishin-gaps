import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * R14 (B-249):  node --test src/renderer/components/item-list/item-table-list/header-underline.harness.ts
 *
 * The sorted column's bar is drawn on the header label's bottom edge. Pinned: that box is as wide
 * as its label (not the column) and always holds a text line whose baseline an icon stands on, so
 * on an icon header the bar sits under the icon instead of across it, at the offset of a word.
 */

const css = readFileSync(new URL('./item-table-list-column.module.css', import.meta.url), 'utf8');

const block = (start: string) => {
    const at = css.indexOf(start);
    assert.ok(at >= 0, start);
    return css.slice(at, css.indexOf('\n}', at));
};

test('theBarIsDrawnOnTheLabelBox', () => {
    assert.match(block('.header-sorted .header-content {'), /box-shadow: inset 0 -2px 0/);
});

test('theLabelBoxIsTheLabelsWidthOnATextLine', () => {
    const box = block('\n.header-content {');
    for (const rule of ['width: fit-content;', 'max-width: 100%;', 'align-items: baseline;']) {
        assert.ok(box.includes(rule), rule);
    }
    // The line an icon stands on: a zero-width space, so a label with no text still has one.
    assert.match(block('.header-content::before {'), /content: '\\200b';/);
});

test('theNarrowBoxKeepsTheColumnsAlignment', () => {
    assert.match(block('.header-content.center {'), /margin-inline: auto;/);
    assert.match(block('.header-content.left {'), /margin-inline-end: auto;/);
    assert.match(block('.header-content.right {'), /margin-inline-start: auto;/);
});
