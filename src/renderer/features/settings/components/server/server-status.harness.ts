import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import type { HubSignInResult } from '../../../../../shared/utils/hub-signin.ts';

import { hubFailureMessage } from '../../../hub/utils/hub-failure.ts';
import {
    addressFieldValue,
    capabilityLines,
    CONNECT_GRACE_MS,
    DEFAULT_HUB_URL,
    hubLink,
    type HubLinkInput,
    isHubConfigured,
    normaliseHubAddress,
    serverStatus,
    serverStatusSentence,
    showTokenField,
    type SignInInput,
    statusSentence,
} from './server-status.ts';

/**
 * F2:  node --test src/renderer/features/settings/components/server/server-status.harness.ts
 *
 * The hub section had no status line and no word on what the hub answered: a stranger could not
 * tell "not set up" from "can't reach" from "wrong token", and the capability lines (library
 * tools, AudioMuse, stations, casting) came from nowhere. Every state of the link, and of what
 * the connection offers, becomes one sentence here, read from state the app already holds.
 */

const NOW = 1_000_000;
const here = (name: string) => new URL(name, import.meta.url);
const read = (name: string) => readFileSync(here(name), 'utf8');

const fresh: HubLinkInput = {
    attemptAt: NOW - 60_000,
    authRefused: false,
    connected: false,
    enabled: false,
    now: NOW,
    token: '',
    url: DEFAULT_HUB_URL,
};
const on: HubLinkInput = { ...fresh, enabled: true, token: 't', url: 'ws://192.168.1.10:4790' };

test('aFreshProfileIsNotConfiguredAndSaysSo', () => {
    assert.equal(isHubConfigured(fresh), false);
    assert.equal(hubLink(fresh), 'notConfigured');
    assert.match(statusSentence('notConfigured', ''), /not set up/i);
});

test('anAddressOrATokenTypedWithTheSwitchOffIsConfiguredAndOff', () => {
    assert.equal(hubLink({ ...fresh, url: 'ws://192.168.1.10:4790' }), 'off');
    assert.equal(hubLink({ ...fresh, token: 'x' }), 'off');
    assert.match(statusSentence('off', 'ws://192.168.1.10:4790'), /off/i);
});

test('theSwitchOnWithNoAddressIsNotConfigured', () => {
    assert.equal(hubLink({ ...on, url: '' }), 'notConfigured');
    assert.equal(hubLink({ ...on, url: '   ' }), 'notConfigured');
});

test('theSwitchOnWithTheUntouchedDefaultAddressAndNoTokenIsNotConfiguredNotConnecting', () => {
    // The field shows empty (placeholder) for the default, so the line must not claim a value.
    const empty = { ...fresh, attemptAt: NOW - 1_000, enabled: true };
    assert.equal(hubLink(empty), 'notConfigured');
    assert.equal(hubLink({ ...empty, attemptAt: NOW - 60_000 }), 'notConfigured');
    // A token typed, or an address typed, is a real attempt again.
    assert.equal(hubLink({ ...empty, token: 't' }), 'connecting');
    assert.equal(hubLink({ ...empty, url: 'ws://192.168.1.10:4790' }), 'connecting');
    // And a connection that works is shown as one, whatever the address.
    assert.equal(hubLink({ ...empty, connected: true }), 'connected');
});

test('connectedNamesTheAddress', () => {
    const link = hubLink({ ...on, connected: true });
    assert.equal(link, 'connected');
    assert.match(
        statusSentence(link, 'ws://192.168.1.10:4790'),
        /Connected to ws:\/\/192\.168\.1\.10:4790/,
    );
});

test('connectingThenCantReachAfterTheGraceWindow', () => {
    assert.equal(hubLink({ ...on, attemptAt: NOW - 1_000 }), 'connecting');
    assert.equal(hubLink({ ...on, attemptAt: NOW - (CONNECT_GRACE_MS - 1) }), 'connecting');
    assert.equal(hubLink({ ...on, attemptAt: NOW - CONNECT_GRACE_MS }), 'unreachable');
    assert.match(statusSentence('unreachable', 'ws://h:1'), /Can.t reach ws:\/\/h:1/);
    assert.match(statusSentence('connecting', 'ws://h:1'), /Connecting/);
});

