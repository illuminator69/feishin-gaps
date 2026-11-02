import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';

import type { HubUser } from '../../../../shared/utils/hub-signin.ts';

import { isLbRefusal, refusalCode } from '../../../../shared/utils/lbbot-failure.ts';
import {
    LB_ANSWERED,
    stateAfterRefusal,
    tooOldAfterRefusal,
    tooOldFromLb,
} from '../../../../shared/utils/lbbot-mode.ts';
import { capabilityLines } from '../../settings/components/server/server-status.ts';
import { sidebarGroups } from '../../sidebar/utils/sidebar-groups.ts';
import {
    accountChange,
    accountKey,
    accountMismatch,
    allows,
    createAccountFollower,
    followAccount,
    ROLE_GATES,
    rolesOf,
    userAfterRefusal,
} from './hub-roles.ts';

// mix-recipe.ts imports station-logic through the app's `/@/` alias; resolve it to the source.
registerHooks({
    resolve: (specifier, context, nextResolve) =>
        specifier.startsWith('/@/')
            ? nextResolve(
                  new URL(`../../../../${specifier.slice(3)}.ts`, import.meta.url).href,
                  context,
              )
            : nextResolve(specifier, context),
});

const { formKindsFor, isPrimaryOnlyMix } = await import('../../mixes/mix-recipe.ts');

/**
 * Worbus P2 lane F, F3:  node --test src/renderer/features/hub/utils/hub-roles.harness.ts
 *
 * `hub.store.user` (`welcome.user`, then each `user` frame) is the only role source for the hub
 * and lb-bot surfaces. A non-admin keeps browse, the wishlist and Scan now and sees no download,
 * override, merge, match or Needs attention action; a non-primary user sees no listening, Stats,
 * Your mix or fingerprint mix. No `user` (an older hub) is today's behaviour. A Navidrome logout
 * or a switch of the current server signs out of the hub, clears the lb-bot mirror and the
 * saved-queue cache, and a switch signs in again with the new server's account.
 */

const OWNER: HubUser = { admin: true, name: 'owner', primary: true };
const ALICE: HubUser = { admin: true, name: 'alice', primary: false };
const BOB: HubUser = { admin: false, name: 'bob', primary: false };

const here = (path: string) => new URL(path, import.meta.url);
const read = (path: string) => readFileSync(here(path), 'utf8');
const readAbs = (path: string) => readFileSync(path, 'utf8');
const walkRenderer = (dir: URL = here('../../../')): string[] =>
    readdirSync(dir).flatMap((name) => {
        const child = new URL(`${name}`, dir);
        if (statSync(child).isDirectory()) return walkRenderer(new URL(`${name}/`, dir));
        return /\.(ts|tsx)$/.test(name) && !name.endsWith('.harness.ts') ? [child.pathname] : [];
    });
const ADMIN_GATES = Object.entries(ROLE_GATES)
    .filter(([, role]) => role === 'admin')
    .map(([gate]) => gate);
const PRIMARY_GATES = Object.entries(ROLE_GATES)
    .filter(([, role]) => role === 'primary')
    .map(([gate]) => gate);

const sidebar = (admin: boolean | undefined, listeningSupported = true) =>
    sidebarGroups({
        ...(admin === undefined ? {} : { admin }),
        attentionCount: 2,
        downloadsShown: true,
        lbBotAvailable: true,
        libraryItems: [],
        librarySelectedRoutes: [],
        listeningSupported,
        narrow: false,
        overridesSupported: true,
        routes: {
            activity: '/downloads',
            fresh: '/fresh',
            home: '/',
            library: '/library',
            libraryMatches: '/library-matches',
            listening: '/listening',
            savedQueues: '/saved-queues',
            settings: '/settings',
            wishlist: '/wishlist',
        },
        wishlistSupported: true,
    })
        .groups.flatMap((g) => g.entries)
        .map((e) => e.id);

