import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import test from 'node:test';

import type { HubSignInResult, SignInPair } from '../../../../shared/utils/hub-signin.ts';
import type { HubAuthDeps } from './auth.ts';

import { createSilentSignIn, parseSubsonicPair } from '../../../../shared/utils/hub-signin.ts';
import { castHelloFrame } from '../cast/cast-hello.ts';
import { createHubAuth, SECRET_KEY, SIGNED_IN_KEY } from './auth.ts';

/**
 * Worbus P2 lane F, F1:  node --test src/main/features/core/hub/auth.harness.ts
 *
 * Feishin signs in to the Worbus Server with the current Navidrome server's `u`/`s`/`t` instead of
 * a typed hub token. The device secret the hub issues is kept in main only (safeStorage-encrypted
 * in electron-store, or in memory when the OS offers no encryption, R7); every main client and
 * the cast bridge read one accessor; an older hub (404, 405, not this route's JSON) is told apart
 * from an unreachable one (R6); a hub that signs this device out gets one silent sign-in.
 *
 * The fake hub answers exactly as `hub.py` @7732e88 does: 200 `{deviceId, deviceSecret, user}`;
 * 400/401/429/503 with `{code}`; the P1 hub's 405 `{"error":"method not allowed"}` to a POST
 * outside its proxies; `/hub/signout` 200 `{}` or 401 `{"code":"signed_out"}`.
 */

const SECRET = 'planted-device-secret-Zq81_xK3vT0aBcDeFgHiJkLmNoPqRsTuVwXyZ01234';
const PAIR: SignInPair = {
    salt: 'a1b2c3',
    token: '0123456789abcdef0123456789abcdef',
    username: 'alice',
};

type Answer = Error | { body: string; status: number };

interface Call {
    body: any;
    headers: Record<string, string>;
    method: string;
    url: string;
}

const json = (status: number, body: unknown): Answer => ({ body: JSON.stringify(body), status });
const signedIn = (
    deviceId = 'minted-id-0001',
    user = { admin: true, name: 'alice', primary: false },
) => json(200, { deviceId, deviceSecret: SECRET, user });

/** A main-process world: electron-store as a plain object, safeStorage as a reversible fake. */
const world = (opts: { answers?: Answer[]; encryption?: boolean; token?: string } = {}) => {
    const plain: Record<string, unknown> = { 'hub.deviceId': 'old-device-id' };
    const calls: Call[] = [];
    const logs: string[] = [];
    const answers = [...(opts.answers ?? [])];
    let token = opts.token ?? '';
    const deps: HubAuthDeps = {
        device: () => ({
            id: String(plain['hub.deviceId']),
            kind: 'computer',
            name: 'Desk',
            platform: 'desktop',
        }),
        fetch: async (url, init) => {
            calls.push({
                body: init.body ? JSON.parse(init.body) : undefined,
                headers: init.headers,
                method: init.method,
                url,
            });
            const next = answers.shift() ?? json(200, {});
            if (next instanceof Error) throw next;
            return { status: next.status, text: async () => next.body };
        },
        httpBase: () => 'http://hub.lan:4790',
        legacyToken: () => token,
        log: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
        setDeviceId: (id) => {
            plain['hub.deviceId'] = id;
        },
        store: {
            delete: (key) => {
                delete plain[key];
            },
            get: (key) => plain[key],
            set: (key, value) => {
                plain[key] = value;
            },
        },
        vault: {
            available: () => opts.encryption ?? true,
            // Not a real cipher: reversible, and the plain text is nowhere in its output.
            decrypt: (hex) => Buffer.from(hex, 'hex').toString('utf8').split('').reverse().join(''),
            encrypt: (text) =>
                Buffer.from(text.split('').reverse().join(''), 'utf8').toString('hex'),
        },
    };
    return {
        answers,
        auth: createHubAuth(deps),
        calls,
        deps,
        logs,
        plain,
        setToken: (value: string) => {
            token = value;
        },
    };
};

// --- bearer ---------------------------------------------------------------------------------

