import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import {
    addressFieldValue,
    capabilityLines,
    CONNECT_GRACE_MS,
    DEFAULT_HUB_URL,
    hubLink,
    type HubLinkInput,
    isHubConfigured,
    normaliseHubAddress,
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

test('anUnansweredProbeIsCheckingNotNo', () => {
    const lines = capabilityLines({ ...allOk, clap: undefined, stations: 'pending' });
    assert.match(lines[1].text, /checking/i);
    assert.match(lines[2].text, /checking/i);
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