test('aRefusedTokenIsNamedAndOutranksTheOtherFailures', () => {
    assert.equal(hubLink({ ...on, attemptAt: NOW - 1_000, authRefused: true }), 'refused');
    assert.equal(hubLink({ ...on, authRefused: true }), 'refused');
    assert.match(statusSentence('refused', 'ws://h:1'), /refused.*token/i);
});

test('aStaleRefusalNeverOutranksAConnection', () => {
    assert.equal(hubLink({ ...on, authRefused: true, connected: true }), 'connected');
});

test('aRefusalWithTheSwitchOffReadsAsOffNotAsAnError', () => {
    assert.equal(hubLink({ ...fresh, authRefused: true, token: 'x' }), 'off');
});

const allOk = {
    clap: true,
    libraryTools: true,
    libraryToolsRefused: false,
    speakers: 2,
    stations: 'stations' as const,
};

test('everyCapabilityGetsOneLineInAFixedOrder', () => {
    const lines = capabilityLines(allOk);
    assert.deepEqual(
        lines.map((l) => l.id),
        ['library', 'audiomuse', 'stations', 'casting'],
    );
    assert.match(lines[0].text, /Library tools.*ready/i);
    assert.match(lines[1].text, /AudioMuse.*ready/i);
    assert.match(lines[2].text, /Stations.*ready/i);
    assert.match(lines[3].text, /Casting.*2 speakers/i);
});

test('eachCapabilityHasADistinctSentenceWhenItIsMissing', () => {
    const lines = capabilityLines({
        clap: false,
        libraryTools: false,
        libraryToolsRefused: false,
        speakers: 0,
        stations: 'fallback',
    });
    assert.match(lines[0].text, /Library tools.*not set up/i);
    assert.match(lines[1].text, /AudioMuse.*not available/i);
    assert.match(lines[2].text, /Stations.*not available.*Autoplay.*this computer/i);
    assert.match(lines[3].text, /Casting.*no speakers/i);
    const ready = capabilityLines(allOk).map((l) => l.text);
    for (const [i, line] of lines.entries()) assert.notEqual(line.text, ready[i]);
});

test('libraryToolsRefusedIsNotTheSameSentenceAsNotSetUp', () => {
    const refused = capabilityLines({ ...allOk, libraryTools: false, libraryToolsRefused: true });
    const missing = capabilityLines({ ...allOk, libraryTools: false });
    assert.notEqual(refused[0].text, missing[0].text);
    assert.match(refused[0].text, /refused/i);
});

test('anUnansweredAudioMuseProbeDrawsNoLineAtAll', () => {
    // The tab never runs this probe itself, so a fresh session could read "checking" forever.
    const lines = capabilityLines({ ...allOk, clap: undefined });
    assert.deepEqual(
        lines.map((l) => l.id),
        ['library', 'stations', 'casting'],
    );
    assert.ok(lines.every((l) => !/AudioMuse/i.test(l.text)));
    for (const clap of [true, false]) {
        assert.ok(capabilityLines({ ...allOk, clap }).some((l) => l.id === 'audiomuse'));
    }
});

test('aStationProbeStillInFlightReadsCheckingBecauseItAlwaysEnds', () => {
    // The always-mounted station service probes on connect; the request has a timeout and a
    // catch, so 'pending' ends in 'stations' or 'fallback'.
    const lines = capabilityLines({ ...allOk, stations: 'pending' });
    assert.match(lines.find((l) => l.id === 'stations')!.text, /checking/i);
});

test('oneSpeakerIsSingular', () => {
    assert.match(capabilityLines({ ...allOk, speakers: 1 })[3].text, /1 speaker\b(?!s)/);
});

test('theDefaultAddressIsShownEmptyOnlyWhileNothingIsConfigured', () => {
    assert.equal(addressFieldValue(DEFAULT_HUB_URL, false), '');
    assert.equal(addressFieldValue(DEFAULT_HUB_URL, true), DEFAULT_HUB_URL);
    assert.equal(addressFieldValue('ws://192.168.1.10:4790', false), 'ws://192.168.1.10:4790');
});