test('bearer prefers secret then token', async () => {
    const w = world({ answers: [signedIn()], token: 'legacy-hub-token' });
    w.auth.load();
    assert.equal(w.auth.bearer(), 'legacy-hub-token', 'never signed in: the typed token');
    assert.deepEqual(w.auth.helloCredential(), { token: 'legacy-hub-token' });

    const result = await w.auth.signIn(PAIR);
    assert.equal(result.kind, 'signedIn');
    assert.equal(w.auth.bearer(), SECRET, 'signed in: the device secret, not the token');
    assert.deepEqual(w.auth.helloCredential(), { auth: { deviceSecret: SECRET } });
    assert.ok(!('token' in w.auth.helloCredential()), 'a hello with a secret sends no token');

    w.answers.push(json(200, {}));
    await w.auth.signOut();
    assert.equal(w.auth.bearer(), 'legacy-hub-token', 'signed out by the user: the token again');

    const bare = world();
    bare.auth.load();
    assert.equal(bare.auth.bearer(), null, 'nothing at all: no bearer, so no client calls the hub');
});

test('a secret survives a restart, decrypted from the store', async () => {
    const w = world({ answers: [signedIn()] });
    w.auth.load();
    await w.auth.signIn(PAIR);
    const again = createHubAuth(w.deps);
    again.load();
    assert.equal(again.bearer(), SECRET);
    assert.deepEqual(again.state(), { memoryOnly: false, needsSignIn: false, signedIn: true });
});

test('a device the server signed out does not fall back to the shared token', async () => {
    const w = world({ answers: [signedIn()], token: 'legacy-hub-token' });
    w.auth.load();
    await w.auth.signIn(PAIR);
    w.auth.signedOutByServer();
    assert.equal(w.auth.bearer(), null, 'not quietly the primary user through the token');
    assert.equal(w.plain[SECRET_KEY], undefined, 'the dead secret is gone from the store');
    assert.deepEqual(w.auth.state(), { memoryOnly: false, needsSignIn: true, signedIn: false });
});

// --- the sign-in answer, R6 -------------------------------------------------------------------

test('old hub 405 shows token field', async () => {
    const cases: [string, Answer][] = [
        ['P1 hub 405', json(405, { error: 'method not allowed' })],
        ['404', json(404, { error: 'unknown route' })],
        ['404 with no body', { body: '', status: 404 }],
        ['an HTML page', { body: '<html><body>Upgrade Required</body></html>', status: 426 }],
        ['200 that is not JSON', { body: 'OK', status: 200 }],
        ['200 JSON that is not this route', json(200, { ok: true })],
        ['200 without a user', json(200, { deviceId: 'x', deviceSecret: SECRET })],
    ];
    for (const [label, answer] of cases) {
        const w = world({ answers: [answer], token: 'typed' });
        w.auth.load();
        const result = await w.auth.signIn(PAIR);
        assert.equal(result.kind, 'oldServer', label);
        assert.equal(w.auth.bearer(), 'typed', `${label}: the token field's value is what is used`);
        assert.equal(w.plain[SIGNED_IN_KEY], undefined, `${label}: not marked signed in`);
    }
    // Signed in, then the hub was rolled back to P1: the secret is no use there, the token is.
    const rolled = world({ answers: [signedIn(), json(405, { error: 'method not allowed' })] });
    rolled.auth.load();
    await rolled.auth.signIn(PAIR);
    rolled.setToken('typed-after-rollback');
    assert.equal((await rolled.auth.signIn(PAIR)).kind, 'oldServer');
    assert.equal(rolled.auth.bearer(), 'typed-after-rollback');
    assert.equal(rolled.plain[SECRET_KEY], undefined);
});

test('an unreachable hub is never an old one', async () => {
    const refused = Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    });
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
    });
    const dropped = Object.assign(new TypeError('fetch failed'), {
        cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
    });
    for (const [label, error] of [
        ['refused', refused],
        ['timeout', timeout],
        ['dropped', dropped],
    ] as const) {
        const w = world({ answers: [error] });
        w.auth.load();
        assert.equal((await w.auth.signIn(PAIR)).kind, 'unreachable', label);
    }
});

test('each refusal has its own result', async () => {
    const cases: [Answer, HubSignInResult['kind']][] = [
        [json(401, { code: 'navidrome_refused' }), 'navidromeRefused'],
        [json(503, { code: 'navidrome_unreachable' }), 'navidromeUnreachable'],
        [json(429, { code: 'too_many_attempts' }), 'tooManyAttempts'],
        [json(400, { code: 'bad_request' }), 'badRequest'],
    ];
    for (const [answer, kind] of cases) {
        const w = world({ answers: [answer] });
        w.auth.load();
        assert.equal((await w.auth.signIn(PAIR)).kind, kind);
        assert.equal(w.auth.bearer(), null);
    }
    const none = world();
    none.auth.load();
    none.deps.httpBase = () => null;
    assert.equal((await createHubAuth(none.deps).signIn(PAIR)).kind, 'noServer');
    assert.equal(none.calls.length, 0);
});

