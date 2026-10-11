import assert from 'node:assert/strict';
import test from 'node:test';

import { albumDownloadBody } from '../../../../shared/utils/lbbot-album-wire.ts';
import {
    allFilesConfirmation,
    extraFilesView,
    leftOutText,
    nextFillExtras,
} from './album-download.ts';

/**
 * B-084: "N more files in this folder" and "Download all M files" on the album source
 * picker; the request that carries `allFiles`; what the confirmation says from the
 * echo; and the status line's "left out". Every sentence is a field of an answer:
 * nothing is computed from `files` or `fileCount` except M, the button's label.
 *
 *     node --test src/renderer/features/lbbot/utils/album-download.harness.ts
 */

test('row state: extraFiles absent or 0 shows nothing new and offers one action', () => {
    assert.equal(extraFilesView({ fileCount: 11 }), null);
    assert.equal(extraFilesView({ extraFiles: undefined, fileCount: 11 }), null);
    assert.equal(extraFilesView({ extraFiles: 0, fileCount: 11 }), null);
});

test("row state: 1 is singular, 6 is plural; the button names the folder's file count", () => {
    assert.deepEqual(extraFilesView({ extraFiles: 1, fileCount: 6 }), {
        action: 'Download all 6 files',
        line: '1 more file in this folder',
    });
    assert.deepEqual(extraFilesView({ extraFiles: 6, fileCount: 11 }), {
        action: 'Download all 11 files',
        line: '6 more files in this folder',
    });
});

test('row state: a nonsense value is nothing, never a line', () => {
    assert.equal(extraFilesView({ extraFiles: -2, fileCount: 5 }), null);
    assert.equal(extraFilesView({ extraFiles: Number.NaN, fileCount: 5 }), null);
});

const BASE = { rgid: 'rg1', sourceFolder: 'f', sourceUsername: 'peer' };

test('request body: allFiles is sent only when true, and only with a picked source', () => {
    assert.equal('allFiles' in albumDownloadBody({ ...BASE }), false);
    assert.equal('allFiles' in albumDownloadBody({ ...BASE, allFiles: false }), false);
    assert.equal(albumDownloadBody({ ...BASE, allFiles: true }).allFiles, true);
    // no pick: lb-bot would answer 400, so the client never asks
    assert.equal('allFiles' in albumDownloadBody({ allFiles: true, rgid: 'rg1' }), false);
});

test('request body: everything else is as it was', () => {
    const body = albumDownloadBody({
        ...BASE,
        allFiles: true,
        allowMp3: true,
        quality: 'flac-any',
    });
    assert.equal(body.sourceUsername, 'peer');
    assert.equal(body.sourceFolder, 'f');
    assert.equal(body.allowMp3, true);
    assert.equal(body.quality, 'flac-any');
    assert.equal(body.rgid, 'rg1');
    assert.equal('allFiles' in albumDownloadBody({ ...BASE }), false);
});

test('confirmation: echo true says all files, with the peer and M', () => {
    assert.deepEqual(
        allFilesConfirmation({
            asked: true,
            echo: true,
            existing: false,
            fileCount: 11,
            peer: 'bob',
        }),
        { kind: 'all', text: 'Asked @bob for all 11 files in the folder' },
    );
});

