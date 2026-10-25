import assert from 'node:assert/strict';
import test from 'node:test';

import { SCAN_WAIT_MS, scanLine, scanPhase, scanPollMs } from './scan-phase.ts';

/**
 * F7 Task 4 / Call 13: the states a scan really has, including the hub's cached pre-scan read.
 *
 *     node --test src/renderer/features/discography/scan-phase.harness.ts
 */

const NOW = 1_800_000_000_000;
const base = {
    available: true,
    indexed: true,
    loading: false,
    nowMs: NOW,
    pending: false,
    readAtMs: null,
    releaseCount: 9,
    scan: null,
    scannable: true,
    started: null,
};
type Scan = { error: string; state: 'done' | 'failed' | 'running'; taskId: string };
const rec = (state: Scan['state'], taskId = 't1', error = ''): Scan => ({ error, state, taskId });

test('pending or a running record is running, over everything', () => {
    assert.equal(scanPhase({ ...base, pending: true }), 'running');
    assert.equal(scanPhase({ ...base, scan: rec('running') }), 'running');
    assert.equal(
        scanPhase({ ...base, available: false, indexed: false, pending: true }),
        'running',
    );
    assert.equal(scanPhase({ ...base, pending: true, scan: rec('failed', 'x') }), 'running');
});

test('the cached-read cases: a scan this session started is running until a record with its task id ends', () => {
    const started = { atMs: NOW - 10_000, taskId: 't1' };
    assert.equal(scanPhase({ ...base, started }), 'running');
    assert.equal(scanPhase({ ...base, scan: rec('done', 'older'), started }), 'running');
    assert.equal(
        scanPhase({ ...base, scan: rec('failed', 'older', 'old error'), started }),
        'running',
    );
    assert.equal(scanPhase({ ...base, scan: rec('done', 't1'), started }), 'idle');
    assert.equal(scanPhase({ ...base, scan: rec('failed', 't1', 'MB down'), started }), 'failed');
});

test('a read made after the hub cache can hold a pre-scan answer, with no record of the task, means lb-bot lost it', () => {
    const started = { atMs: NOW - 90_000, taskId: 't1' };
    // Read 70 s after the press: not the pre-scan cache, and no record of t1 (lb-bot restarted).
    assert.equal(scanPhase({ ...base, readAtMs: started.atMs + 70_000, started }), 'idle');
    assert.equal(
        scanPhase({
            ...base,
            readAtMs: started.atMs + 70_000,
            scan: rec('done', 'older'),
            started,
        }),
        'idle',
    );
    assert.equal(
        scanPhase({
            ...base,
            indexed: false,
            readAtMs: started.atMs + 70_000,
            releaseCount: 0,
            started,
        }),
        'never',
    );
    // Read 30 s after the press: may be the cached pre-scan answer, so still running.
    assert.equal(scanPhase({ ...base, readAtMs: started.atMs + 30_000, started }), 'running');
    // A record of t1 still running keeps it running whenever it was read.
    assert.equal(
        scanPhase({ ...base, readAtMs: started.atMs + 70_000, scan: rec('running'), started }),
        'running',
    );
});

test('a started scan stops waiting after five minutes', () => {
    const started = { atMs: NOW - SCAN_WAIT_MS - 60_000, taskId: 't1' };
    assert.equal(scanPhase({ ...base, started }), 'idle');
    assert.equal(scanPhase({ ...base, indexed: false, releaseCount: 0, started }), 'never');
});

test('a failed record is failed even when the artist is indexed', () => {
    assert.equal(scanPhase({ ...base, scan: rec('failed', 't9', 'boom') }), 'failed');
});

test('the resting phases', () => {
    assert.equal(
        scanPhase({ ...base, available: false, indexed: false, releaseCount: 0 }),
        'unavailable',
    );
    assert.equal(scanPhase({ ...base, indexed: false, releaseCount: 0 }), 'never');
    assert.equal(scanPhase({ ...base, releaseCount: 0 }), 'empty');
    assert.equal(scanPhase(base), 'idle');
    assert.equal(scanPhase({ ...base, scan: rec('done', 'x') }), 'idle');
    // lb-bot down but the mirror holds the artist: the tiles are real, so it reads as idle.
    assert.equal(scanPhase({ ...base, available: false }), 'idle');
    assert.equal(
        scanPhase({ ...base, indexed: false, releaseCount: 0, scannable: false }),
        'never',
    );
});

test('while the discography read is still out, nothing is said and nothing is offered', () => {
    const waiting = { ...base, indexed: false, loading: true, releaseCount: 0 };
    assert.equal(scanPhase(waiting), 'unavailable');
    // A scan this session started still reads as running.
    assert.equal(scanPhase({ ...waiting, started: { atMs: NOW - 1000, taskId: 't1' } }), 'running');
    // Once the artist is known to be indexed, loading does not hide it.
    assert.equal(scanPhase({ ...base, loading: true }), 'idle');
});

test('the poll runs only while running', () => {
    assert.equal(scanPollMs('running'), 5000);
    for (const phase of ['never', 'failed', 'idle', 'empty', 'unavailable'] as const) {
        assert.equal(scanPollMs(phase), null);
    }
});

const at = (days: number) => NOW - days * 86_400_000;
const line = (phase: Parameters<typeof scanLine>[0], over = {}) =>
    scanLine(phase, {
        error: '',
        nowMs: NOW,
        scannable: true,
        scannedAtMs: null,
        stale: false,
        ...over,
    });

test('the idle line reads scannedAt', () => {
    assert.equal(line('idle', { scannedAtMs: at(0.2) }), 'Scanned today');
    assert.equal(line('idle', { scannedAtMs: at(1.5) }), 'Scanned yesterday');
    assert.equal(line('idle', { scannedAtMs: at(3.2) }), 'Scanned 3 days ago');
    assert.equal(line('idle', { scannedAtMs: at(35) }), 'Scanned a month ago');
    assert.equal(line('idle', { scannedAtMs: at(95) }), 'Scanned 3 months ago');
    assert.equal(
        line('idle', { scannedAtMs: at(40), stale: true }),
        'Scanned a month ago · out of date',
    );
    assert.equal(line('idle', { scannedAtMs: null }), '');
});

test("a failed line is lb-bot's sentence verbatim", () => {
    const sentence = 'MusicBrainz is unavailable right now (503). Nothing was changed.';
    assert.equal(line('failed', { error: sentence }), sentence);
    assert.equal(line('failed'), 'The discography scan failed.');
});

test('the running line never says a percentage or a count', () => {
    const text = line('running');
    assert.ok(text.length > 0);
    assert.doesNotMatch(text, /\d/);
    assert.doesNotMatch(text, /%/);
});

test('never says why it cannot scan when it cannot', () => {
    assert.match(line('never'), /Find missing albums/);
    assert.match(line('never', { scannable: false }), /MusicBrainz id/);
    assert.match(line('empty'), /found no releases/);
    assert.equal(line('unavailable'), '');
});