test('signin sends the pair and the stored device id, and adopts the id it is given (R4)', async () => {
    const w = world({ answers: [signedIn('minted-id-0001')] });
    w.auth.load();
    const result = await w.auth.signIn(PAIR);
    assert.deepEqual(w.calls[0], {
        body: {
            deviceId: 'old-device-id',
            kind: 'computer',
            name: 'Desk',
            platform: 'desktop',
            salt: PAIR.salt,
            token: PAIR.token,
            username: 'alice',
        },
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        url: 'http://hub.lan:4790/hub/signin',
    });
    assert.deepEqual(result, {
        deviceId: 'minted-id-0001',
        kind: 'signedIn',
        user: { admin: true, name: 'alice', primary: false },
    });
    assert.equal(w.plain['hub.deviceId'], 'minted-id-0001', 'the hub id is the device id now');
});

test('signout posts the secret as a bearer and forgets it whatever the answer', async () => {
    for (const answer of [json(200, {}), json(401, { code: 'signed_out' }), new TypeError('x')]) {
        const w = world({ answers: [signedIn()] });
        w.auth.load();
        await w.auth.signIn(PAIR);
        w.answers.push(answer);
        await w.auth.signOut();
        assert.deepEqual(w.calls[1], {
            body: undefined,
            headers: { Authorization: `Bearer ${SECRET}` },
            method: 'POST',
            url: 'http://hub.lan:4790/hub/signout',
        });
        assert.equal(w.auth.bearer(), null);
        assert.equal(w.plain[SECRET_KEY], undefined);
        assert.equal(w.plain[SIGNED_IN_KEY], undefined, 'a sign-out the user asked for is final');
        assert.equal(w.plain['hub.deviceId'], 'minted-id-0001', 'the device keeps its id');
    }
});

// --- signed out by the server ------------------------------------------------------------------

test('signed_out triggers one silent signin', async () => {
    const tried: SignInPair[] = [];
    const outcomes: (HubSignInResult | null)[] = [];
    let answer: HubSignInResult = { kind: 'navidromeRefused' };
    const silent = createSilentSignIn({
        currentPair: () => PAIR,
        onOutcome: (r) => outcomes.push(r),
        signIn: async (pair) => {
            tried.push(pair);
            return answer;
        },
    });

    // The 4005 and the start-up check arrive together: one attempt between them.
    await Promise.all([silent.signedOut(), silent.signedOut()]);
    assert.equal(tried.length, 1);
    assert.deepEqual(tried[0], PAIR, 'the current server pair, as stored');
    assert.deepEqual(outcomes, [{ kind: 'navidromeRefused' }]);

    // Refused: the next signed-out is not answered with another try before a welcome.
    await silent.signedOut();
    assert.equal(tried.length, 1, 'one silent sign-in, not one per reconnect');
    assert.equal(outcomes.at(-1), null, 'given up: the status reads signed out');

    // A welcome (the user signed in by hand, say) earns the next signed-out one try again.
    silent.welcome();
    answer = {
        deviceId: 'd',
        kind: 'signedIn',
        user: { admin: false, name: 'alice', primary: false },
    };
    await silent.signedOut();
    assert.equal(tried.length, 2);
    assert.equal((outcomes.at(-1) as HubSignInResult).kind, 'signedIn');

    // No account to send: nothing is posted, and it says so.
    const none: (HubSignInResult | null)[] = [];
    const noPair = createSilentSignIn({
        currentPair: () => null,
        onOutcome: (r) => none.push(r),
        signIn: async () => {
            throw new Error('must not be called');
        },
    });
    await noPair.signedOut();
    assert.deepEqual(none, [{ kind: 'noAccount' }]);
});