test('anAddressTypedWithoutASchemeOrWithHttpIsMadeAWebSocketAddress', () => {
    assert.equal(normaliseHubAddress('192.168.1.10:4790'), 'ws://192.168.1.10:4790');
    assert.equal(normaliseHubAddress(' http://hub.lan:4790 '), 'ws://hub.lan:4790');
    assert.equal(normaliseHubAddress('https://hub.example.com'), 'wss://hub.example.com');
    assert.equal(normaliseHubAddress('ws://h:1'), 'ws://h:1');
    assert.equal(normaliseHubAddress('WSS://h:1'), 'wss://h:1');
    assert.equal(normaliseHubAddress(''), DEFAULT_HUB_URL);
    assert.equal(normaliseHubAddress('   '), DEFAULT_HUB_URL);
});

test('noSentenceNamesAnInternalTerm', () => {
    const all: string[] = [];
    for (const link of [
        'connected',
        'connecting',
        'notConfigured',
        'off',
        'refused',
        'unreachable',
    ] as const) {
        all.push(statusSentence(link, 'ws://h:1'));
    }
    for (const stations of ['fallback', 'pending', 'stations'] as const) {
        for (const clap of [true, false, undefined]) {
            for (const refused of [true, false]) {
                capabilityLines({ ...allOk, clap, libraryToolsRefused: refused, stations }).forEach(
                    (l) => all.push(l.text),
                );
            }
        }
    }
    assert.ok(all.every((s) => s.length > 0));
    for (const sentence of all) {
        assert.doesNotMatch(sentence, /navi-connect|HUB_TOKEN|WebSocket|lb-bot|\bhub\b/i, sentence);
    }
});

// --- the tab as built ---------------------------------------------------------------------------

const serverFiles = readdirSync(here('.')).filter((f) => f.endsWith('.tsx'));

