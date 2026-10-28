import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { shellPinnedTop } from './utils/shell-pinned-top.ts';

/**
 * R3 Task 3 (L5-01):  node --test src/renderer/components/item-list/item-table-list/sticky-offset.harness.ts
 *
 * The pinned table header and the pinned disc row sat at 65 / 95 px, with in-view margins of
 * -100 / -130 px: the geometry from before F3, when the page's title row was the first thing under
 * the window bar. The shell now has a top bar as well, so they must be read from the shell's own
 * variables (`--window-bar-height`, `--top-bar-height`, `--page-header-height`), never written out.
 */

const here = new URL('./', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, here), 'utf8');

const FILES = [
    'hooks/use-sticky-table-header.tsx',
    'hooks/use-sticky-table-group-rows.tsx',
    'item-table-list.module.css',
];

test('the pinned header and disc row take their top from the shell, not from literals', () => {
    for (const file of FILES) {
        const source = read(file);
        for (const literal of ['65px', '95px', '-100px', '-130px']) {
            assert.ok(!source.includes(literal), `${file} carries ${literal}`);
        }
        if (file.endsWith('.tsx')) {
            // The numeric form the hooks used (`? 95 : 65`).
            assert.ok(!/\b(?:65|95|100|130)\b/.test(source), `${file} carries a pre-F3 offset`);
            assert.ok(source.includes('useShellPinnedTop'), `${file} does not read the shell`);
        }
    }
    const helper = read('utils/shell-pinned-top.ts');
    for (const name of ['--window-bar-height', '--top-bar-height', '--page-header-height']) {
        assert.ok(helper.includes(name), `the helper does not read ${name}`);
    }
});

test('the pinned top is the window bar, the top bar and the title row', () => {
    const style = (vars: Record<string, string>) => ({
        getPropertyValue: (name: string) => vars[name] ?? '',
    });
    const linux = {
        '--page-header-height': '65px',
        '--top-bar-height': '52px',
        '--window-bar-height': '0px',
    };
    assert.equal(shellPinnedTop(style(linux)), 117);
    assert.equal(shellPinnedTop(style({ ...linux, '--window-bar-height': ' 30px' })), 147);
    assert.equal(shellPinnedTop(style({ ...linux, '--top-bar-height': '0px' })), 65);
    assert.equal(shellPinnedTop(style({})), 0);
});