test('the transport stands down on 4005 or signed_out and the renderer runs the silent sign-in', () => {
    const hub = read('./index.ts');
    assert.match(hub, /CLOSE_SIGNED_OUT = 4005/);
    assert.match(
        hub,
        /code === CLOSE_SIGNED_OUT \|\| signedOutSeen/,
        'the close handler reads 4005 and the error frame before it',
    );
    assert.match(hub, /msg\?\.t === 'error' && msg\?\.code === 'signed_out'/);
    assert.match(hub, /hubAuth\.signedOutByServer\(\)/);
    assert.match(hub, /emitStatus\('signedOut'\)/);
    const useHub = read('../../../../renderer/features/hub/hooks/use-hub.tsx');
    assert.match(useHub, /msg\.t === 'signedOut'[\s\S]{0,400}silentSignIn\.signedOut\(\)/);
    assert.match(useHub, /silentSignIn\.welcome\(\)/, 'a welcome re-arms the one try');
    assert.match(
        useHub,
        /authState\(\)[\s\S]{0,200}needsSignIn[\s\S]{0,120}signedOut\(\)/,
        'a memory-only secret lost to a restart is signed in again at start (R7)',
    );
});

test('the credential parsed from the Navidrome login is its u, s and t', () => {
    assert.deepEqual(
        parseSubsonicPair('u=alice&s=a1b2c3&t=0123456789abcdef0123456789abcdef'),
        PAIR,
    );
    assert.deepEqual(
        parseSubsonicPair('u=a&b&s=zz&s=a1b2c3&t=0123456789abcdef0123456789abcdef')?.username,
        'a&b&s=zz',
        'the username is stored unescaped: everything up to the last &s=',
    );
    for (const credential of [
        '',
        undefined,
        null,
        'u=alice&p=enc:7365637265',
        'u=&s=a1b2c3&t=0123456789abcdef0123456789abcdef',
        'u=alice&s=ab&t=0123456789abcdef0123456789abcdef',
        'u=alice&s=a1b2c3&t=NOTHEX',
        'MediaBrowser Token="x"',
    ]) {
        assert.equal(parseSubsonicPair(credential), null, String(credential));
    }
});

// --- the secret stays in main ------------------------------------------------------------------

const here = (path: string) => new URL(path, import.meta.url);
const read = (path: string) => readFileSync(here(path), 'utf8');
const walk = (dir: URL): string[] =>
    readdirSync(dir).flatMap((name) => {
        const child = new URL(`${name}`, dir);
        if (statSync(child).isDirectory()) return walk(new URL(`${name}/`, dir));
        return /\.(ts|tsx)$/.test(name) && !name.endsWith('.harness.ts') ? [child.pathname] : [];
    });

test('secret not in plain prefs', async () => {
    // Encryption available: the store holds ciphertext only.
    const w = world({ answers: [signedIn()] });
    w.auth.load();
    const result = await w.auth.signIn(PAIR);
    const stored = JSON.stringify(w.plain);
    assert.ok(!stored.includes(SECRET), 'the secret is not in electron-store in plain');
    assert.equal(typeof w.plain[SECRET_KEY], 'string');
    assert.ok(!JSON.stringify(result).includes(SECRET), 'the IPC answer does not carry it');
    assert.ok(!JSON.stringify(w.auth.state()).includes(SECRET));
    for (const line of w.logs) {
        assert.ok(!line.includes(SECRET), `logged: ${line}`);
        assert.ok(!line.includes(PAIR.token) && !line.includes(PAIR.salt), `logged: ${line}`);
    }

    // No OS encryption (R7): memory only. Nothing is written, not even the ciphertext slot.
    const bare = world({ answers: [signedIn()], encryption: false });
    bare.auth.load();
    await bare.auth.signIn(PAIR);
    assert.equal(bare.auth.bearer(), SECRET);
    assert.equal(bare.plain[SECRET_KEY], undefined);
    assert.ok(!JSON.stringify(bare.plain).includes(SECRET));
    assert.deepEqual(bare.auth.state(), { memoryOnly: true, needsSignIn: false, signedIn: true });
    const restarted = createHubAuth(bare.deps);
    restarted.load();
    assert.deepEqual(
        restarted.state(),
        { memoryOnly: true, needsSignIn: true, signedIn: false },
        'after a restart it is owed one silent sign-in',
    );

    // A ciphertext the keyring can no longer open is dropped, and a sign-in is owed.
    const broken = world({ answers: [signedIn()] });
    broken.auth.load();
    await broken.auth.signIn(PAIR);
    broken.deps.vault.decrypt = () => {
        throw new Error(
            'Error while decrypting the ciphertext provided to safeStorage.decryptString.',
        );
    };
    const reopened = createHubAuth(broken.deps);
    reopened.load();
    assert.equal(reopened.bearer(), null);
    assert.equal(broken.plain[SECRET_KEY], undefined);
    assert.equal(reopened.state().needsSignIn, true);

    // The renderer and the preload never name it, so no persisted setting or IPC payload can.
    const outside = [
        ...walk(here('../../../../renderer/')),
        ...walk(here('../../../../preload/')),
        ...walk(here('../../../../remote/')),
    ];
    assert.ok(outside.length > 500, `walked ${outside.length} files`);
    for (const file of outside) {
        const code = readFileSync(file, 'utf8');
        assert.doesNotMatch(code, /deviceSecret|hubAuth\.secret/, file);
    }
    // The renderer's persisted hub settings have no slot for it.
    const settings = read('../../../../renderer/store/settings.store.ts');
    const schema = settings.slice(settings.indexOf('const HubSettingsSchema'));
    assert.doesNotMatch(schema.slice(0, schema.indexOf('});')), /secret/i);
    // And the generic settings IPC cannot read the slot out of electron-store.
    const ipc = read('../settings/index.ts');
    assert.equal(
        (ipc.match(/if \(isMainOnlyKey\(data\.property\)\) return/g) ?? []).length,
        3,
        'settings-get, settings-set and settings-set-sync each refuse the hubAuth slots',
    );
});

