import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

/**
 * B-267:  node --test src/renderer/components/item-list/item-table-list/text-cells-one-line.harness.ts
 *
 * At a column's 40 px floor the Album and Genre cells showed "Wys" / "Live", "Indi" / "Roc": the
 * text wrapped onto a second line (a two-line clamp) and a word wider than the cell was clipped
 * through, with no ellipsis, while the headers ellipsised. Every text cell is now one line ending
 * in an ellipsis, by the rule the title column's artist line already uses (`.artists` in
 * title-combined-column.module.css), and lets the pointer read the full text when it is cut.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const block = (css: string, start: string) => {
    const at = css.indexOf(start);
    assert.ok(at >= 0, start);
    return css.slice(at, css.indexOf('\n}', at));
};

const ONE_LINE = [
    'min-width: 0;',
    'max-width: 100%;',
    'overflow: hidden;',
    'text-overflow: ellipsis;',
    'white-space: nowrap;',
    '--text-text-wrap: nowrap;',
];

// Every text cell's own class: the shared text container and each column's container.
const CELLS: Array<[string, string]> = [
    ['./item-table-list-column.module.css', '\n.content {'],
    ['./columns/album-column.module.css', '.album-container {'],
    ['./columns/album-artists-column.module.css', '.artists-container {'],
    ['./columns/artists-column.module.css', '.artists-container {'],
    ['./columns/composer-column.module.css', '.composers-container {'],
    ['./columns/genre-column.module.css', '.genres-container {'],
    ['./columns/title-combined-column.module.css', '\n.artists {'],
];

test('everyTextCellIsOneLineEndingInAnEllipsis', () => {
    for (const [path, start] of CELLS) {
        const rule = block(read(path), start);
        for (const declaration of ONE_LINE) {
            assert.ok(rule.includes(declaration), `${path} ${start.trim()} ${declaration}`);
        }
    }
});

test('noTextCellWrapsOntoASecondLine', () => {
    for (const [path] of CELLS.slice(1, -1)) {
        assert.ok(!/line-clamp/.test(read(path)), `${path} still clamps to lines`);
    }
    for (const start of ['\n.content {', '.content.compact {', '.content.large {']) {
        const css = read('./item-table-list-column.module.css');
        if (css.includes(start)) assert.ok(!/line-clamp: [23]/.test(block(css, start)), start);
    }
});

test('genreBadgesStayOnOneRow', () => {
    const source = read('./columns/genre-badge-column.tsx');
    assert.match(source, /wrap="nowrap"/);
    assert.doesNotMatch(source, /wrap="wrap"/);
});

test('everyTextCellShowsItsFullTextWhenCut', () => {
    for (const path of [
        './item-table-list-column.tsx',
        './columns/album-column.tsx',
        './columns/album-artists-column.tsx',
        './columns/artists-column.tsx',
        './columns/composer-column.tsx',
        './columns/genre-column.tsx',
        './columns/genre-badge-column.tsx',
        './columns/title-column.tsx',
        './columns/title-combined-column.tsx',
        './columns/title-artist-column.tsx',
    ]) {
        assert.match(read(path), /showFullTextWhenCut/, path);
    }
});
