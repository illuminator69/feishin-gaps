import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';

import type { HubUser } from '../../../../shared/utils/hub-signin.ts';

import { isLbRefusal, refusalCode } from '../../../../shared/utils/lbbot-failure.ts';
import { stateAfterRefusal } from '../../../../shared/utils/lbbot-mode.ts';
import { sidebarGroups } from '../../sidebar/utils/sidebar-groups.ts';
import {
    accountChange,
    allows,
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
    assert.match(useHub, /user: parseHubUser\(msg\.user\)/, 'welcome.user is the first value');
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
    // 503 lbbot_too_old: lb-bot is unavailable for this user (refused, like signin_required).
    assert.equal(refusalCode(503, { code: 'lbbot_too_old', error: 'x' }), 'lbbot_too_old');
    assert.equal(stateAfterRefusal({ mode: 'on', refused: false }, 'lbbot_too_old').refused, true);
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
    // Signed in to a hub, the fingerprint never takes the direct AudioMuse route.
    const muse = read('../../../../main/features/core/audiomuse/index.ts');
    assert.match(muse, /if \(!ep\.viaHub && hubAuth\.state\(\)\.signedIn\) return \[\];/);
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
    assert.deepEqual(r.calls, ['signOut', 'clearMirror', 'clearSavedQueues', 'signIn']);
    // Connect off: nothing to sign in to, but the old account's traces still go.
    const off = recorder(false);
    await followAccount('switch', off.deps);
    assert.deepEqual(off.calls, ['signOut', 'clearMirror', 'clearSavedQueues']);

    const useHub = read('../hooks/use-hub.tsx');
    assert.match(
        useHub,
        /useAuthStore\.subscribe\([\s\S]{0,300}accountChange\(\s*prev\.currentServer\?\.id \?\? null,\s*state\.currentServer\?\.id \?\? null,?\s*\)/,
        'every way the current server changes (selector, add, delete, logout) goes through here',
    );
    assert.match(useHub, /signOut: \(\) => signOutOfServer\(\{ reconnect: false \}\)/);
    assert.match(useHub, /signIn: \(\) => signInWithCurrentServer\(\)/);
});

test('logout clears mirror and saved queues', async () => {
    assert.equal(accountChange('server-a', null), 'logout');
    const r = recorder();
    await followAccount('logout', r.deps);
    assert.deepEqual(r.calls, ['signOut', 'clearMirror', 'clearSavedQueues'], 'and no sign-in');
    const none = recorder();
    await followAccount('none', none.deps);
    assert.deepEqual(none.calls, []);
    const useHub = read('../hooks/use-hub.tsx');
    assert.match(useHub, /clearMirror: \(\) => clearIndexMirrorForHubChange\(true\)/);
    assert.match(
        useHub,
        /clearSavedQueues: \(\) => useSavedQueuesStore\.getState\(\)\.actions\.clearAll\(\)/,
    );
    const mirror = read('../../lbbot/index-mirror/index-mirror.ts');
    assert.match(
        mirror,
        /if \(!force && \(!meta\.hubUrl \|\| meta\.hubUrl === currentHubUrl\(\)\)\) return;/,
    );
});