test('the IPC handlers hand the renderer results, never the secret', () => {
    const hub = read('./index.ts');
    assert.match(hub, /ipcMain\.handle\('hub-signin'/);
    assert.match(hub, /ipcMain\.handle\('hub-signout'/);
    assert.match(hub, /ipcMain\.handle\('hub-auth-state'/);
    const preload = read('../../../../preload/hub.ts');
    for (const channel of ['hub-signin', 'hub-signout', 'hub-auth-state']) {
        assert.ok(preload.includes(`'${channel}'`), channel);
    }
});

// --- one accessor ------------------------------------------------------------------------------

test('every main client and the cast bridge read hubAuth.bearer', () => {
    const main = walk(here('../../'));
    assert.ok(main.length > 30, `walked ${main.length} main files`);
    for (const file of main) {
        const code = readFileSync(file, 'utf8');
        assert.doesNotMatch(code, /getHubConfig\(\)\.token/, file);
        assert.doesNotMatch(code, /\{[^}\n]*\btoken\b[^}\n]*\}\s*=\s*getHubConfig\(\)/, file);
        assert.doesNotMatch(code, /\bconfig\.token\b(?![^\n]*legacy)/, file);
    }
    for (const client of ['lbbot', 'preview', 'audiomuse', 'mood', 'station']) {
        const code = read(`../${client}/index.ts`);
        assert.match(code, /hubAuth\.bearer\(\)/, client);
    }
    const cast = read('../cast/index.ts');
    assert.match(
        cast,
        /hubAuth\.helloCredential\(\)/,
        'the cast hello carries the same credential',
    );
});

// --- the cast bridge ---------------------------------------------------------------------------

test('cast bridge hello carries bridgedBy', async () => {
    const w = world({ answers: [signedIn('minted-id-0001')], token: 'legacy' });
    w.auth.load();
    await w.auth.signIn(PAIR);
    const frame = castHelloFrame({
        bridgedBy: String(w.plain['hub.deviceId']),
        castId: 'abcd',
        credential: w.auth.helloCredential(),
        kind: 'speaker',
        name: 'Kitchen',
    });
    assert.equal(frame.t, 'hello');
    assert.equal(frame.device.id, 'cast-abcd');
    assert.equal(frame.device.bridgedBy, 'minted-id-0001', 'the id the hub gave this device (R4)');
    assert.deepEqual(frame.auth, { deviceSecret: SECRET }, "the bridging device's own secret");
    assert.ok(!('token' in frame), 'no shared token beside a secret');
    assert.deepEqual(frame.device.caps, ['receiver', 'loadAck', 'idleVolume']);
    assert.deepEqual(
        castHelloFrame({
            bridgedBy: 'x',
            castId: 'g',
            credential: { token: 'legacy' },
            kind: 'group',
            name: 'All',
        }),
        {
            device: {
                bridgedBy: 'x',
                caps: ['receiver', 'loadAck'],
                id: 'cast-g',
                kind: 'group',
                name: 'All',
                platform: 'chromecast',
            },
            t: 'hello',
            token: 'legacy',
        },
    );
    const cast = read('../cast/index.ts');
    assert.match(
        cast,
        /castHelloFrame\(\{\s*bridgedBy: getHubDeviceId\(\),[\s\S]{0,80}credential: hubAuth\.helloCredential\(\)/,
    );
});