test('confirmation: echo false or absent says tracks only and does not claim all files', () => {
    for (const echo of [false, undefined]) {
        const c = allFilesConfirmation({
            asked: true,
            echo,
            existing: false,
            fileCount: 11,
            peer: 'bob',
        });
        assert.equal(c.kind, 'tracksOnly');
        assert.match(c.text, /lb-bot is downloading the album's tracks only/);
        assert.match(c.text, /did not take “all files”/);
        assert.match(c.text, /hub may be older/);
        assert.doesNotMatch(c.text, /for all 11/);
    }
});

test('confirmation: existing keeps the usual wording whatever was asked', () => {
    for (const echo of [true, false, undefined]) {
        assert.deepEqual(
            allFilesConfirmation({ asked: true, echo, existing: true, fileCount: 11, peer: 'bob' }),
            { kind: 'existing', text: '' },
        );
    }
});

test('confirmation: a plain download (all files not asked) has nothing new to say', () => {
    assert.deepEqual(
        allFilesConfirmation({
            asked: false,
            echo: undefined,
            existing: false,
            fileCount: 11,
            peer: 'bob',
        }),
        { kind: 'plain', text: '' },
    );
    assert.equal(
        allFilesConfirmation({
            asked: false,
            echo: true,
            existing: false,
            fileCount: 11,
            peer: 'bob',
        }).kind,
        'plain',
    );
});

test('status line: leftOut 0 or absent adds nothing; > 0 says how many were left out', () => {
    assert.equal(leftOutText(0), '');
    assert.equal(leftOutText(undefined), '');
    assert.equal(leftOutText(-1), '');
    assert.equal(leftOutText(1), '1 other file in the folder was left out');
    assert.equal(leftOutText(6), '6 other files in the folder were left out');
});

// --- fix round 1 (I1): a frame that lacks leftOut / allFiles keeps what the row had ------------

/** Applies what `nextFillExtras` says to write onto a stored row, as `describe` does. */
const apply = (
    stored: { allFiles?: boolean; leftOut?: number; source?: string },
    status: { allFiles?: boolean; leftOut?: number; source: string },
    sameFill = true,
) => ({ ...stored, ...nextFillExtras(stored, status, { sameFill }) });

test('I1: a frame without the keys, after a poll that said leftOut 6, leaves 6', () => {
    const polled = { allFiles: false, leftOut: 6, source: 'bob' };
    const next = apply(polled, { source: 'bob' });
    assert.equal(next.leftOut, 6);
    assert.equal(leftOutText(next.leftOut), '6 other files in the folder were left out');
});

test('I1: a frame that carries the key sets it - 0 and false included', () => {
    const polled = { allFiles: true, leftOut: 6, source: 'bob' };
    assert.equal(apply(polled, { allFiles: false, leftOut: 0, source: 'bob' }).leftOut, 0);
    assert.equal(apply(polled, { allFiles: false, leftOut: 0, source: 'bob' }).allFiles, false);
    assert.equal(apply(polled, { leftOut: 3, source: 'bob' }).leftOut, 3);
    // each key is judged on its own
    const half = apply(polled, { leftOut: 3, source: 'bob' });
    assert.equal(half.allFiles, true);
});

test("I1: a frame for ANOTHER source without the key is not the old source's 6", () => {
    const polled = { allFiles: true, leftOut: 6, source: 'bob' };
    const next = apply(polled, { source: 'carol' });
    assert.equal(next.leftOut, 0);
    assert.equal(next.allFiles, false);
    // an empty source (not queued yet) says nothing about a switch: the value stays
    assert.equal(apply(polled, { source: '' }).leftOut, 6);
    // a row that never knew its source cannot claim a switch: the value stays
    assert.equal(apply({ leftOut: 6 }, { source: 'carol' }).leftOut, 6);
});

test("I1: a reopened row (a new fill of the same release) drops the old fill's numbers", () => {
    const polled = { allFiles: true, leftOut: 6, source: 'bob' };
    const next = apply(polled, { source: 'bob' }, false);
    assert.equal(next.leftOut, 0);
    assert.equal(next.allFiles, false);
    // ...unless the new fill's own status carries them
    assert.equal(apply(polled, { leftOut: 2, source: 'bob' }, false).leftOut, 2);
});

test('I1: an old lb-bot (no keys anywhere) shows nothing', () => {
    const next = apply({ source: '' }, { source: 'bob' });
    assert.equal(next.leftOut, undefined);
    assert.equal(leftOutText(next.leftOut), '');
    assert.equal(next.allFiles, undefined);
});