test('theServerTabIsFirstOnDesktop', () => {
    const content = readFileSync(here('../settings-content.tsx'), 'utf8');
    const tabs = [...content.matchAll(/<Tabs\.Tab value="(\w+)"/g)].map((m) => m[1]);
    assert.equal(tabs[0], 'server');
    const server = content.indexOf('<Tabs.Tab value="server"');
    assert.match(content.slice(server - 80, server), /desktop && \(/);
});

test('theServerTabSectionsAreInThePlansOrder', () => {
    const tab = read('./server-tab.tsx');
    const at = (name: string) => tab.indexOf(`<${name}`);
    const order = [
        'WorbusServerSettings',
        'CastingSettings',
        'WithoutServerSettings',
        'RemoteSettings',
    ];
    order.forEach((name) => assert.ok(at(name) >= 0, `${name} is on the tab`));
    assert.deepEqual(
        [...order].sort((a, b) => at(a) - at(b)),
        order,
    );
});

test('noServerTabFileSpeaksInternalNames', () => {
    assert.ok(serverFiles.length >= 4, `expected the tab's components, got ${serverFiles}`);
    for (const file of serverFiles) {
        const code = read(`./${file}`)
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:'"\w/])\/\/.*$/gm, '$1');
        assert.doesNotMatch(code, /navi-connect|HUB_TOKEN|WebSocket/i, file);
    }
});

test('theTokensArePasswordInputsAndEveryControlIsNamed', () => {
    const hub = read('./worbus-server-settings.tsx');
    assert.match(hub, /<PasswordInput/);
    assert.doesNotMatch(hub, /defaultValue=\{settings\.token\}[\s\S]{0,40}<TextInput/);
    for (const file of serverFiles) {
        const code = read(`./${file}`);
        const controls = (
            code.match(/<(TextInput|PasswordInput|Switch|NumberInput|Select)\b/g) ?? []
        ).length;
        const named = (code.match(/aria-label=/g) ?? []).length;
        assert.ok(named >= controls, `${file}: ${controls} controls, ${named} aria-labels`);
    }
});

// --- the component must not diverge from the tested functions ------------------------------------
// The pure functions above are tested; these pin that the component still routes through them
// (a reviewer deleted each of these lines and every other test stayed green).

test('theStatusLineReadsTheStoresRefusalAndTheClockAndOnlyDrawsCapabilitiesWhenConnected', () => {
    const hub = read('./worbus-server-settings.tsx');
    assert.match(
        hub,
        /const libraryRefused = useHubStore\(\(s\) => s\.lbRefused\)/,
        'the refusal comes from the hub store',
    );
    assert.match(
        hub,
        /libraryToolsRefused:\s*libraryRefused\b/,
        'capabilityLines gets the store refusal, not a constant',
    );
    assert.match(
        hub,
        /useNowAfter\(attemptAt,\s*settings\.enabled && !connected\)/,
        'the clock runs from the last attempt while switched on and not connected',
    );
    assert.match(
        hub,
        /link === 'connected'\s*\?\s*capabilityLines\(\{[\s\S]*?\}\)\s*:\s*\[\]/,
        'the capability lines are drawn only when connected',
    );
    assert.match(hub, /hubLink\(\{[\s\S]*?now,[\s\S]*?\}\)/, 'hubLink gets the ticking clock');
});

test('theDeviceNameAndPublicUrlFieldsShowWhatResolveReturned', () => {
    const hub = read('./worbus-server-settings.tsx');
    assert.match(
        hub,
        /const result = resolveDeviceName\(name, settings\.name\);\s*setName\(result\.draft\);/,
        'the device-name field is set to the resolved draft before storing',
    );
    assert.match(
        hub,
        /const result = resolvePublicServerUrl\([\s\S]*?\);\s*setPublicUrl\(result\.draft\);/,
        'the public-URL field is set to the resolved draft, also when it was rejected',
    );
});

// --- Worbus P2, F2: signing in instead of a token ---------------------------------------------

const ALICE = { admin: true, name: 'alice', primary: false };
const BOB = { admin: false, name: 'bob', primary: false };
const notYet: SignInInput = {
    hasToken: false,
    result: null,
    signedIn: false,
    signedOut: false,
    signingIn: false,
    user: null,
    username: 'alice',
};

/** The status line the tab draws, for a link and a sign-in state. */
const line = (link: HubLinkInput, sign: Partial<SignInInput>) => {
    const state = { ...notYet, ...sign };
    const id = serverStatus(hubLink(link), state);
    return { id, text: serverStatusSentence(id, link.url, state) };
};

test('status for each signin result', () => {
    const live = { ...on, token: '' };
    // Design §6.2's table, verbatim, for each refusal.
    const refusals: [HubSignInResult, string][] = [
        [
            { kind: 'navidromeRefused' },
            "This Worbus Server's Navidrome doesn't know this account. It may use a different Navidrome server.",
        ],
        [
            { kind: 'navidromeUnreachable' },
            "The Worbus Server can't reach its Navidrome right now.",
        ],
        [{ kind: 'tooManyAttempts' }, 'Too many attempts. Try again in a few minutes.'],
    ];
    for (const [result, sentence] of refusals) {
        assert.equal(line(live, { result }).text, sentence, result.kind);
        // A refusal is never read as a network problem (anti-goal).
        assert.doesNotMatch(line(live, { result }).text, /can.t reach ws|connecting/i);
    }
    // §6.5: signed out by the server, the silent sign-in having failed.
    assert.equal(line(live, { signedOut: true }).text, 'Signed out of the Worbus Server');
    // Signed in, with the server's view of who and what.
    assert.equal(
        line({ ...live, connected: true }, { signedIn: true, user: ALICE }).text,
        'Signed in as alice · admin',
    );
    assert.equal(
        line({ ...live, connected: true }, { signedIn: true, user: BOB }).text,
        'Signed in as bob',
    );
    assert.equal(line(live, { signingIn: true }).id, 'signingIn');
    assert.match(line(live, { signingIn: true }).text, /Signing in as alice/);
    // An older server: the token field below, and the sentence says where.
    assert.equal(line(live, { result: { kind: 'oldServer' } }).id, 'oldServer');
    assert.match(line(live, { result: { kind: 'oldServer' } }).text, /token.*Advanced/i);
    // Not signed in and nothing to connect with: says so, does not pretend to be connecting.
    assert.equal(line({ ...live, attemptAt: NOW - 1_000 }, {}).id, 'notSignedIn');
    assert.match(line(live, {}).text, /Not signed in.*Sign in as alice/);
    // The hub did not answer the sign-in: the link's own "can't reach" sentence.
    assert.equal(line(live, { result: { kind: 'unreachable' } }).id, 'notSignedIn');
    assert.equal(
        line({ ...live, token: 't' }, { hasToken: true, result: { kind: 'unreachable' } }).id,
        'unreachable',
    );
    // An account this app cannot send.
    assert.match(
        line(live, { result: { kind: 'noAccount' }, username: null }).text,
        /music server/i,
    );
    // A typed token with no sign-in (an owner's client from before): connected as today.
    assert.equal(line({ ...on, connected: true }, { hasToken: true, user: ALICE }).id, 'connected');
    // A refusal outranks a stale "connected"; the switch off is still "off".
    assert.equal(
        line({ ...on, connected: true }, { hasToken: true, result: { kind: 'navidromeRefused' } })
            .id,
        'navidromeRefused',
    );
    assert.equal(line(fresh, {}).id, 'notConfigured');
    assert.equal(line({ ...fresh, url: 'ws://h:1' }, { signedIn: true }).id, 'off');
    // Every sentence is words for a person.
    for (const result of [...refusals.map(([r]) => r), { kind: 'oldServer' } as const]) {
        assert.doesNotMatch(
            line(live, { result }).text,
            /navi-connect|HUB_TOKEN|WebSocket|\bhub\b|_/i,
        );
    }
});

test('token field only after old server', () => {
    const kinds: HubSignInResult[] = [
        { deviceId: 'd', kind: 'signedIn', user: ALICE },
        { kind: 'navidromeRefused' },
        { kind: 'navidromeUnreachable' },
        { kind: 'tooManyAttempts' },
        { kind: 'unreachable' },
        { kind: 'badRequest' },
        { kind: 'noAccount' },
    ];
    assert.equal(showTokenField(null), false, 'before any sign-in: no token field');
    for (const result of kinds) assert.equal(showTokenField(result), false, result.kind);
    assert.equal(showTokenField({ kind: 'oldServer' }), true);

    const hub = read('./worbus-server-settings.tsx');
    // The token row is not in the main group any more...
    const main = hub.slice(
        hub.indexOf('export const WorbusServerSettings'),
        hub.indexOf('export const CastingSettings'),
    );
    const options = main.slice(
        main.indexOf('const options = ['),
        main.indexOf('];', main.indexOf('const options = [')),
    );
    assert.doesNotMatch(options, /PasswordInput|title: 'Access token'/);
    // ...it is its own Advanced section, drawn only when the last sign-in found an older server.
    assert.match(
        main,
        /\{showToken && \(?\s*<SettingsSection options=\{tokenOptions\} title="Advanced"/,
    );
    assert.match(main, /const showToken = showTokenField\(signInResult\)/);
    assert.match(main, /title: 'Server token, for older servers'/);
    // Sign in / Sign out are absent (not disabled) when they do not apply.
    assert.match(main, /isHidden: signedIn \|\| !username/);
    assert.match(main, /isHidden: !signedIn/);
    assert.match(main, /title: `Sign in as \$\{username\}`/);
    assert.match(main, /title: 'Sign out of this server'/);
    assert.match(main, /signInWithCurrentServer\(\)/);
});

test('the hub failure toast covers the new codes and never reads as a hub error', () => {
    assert.equal(
        hubFailureMessage({ code: 'navidrome_refused' }),
        "This Worbus Server's Navidrome doesn't know this account. It may use a different Navidrome server.",
    );
    assert.equal(
        hubFailureMessage({ code: 'navidrome_unreachable' }),
        "The Worbus Server can't reach its Navidrome right now.",
    );
    assert.equal(
        hubFailureMessage({ code: 'too_many_attempts' }),
        'Too many attempts. Try again in a few minutes.',
    );
    assert.equal(
        hubFailureMessage({ code: 'signed_out', message: 'x' }),
        'Signed out of the Worbus Server',
    );
    assert.match(hubFailureMessage({ code: 'primary_only' }), /primary|owner/i);
    assert.match(hubFailureMessage({ code: 'lbbot_too_old' }), /too old/i);
    assert.match(hubFailureMessage({ code: 'auth' }), /refused the access token/);
    assert.match(hubFailureMessage({ code: 'target_offline' }), /offline/);
    assert.doesNotMatch(hubFailureMessage({ code: 'something_new' }), /Hub error/);
    const useHub = read('../../../hub/hooks/use-hub.tsx');
    assert.match(
        useHub,
        /import \{ hubFailureMessage \} from '\/@\/renderer\/features\/hub\/utils\/hub-failure'/,
    );
    assert.doesNotMatch(useHub, /const hubFailureMessage =/);
});