test('the gate table names every surface the design lists', () => {
    assert.deepEqual(ADMIN_GATES.sort(), [
        'albumMatch',
        'artistMatch',
        'downloads',
        'libraryMatches',
        'merge',
        'needsAttention',
    ]);
    assert.deepEqual(PRIMARY_GATES.sort(), ['fingerprint', 'listening', 'yourMix']);
});

test('user frame moves gates', () => {
    // An idle socket hears a demotion: the `user` frame replaces `welcome.user` in the store, and
    // every gate reads the store, so admin actions vanish in place.
    let user: HubUser | null = ALICE;
    assert.equal(allows(rolesOf(user), 'downloads'), true);
    user = { ...ALICE, admin: false };
    for (const gate of ADMIN_GATES) assert.equal(allows(rolesOf(user), gate as never), false, gate);
    user = { ...user, admin: true };
    for (const gate of ADMIN_GATES) assert.equal(allows(rolesOf(user), gate as never), true, gate);

    const useHub = read('../hooks/use-hub.tsx');
    assert.match(
        useHub,
        /msg\.t === 'user'\)[\s\S]{0,400}parseHubUser\(msg\.user\)[\s\S]{0,200}setStore\(\{ user \}\)/,
        'the user frame is applied to hub.store.user',
    );
    assert.match(
        useHub,
        /const welcomeUser = parseHubUser\(msg\.user\);[\s\S]{0,4000}user: welcomeUser,/,
        'welcome.user is the first value',
    );
    // A refusal that says the flags are already lower moves the gate before the frame arrives.
    assert.deepEqual(userAfterRefusal(ALICE, 'admin_only'), { ...ALICE, admin: false });
    assert.deepEqual(userAfterRefusal(OWNER, 'primary_only'), { ...OWNER, primary: false });
    assert.equal(userAfterRefusal(ALICE, 'downloads_off'), ALICE);
});

test('non admin sees no admin actions', () => {
    const bob = rolesOf(BOB);
    for (const gate of ADMIN_GATES) assert.equal(allows(bob, gate as never), false, gate);

    // The sidebar: no Needs attention, Activity or Library Matches; browse and the wishlist stay.
    const rows = sidebar(false);
    for (const id of ['needsAttention', 'libraryMatches']) assert.ok(!rows.includes(id), id);
    for (const id of ['home', 'library', 'fresh', 'wishlist']) assert.ok(rows.includes(id), id);

    // Each site reads its gate (one assertion per gate, so a dropped one is named).
    const lb = read('../../lbbot/hooks/use-lbbot.ts');
    const site = (name: string) => {
        const at = lb.indexOf(`export const ${name} =`);
        assert.ok(at >= 0, name);
        return lb.slice(at, lb.indexOf('\n};', at));
    };
    assert.match(site('useOverrideControls'), /allows\(useHubRoles\(\), 'artistMatch'\)/);
    assert.match(site('useAlbumOverrideControls'), /allows\(useHubRoles\(\), 'albumMatch'\)/);
    assert.match(site('useMergeControls'), /allows\(useHubRoles\(\), 'merge'\)/);
    assert.match(
        lb,
        /export const useLbBotDownloadsShown = \(\): boolean =>[\s\S]{0,160}allows\(useHubRoles\(\), 'downloads'\)/,
    );
    assert.match(
        lb,
        /const downloadsOffNow = \(\): boolean =>[\s\S]{0,160}!allows\(hubRolesNow\(\), 'downloads'\)/,
    );
    const groups = read('../../sidebar/components/sidebar-groups.tsx');
    assert.match(groups, /admin: allows\(roles, 'needsAttention'\)/);
    const items = read('../../sidebar/components/navi-connect-items.ts');
    assert.match(items, /overridesSupported && allows\(roles, 'libraryMatches'\)/);
    const matches = read('../../library-matches/routes/library-matches-route.tsx');
    assert.match(
        matches,
        /const roles = useHubRoles\(\);\s*const overridesSupported = useOverridesSupported\(\) && allows\(roles, 'libraryMatches'\)/,
    );
    // The fill buttons' failure toast is gated the same way, so a refusal hides, never toasts.
    const fills = read('../../lbbot/hooks/use-fill-actions.ts');
    assert.match(fills, /if \(!ok && downloadsShownNow\(\)\)/);
    const acquire = read('../../lbbot/components/acquire-button.tsx');
    assert.match(acquire, /isLbRefusal\(outcome\.result\.code\)\) return;/);

    // lb-bot's 403 admin_only is a quiet refusal: hidden, never an error toast.
    assert.equal(refusalCode(403, { code: 'admin_only' }), 'admin_only');
    assert.equal(isLbRefusal('admin_only'), true);
    assert.equal(isLbRefusal('primary_only'), true);
    // 503 lbbot_too_old: lb-bot is unavailable for this user - its own state, not "refused"
    // (review I3, M8): it ends on its own, and it reads as "not available to your account".
    assert.equal(refusalCode(503, { code: 'lbbot_too_old', error: 'x' }), 'lbbot_too_old');
    assert.equal(tooOldAfterRefusal(false, 'lbbot_too_old'), true);
    assert.equal(stateAfterRefusal({ mode: 'on', refused: false }, 'lbbot_too_old').refused, false);
    assert.equal(refusalCode(503, { error: 'busy' }), null, 'an ordinary 503 is not a refusal');
});

