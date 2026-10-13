import assert from 'node:assert/strict';
import test from 'node:test';

import type { DoEcho } from './do-echo.ts';

import { echoDisconnected, echoSettled, echoWelcome, failedLoadExit, NO_ECHO } from './do-echo.ts';

/**
 * I-031:  node --test src/renderer/features/hub/utils/do-echo.harness.ts
 *
 * use-hub's receiver side of the command echo, replayed as the frames and directive endings it
 * sees. A directive is `arrive`d (use-hub notes the connection, runDirective) and later `end`s
 * (the `finally` after handleDo); `applied` is what the next report would carry, and `echoed`
 * lists the numbers a report was sent for at once.
 */

interface Receiver {
    echo: DoEcho;
    echoed: number[];
}

const receiver = (): Receiver => ({ echo: echoWelcome(NO_ECHO), echoed: [] });

/** A directive arriving: the connection it belongs to. */
const arrive = (r: Receiver): number => r.echo.conn;

/** A directive ending, as runDirective's `finally` does it. */
const end = (r: Receiver, seq: unknown, conn: number, exit: 'echo' | 'silent' = 'echo') => {
    const moved = echoSettled(r.echo, seq, conn);
    if (!moved) return;
    r.echo = moved;
    if (exit === 'echo') r.echoed.push(moved.applied);
};

test('applied is 0 before any directive and follows each numbered one as it ends', () => {
    const r = receiver();
    assert.equal(r.echo.applied, 0);
    const pause = arrive(r);
    assert.equal(r.echo.applied, 0, 'arrival is not enough: the pause has not run yet');
    end(r, 57, pause);
    assert.equal(r.echo.applied, 57);
    end(r, 58, arrive(r));
    assert.equal(r.echo.applied, 58);
    assert.deepEqual(r.echoed, [57, 58], 'a report follows each move');
});

test('a directive without a number moves nothing and sends no report', () => {
    const r = receiver();
    end(r, 12, arrive(r));
    end(r, undefined, arrive(r)); // setVolume, setRepeat, setShuffle, release
    end(r, null, arrive(r));
    end(r, '13', arrive(r));
    end(r, 13.5, arrive(r));
    assert.equal(r.echo.applied, 12);
    assert.deepEqual(r.echoed, [12]);
});

test('applied only moves forward', () => {
    const r = receiver();
    const conn = arrive(r);
    end(r, 9, conn);
    end(r, 7, conn);
    end(r, 9, conn);
    assert.equal(r.echo.applied, 9);
    assert.deepEqual(r.echoed, [9], 'and nothing is reported for a number already passed');
});

test('a directive from the previous connection does not move it', () => {
    // A load is still waiting for its outcome when the socket drops and comes back. The hub
    // forgot that load at the new `welcome`; confirming it would vouch for a state the hub
    // never asked this connection for.
    const r = receiver();
    end(r, 40, arrive(r));
    const load = arrive(r); // seq 41, slow
    r.echo = echoDisconnected(r.echo);
    end(r, 41, load);
    assert.equal(r.echo.applied, 40, 'not while the socket is down');
    r.echo = echoWelcome(r.echo);
    assert.equal(r.echo.applied, 0, 'welcome is the reset');
    end(r, 41, load);
    assert.equal(r.echo.applied, 0, 'nor once it is back');
    assert.deepEqual(r.echoed, [40]);
});

test('after a welcome the numbers start over, lower ones included', () => {
    // A restarted hub counts from 1 again.
    const r = receiver();
    end(r, 300, arrive(r));
    r.echo = echoDisconnected(r.echo);
    r.echo = echoWelcome(r.echo);
    end(r, 2, arrive(r));
    assert.equal(r.echo.applied, 2);
});

test('a directive that arrives before the welcome of its connection is not counted', () => {
    // The hub writes nothing before `welcome`; if one slipped through, both sides reset after it.
    const r = receiver();
    r.echo = echoDisconnected(r.echo);
    const early = arrive(r);
    r.echo = echoWelcome(r.echo);
    end(r, 5, early);
    assert.equal(r.echo.applied, 0);
});

test('a silent ending still moves applied, without the report', () => {
    const r = receiver();
    end(r, 20, arrive(r), failedLoadExit('t7'));
    assert.equal(r.echo.applied, 20, 'the next report carries it');
    assert.deepEqual(r.echoed, []);
});

test("only a transfer's failed load is silent", () => {
    assert.equal(failedLoadExit('t7'), 'silent');
    assert.equal(failedLoadExit(0), 'silent', 'any id the hub sent counts');
    assert.equal(failedLoadExit(undefined), 'echo', 'a load after setQueue has no transferId');
    assert.equal(failedLoadExit(null), 'echo');
});
