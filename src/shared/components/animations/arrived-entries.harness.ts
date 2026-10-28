import assert from 'node:assert/strict';
import test from 'node:test';

import { createArrivedEntries } from './arrived-entries.ts';

/**
 * R4:  node --test src/shared/components/animations/arrived-entries.harness.ts
 *
 * The record of which (history entry, list) pairs have shown their arrivals: a page that remounts on
 * Back asks it before opening an arrival window, so a history entry arrives once.
 */

test('markedPairIsRemembered', () => {
    const record = createArrivedEntries(10);
    assert.equal(record.has('a', 'list'), false);
    record.mark('a', 'list');
    assert.equal(record.has('a', 'list'), true);
});

test('otherListOnSameEntryIsNot', () => {
    const record = createArrivedEntries(10);
    record.mark('a', 'term-one');
    assert.equal(record.has('a', 'term-two'), false);
    assert.equal(record.has('a', ''), false);
});

test('sameListOnOtherEntryIsNot', () => {
    const record = createArrivedEntries(10);
    record.mark('a', 'list');
    assert.equal(record.has('b', 'list'), false);
});

test('boundedByEntries', () => {
    const record = createArrivedEntries(3);
    ['a', 'b', 'c', 'd'].forEach((entry) => record.mark(entry, 'list'));
    assert.equal(record.size(), 3);
    assert.equal(record.has('a', 'list'), false);
    assert.equal(record.has('b', 'list'), true);
    assert.equal(record.has('d', 'list'), true);
});

test('thousandEntriesStayBounded', () => {
    const record = createArrivedEntries(200);
    for (let i = 0; i < 1000; i += 1) record.mark(`entry-${i}`, 'list');
    assert.equal(record.size(), 200);
    assert.equal(record.has('entry-999', 'list'), true);
    assert.equal(record.has('entry-799', 'list'), false);
    assert.equal(record.has('entry-800', 'list'), true);
});

test('severalListsOnOneEntryCountOnce', () => {
    const record = createArrivedEntries(2);
    record.mark('a', 'one');
    record.mark('a', 'two');
    record.mark('a', 'three');
    assert.equal(record.size(), 1);
    assert.equal(record.has('a', 'one'), true);
});

test('markingAgainKeepsTheEntryNewest', () => {
    const record = createArrivedEntries(2);
    record.mark('a', 'list');
    record.mark('b', 'list');
    record.mark('a', 'other');
    record.mark('c', 'list');
    assert.equal(record.has('b', 'list'), false);
    assert.equal(record.has('a', 'list'), true);
    assert.equal(record.has('c', 'list'), true);
});

test('aFreshPairArrives', () => {
    const record = createArrivedEntries(10);
    assert.equal(record.arrives('a', 'list'), true);
});

test('backToAnArrivedEntryShowsItAtRest', () => {
    const record = createArrivedEntries(10);
    const release = record.hold('a', 'list');
    record.mark('a', 'list');
    release();
    assert.equal(record.arrives('a', 'list'), false);
});

test('aSiblingOpeningInTheSameVisitStillArrives', () => {
    // Home's shelves share one entry and one (empty) list key: the first to open marks the pair, a
    // shelf that fills later is still part of the visit while any holder is mounted.
    const record = createArrivedEntries(10);
    const releaseFirst = record.hold('a', '');
    record.mark('a', '');
    assert.equal(record.arrives('a', ''), true);
    const releaseSecond = record.hold('a', '');
    releaseFirst();
    assert.equal(record.arrives('a', ''), true);
    releaseSecond();
    assert.equal(record.arrives('a', ''), false);
});

test('releasingTwiceDoesNotGoNegative', () => {
    const record = createArrivedEntries(10);
    const release = record.hold('a', 'list');
    record.mark('a', 'list');
    release();
    release();
    const other = record.hold('a', 'list');
    release();
    assert.equal(record.arrives('a', 'list'), true);
    other();
    assert.equal(record.arrives('a', 'list'), false);
});