test('non primary sees no listening or fingerprint', () => {
    for (const user of [ALICE, BOB]) {
        for (const gate of PRIMARY_GATES) {
            assert.equal(allows(rolesOf(user), gate as never), false, `${user.name} ${gate}`);
        }
    }
    for (const gate of PRIMARY_GATES) assert.equal(allows(rolesOf(OWNER), gate as never), true);

    // Your mix is not offered in the mix form...
    assert.ok(formKindsFor(true, true).some((k) => k.id === 'yourMix'));
    assert.ok(!formKindsFor(true, false).some((k) => k.id === 'yourMix'));
    // ...and a saved recipe that plays as Your mix or the fingerprint is not listed.
    for (const kind of ['fingerprint', 'adaptive']) {
        assert.equal(isPrimaryOnlyMix({ kind, seedId: '' }), true, kind);
    }
    assert.equal(isPrimaryOnlyMix({ kind: 'station', seedId: '' }), true, 'a seedless station');
    assert.equal(isPrimaryOnlyMix({ kind: 'station', seedId: 'song-1' }), false, 'a radio');
    for (const kind of ['similar', 'genre', 'artist']) {
        assert.equal(isPrimaryOnlyMix({ kind, seedId: 'x' }), false, kind);
    }

    const lb = read('../../lbbot/hooks/use-lbbot.ts');
    const at = lb.indexOf('export const useListeningSupported =');
    assert.match(lb.slice(at, lb.indexOf('\n};', at)), /allows\(useHubRoles\(\), 'listening'\)/);
    const mixes = read('../../mixes/routes/mixes-route.tsx');
    assert.match(mixes, /stations && yourMixAllowed && <YourMixRow \/>/);
    assert.match(mixes, /\.filter\(\(mix\) => yourMixAllowed \|\| !isPrimaryOnlyMix\(mix\)\)/);
    const form = read('../../mixes/components/mix-form.tsx');
    assert.match(
        form,
        /formKindsFor\(useStationMode\(\) === 'stations', allows\(useHubRoles\(\), 'yourMix'\)\)/,
    );
    // Review I4: the command palette's Your mix too - and those two are the only ways to start it.
    const palette = read('../../search/components/home-commands.tsx');
    assert.match(palette, /const yourMixAllowed = allows\(useHubRoles\(\), 'yourMix'\);/);
    assert.match(palette, /\{stationMode === 'stations' && yourMixAllowed && \(/);
    const callers = walkRenderer().filter((file) => /\bplayYourMix\(/.test(readAbs(file)));
    assert.deepEqual(callers.map((f) => f.slice(f.indexOf('/features/') + 1)).sort(), [
        'features/mixes/routes/mixes-route.tsx',
        'features/search/components/home-commands.tsx',
    ]);
    // Signed in to a hub, the fingerprint never takes the direct AudioMuse route.
    const muse = read('../../../../main/features/core/audiomuse/index.ts');
    assert.match(
        muse,
        /if \(!ep\.viaHub && \(auth\.signedIn \|\| auth\.needsSignIn\)\) return \[\];/,
    );
});

test('older hub without user is as today', () => {
    const today = rolesOf(null);
    for (const gate of Object.keys(ROLE_GATES))
        assert.equal(allows(today, gate as never), true, gate);
    // The sidebar with no admin field (every caller before P2) is the same as admin.
    assert.deepEqual(sidebar(undefined), sidebar(true));
    assert.ok(sidebar(undefined).includes('needsAttention'));
    assert.ok(sidebar(undefined).includes('libraryMatches'));
    assert.equal(
        userAfterRefusal(null, 'admin_only'),
        null,
        'no user to lower: lb-bot holds the line',
    );
});

// --- account changes -------------------------------------------------------------------------

const recorder = (hubOn = true) => {
    const calls: string[] = [];
    return {
        calls,
        deps: {
            clearFills: () => calls.push('clearFills'),
            clearMirror: () => calls.push('clearMirror'),
            clearSavedQueues: () => calls.push('clearSavedQueues'),
            hubOn: () => hubOn,
            signIn: async () => {
                calls.push('signIn');
            },
            signOut: async () => {
                calls.push('signOut');
            },
        },
    };
};

test('server switch signs out and back in', async () => {
    assert.equal(accountChange('server-a', 'server-b'), 'switch');
    assert.equal(
        accountChange(null, 'server-a'),
        'switch',
        'signing in to a server after a logout',
    );
    assert.equal(accountChange('server-a', 'server-a'), 'none', 'the same server re-saved');
    const r = recorder();
    await followAccount('switch', r.deps);
    assert.deepEqual(r.calls, [
        'signOut',
        'clearMirror',
        'clearSavedQueues',
        'clearFills',
        'signIn',
    ]);
    // Connect off: nothing to sign in to, but the old account's traces still go.
    const off = recorder(false);
    await followAccount('switch', off.deps);
    assert.deepEqual(off.calls, ['signOut', 'clearMirror', 'clearSavedQueues', 'clearFills']);

    const useHub = read('../hooks/use-hub.tsx');
    assert.match(
        useHub,
        /useAuthStore\.subscribe\([\s\S]{0,300}accountChange\(\s*accountKey\(prev\.currentServer\),\s*accountKey\(state\.currentServer\),?\s*\)/,
        'every way the current server changes (selector, add, delete, logout, edit) goes through here',
    );
    assert.match(useHub, /signOut: \(\) => signOutOfServer\(\{ reconnect: false \}\)/);
    assert.match(useHub, /signIn: \(\) => signInWithCurrentServer\(\)/);
});

test('logout clears mirror and saved queues', async () => {
    assert.equal(accountChange('server-a', null), 'logout');
    const r = recorder();
    await followAccount('logout', r.deps);
    // Review M5: the fill ledger (an admin's download history) is the old account's too.
    assert.deepEqual(
        r.calls,
        ['signOut', 'clearMirror', 'clearSavedQueues', 'clearFills'],
        'and no sign-in',
    );
    const none = recorder();
    await followAccount('none', none.deps);
    assert.deepEqual(none.calls, []);
    const useHub = read('../hooks/use-hub.tsx');
    assert.match(useHub, /clearMirror: \(\) => clearIndexMirrorForHubChange\(true\)/);
    assert.match(
        useHub,
        /clearSavedQueues: \(\) => useSavedQueuesStore\.getState\(\)\.actions\.clearAll\(\)/,
    );
    assert.match(
        useHub,
        /clearFills: \(\) => useActiveFillsStore\.getState\(\)\.actions\.clear\(\)/,
    );
    const mirror = read('../../lbbot/index-mirror/index-mirror.ts');
    assert.match(
        mirror,
        /if \(!force && \(!meta\.hubUrl \|\| meta\.hubUrl === currentHubUrl\(\)\)\) return;/,
    );
});

// --- review I1, M7: the account is the server entry's user and address, not its id --------------

const SERVER = { id: 'server-a', url: 'https://nd.lan', username: 'Alice' };

test('editing the current server account is a switch', () => {
    // The edit form re-authenticates the current entry under the same id.
    assert.equal(
        accountChange(accountKey(SERVER), accountKey({ ...SERVER, username: 'bob' })),
        'switch',
    );
    assert.equal(
        accountChange(accountKey(SERVER), accountKey({ ...SERVER, url: 'https://other.lan' })),
        'switch',
    );
    // Re-saving the same account (a new password, the case of the name) is no change.
    assert.equal(
        accountChange(accountKey(SERVER), accountKey({ ...SERVER, username: 'alice' })),
        'none',
    );
    assert.equal(accountChange(accountKey(SERVER), accountKey({ ...SERVER })), 'none');
    assert.equal(accountChange(accountKey(SERVER), accountKey(null)), 'logout');
    assert.equal(accountChange(accountKey(null), accountKey(SERVER)), 'switch');
    assert.equal(accountChange(accountKey(undefined), accountKey(null)), 'none');
});

test('account changes run one at a time and a welcome for another user is followed', async () => {
    const calls: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
    });
    let first = true;
    const follow = createAccountFollower({
        clearFills: () => calls.push('clearFills'),
        clearMirror: () => calls.push('clearMirror'),
        clearSavedQueues: () => calls.push('clearSavedQueues'),
        hubOn: () => true,
        signIn: async () => {
            calls.push('signIn');
        },
        signOut: async () => {
            calls.push('signOut');
            if (first) {
                first = false;
                await gate;
            }
        },
    });
    // Two quick switches: the second waits for the first to finish, never interleaves with it.
    const a = follow('switch');
    const b = follow('switch');
    await Promise.resolve();
    assert.deepEqual(calls, ['signOut']);
    release();
    await Promise.all([a, b]);
    const one = ['signOut', 'clearMirror', 'clearSavedQueues', 'clearFills', 'signIn'];
    assert.deepEqual(calls, [...one, ...one]);

    // At a welcome: signed in as someone other than the current server's account (a crash
    // mid-switch, an edit that was missed) is a switch. Names compare lower-cased.
    const bob = { admin: false, name: 'bob', primary: false };
    assert.equal(accountMismatch(bob, 'alice', true), true);
    assert.equal(accountMismatch(bob, 'Bob', true), false);
    assert.equal(accountMismatch(bob, 'alice', false), false, 'on a token: R23 upgrades it');
    assert.equal(accountMismatch(bob, null, true), false, 'no account here to compare');
    assert.equal(accountMismatch(null, 'alice', true), false, 'an older hub names nobody');

    const useHub = read('../hooks/use-hub.tsx');
    assert.match(useHub, /const followAccountChange = createAccountFollower\(\{/);
    assert.match(
        useHub,
        /accountMismatch\(\s*welcomeUser,\s*currentServerUsername\(\),\s*useHubStore\.getState\(\)\.authSignedIn,?\s*\)/,
    );
    assert.match(useHub, /void followAccountChange\('switch'\);/);
});

// --- review M1: a secret held with no user yet is least privilege ------------------------------

test('a held secret with no user yet shows no admin or primary surface', () => {
    for (const gate of Object.keys(ROLE_GATES)) {
        assert.equal(allows(rolesOf(null, true), gate as never), false, gate);
        assert.equal(allows(rolesOf(null, false), gate as never), true, `${gate}: as today`);
    }
    assert.deepEqual(rolesOf(BOB, true), { admin: false, primary: false }, 'a user decides');
    assert.deepEqual(rolesOf(OWNER, true), { admin: true, primary: true });
    const store = read('../../../store/hub.store.ts');
    assert.match(
        store,
        /useHubStore\(\(s\) => rolesOf\(s\.user, hubCredentialPending\(s\)\), shallow\)/,
    );
    assert.match(
        store,
        /export const hubCredentialPending = \(s: [^)]*\): boolean =>\s*s\.authSignedIn \|\| s\.authOwed \|\| s\.signedOut;/,
    );
});

// --- review I3, M8: lbbot_too_old ends on the hub's word or on an answer ------------------------

test('lbbot too old clears on identity or a later answer', () => {
    const NON_PRIMARY = { primary: false };
    const PRIMARY = { primary: true };
    // A refusal sets it; the next answer that got through (R17: only with lb-bot's identity
    // header) clears it; any other code leaves it.
    assert.equal(tooOldAfterRefusal(false, 'lbbot_too_old'), true);
    assert.equal(tooOldAfterRefusal(true, LB_ANSWERED), false);
    assert.equal(tooOldAfterRefusal(true, 'downloads_off'), true);
    // `welcome.lb` and the `lb` frame state it: lb-bot answers for everyone once it reports
    // `identity`, and only the primary user before then (hub.py `caller.primary or identity`).
    assert.equal(tooOldFromLb({ available: true, identity: true }, NON_PRIMARY), false);
    assert.equal(tooOldFromLb({ available: true }, NON_PRIMARY), true);
    assert.equal(tooOldFromLb({ available: true }, PRIMARY), false);
    assert.equal(tooOldFromLb({ available: true }, null), false, 'an older hub: as today');
    assert.equal(tooOldFromLb({ available: false }, NON_PRIMARY), false, 'down is down');
    assert.equal(tooOldFromLb(undefined, NON_PRIMARY), false);

    const useHub = read('../hooks/use-hub.tsx');
    assert.match(
        useHub,
        /msg\.t === 'lb'\)[\s\S]{0,900}setStore\(\{ lbTooOld: tooOldFromLb\(msg, useHubStore\.getState\(\)\.user\) \}\)/,
        'the lb frame restates it',
    );
    assert.match(useHub, /lbTooOld: tooOldFromLb\(msg\.lb, welcomeUser\)/, 'and the welcome');
    const lb = read('../../lbbot/hooks/use-lbbot.ts');
    assert.match(lb, /tooOldAfterRefusal\(hub\.lbTooOld, code\)/);
    assert.match(lb, /return useLbBotStatus\(\)\?\.available === true && !refused && !tooOld;/);
    const store = read('../../../store/hub.store.ts');
    assert.match(store, /lbStatus\?\.available === false \|\| lbRefused \|\| lbTooOld/);
    // Main tells the renderer when an answer got through after a too-old refusal.
    const main = read('../../../../main/features/core/lbbot/index.ts');
    assert.match(main, /if \(refusal === 'lbbot_too_old'\) tooOldSeen = true;/);
    assert.match(
        main,
        /if \(tooOldSeen\) \{\s*tooOldSeen = false;\s*getMainWindow\(\)\?\.webContents\.send\('lbbot-refusal', \{ code: LB_ANSWERED \}\);/,
    );
    // M8: the capability line says what it is, not "refused this device".
    const lines = capabilityLines({
        clap: undefined,
        libraryTools: false,
        libraryToolsRefused: false,
        libraryToolsTooOld: true,
        speakers: 0,
        stations: 'stations',
    });
    assert.equal(lines[0].text, 'Library tools: not available to your account on this server');
});

// --- review M6: a demotion while the MBID dialog is open says why -------------------------------

test('the match dialog says an admin is needed when the user is not one', () => {
    const modal = read('../../lbbot/components/mbid-match-modal.tsx');
    assert.match(
        modal,
        /!allows\(roles, 'artistMatch'\)\s*\?\s*'Only an admin of this server can change this\.'/,
    );
});
