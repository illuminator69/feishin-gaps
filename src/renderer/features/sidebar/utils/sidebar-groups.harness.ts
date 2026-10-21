import assert from 'node:assert/strict';
import test from 'node:test';

import type { SidebarContext, SidebarEntry, SidebarGroup } from './sidebar-groups.ts';

import { attentionCount, sidebarGroups } from './sidebar-groups.ts';

/**
 * F3:  node --test src/renderer/features/sidebar/utils/sidebar-groups.harness.ts
 *
 * Which groups and entries the sidebar, the collapsed rail and the mobile drawer show, from the
 * gates and the persisted `sidebarItems`. Ids, order, badges and routes only: labels are
 * translated by the component.
 */

const routes = {
    activity: '/downloads',
    discover: '/explore',
    fresh: '/fresh',
    home: '/',
    libraryMatches: '/library-matches',
    listening: '/listening',
    mixes: '/mixes',
    savedQueues: '/saved-queues',
    settings: '/settings',
};

// The persisted defaults' shape: Now Playing, Search, Playlists and Settings start disabled.
const storedItems = () => [
    { disabled: true, id: 'Now Playing', label: 'Now Playing', route: '/now-playing' },
    { disabled: true, id: 'Search', label: 'Search', route: '/search/songs' },
    { disabled: false, id: 'Home', label: 'Home', route: '/' },
    { disabled: false, id: 'Favorites', label: 'Favorites', route: '/favorites' },
    { disabled: false, id: 'Albums', label: 'Albums', route: '/library/albums' },
    { disabled: false, id: 'Tracks', label: 'Tracks', route: '/library/songs' },
    { disabled: false, id: 'Artists', label: 'Album Artists', route: '/library/album-artists' },
    { disabled: false, id: 'Artists-all', label: 'Artists', route: '/library/artists' },
    { disabled: false, id: 'Genres', label: 'Genres', route: '/library/genres' },
    { disabled: false, id: 'Folders', label: 'Folders', route: '/library/folders' },
    { disabled: true, id: 'Playlists', label: 'Playlists', route: '/playlists' },
    { disabled: false, id: 'Collections', label: 'Collections', route: '' },
    { disabled: false, id: 'Radio', label: 'Radio', route: '/library/radio' },
    { disabled: true, id: 'Settings', label: 'Settings', route: '/settings' },
];

const ctx = (patch: Partial<SidebarContext> = {}): SidebarContext => ({
    attentionCount: 0,
    hasDiscoverSources: false,
    hubConnected: false,
    lbBotAvailable: false,
    libraryItems: storedItems(),
    listeningSupported: false,
    narrow: false,
    overridesSupported: false,
    routes,
    ...patch,
});

const ids = (entries: SidebarEntry[]) => entries.map((e) => e.id);
const group = (groups: SidebarGroup[], id: string) => groups.find((g) => g.id === id);
const shape = (groups: SidebarGroup[]) =>
    groups.map((g) => `${g.id}: ${ids(g.entries).join(', ')}`);
const libraryChildren = (groups: SidebarGroup[]) =>
    ids(group(groups, 'main')!.entries.find((e) => e.id === 'library')!.children!);

const everyGate = (patch: Partial<SidebarContext> = {}) =>
    ctx({
        hasDiscoverSources: true,
        hubConnected: true,
        lbBotAvailable: true,
        listeningSupported: true,
        overridesSupported: true,
        ...patch,
    });

test('noLbBotLeavesHomeLibrarySavedQueuesAndSettings', () => {
    const { groups, more } = sidebarGroups(ctx());
    assert.deepEqual(shape(groups), [
        'main: home, library',
        'listening: savedQueues',
        'app: settings',
    ]);
    assert.deepEqual(more, []);
    const main = group(groups, 'main')!.entries;
    assert.equal(main[0].route, '/');
    assert.equal(main[1].route, '');
    assert.equal(group(groups, 'listening')!.entries[0].route, '/saved-queues');
    assert.equal(group(groups, 'app')!.entries[0].route, '/settings');
});

test('lbBotAddsFreshNeedsAttentionActivity', () => {
    const { groups } = sidebarGroups(ctx({ lbBotAvailable: true }));
    assert.deepEqual(shape(groups), [
        'main: home, library, fresh',
        'you: needsAttention, activity',
        'listening: savedQueues',
        'app: settings',
    ]);
    const you = group(groups, 'you')!;
    assert.equal(you.label, 'You');
    const [attention, activity] = you.entries;
    assert.equal(attention.route, '/downloads');
    assert.equal(attention.selectedRoute, '');
    assert.equal(activity.route, '/downloads');
    assert.equal(activity.selectedRoute, undefined);
    assert.equal(group(groups, 'main')!.entries[2].route, '/fresh');
});

test('theBadgeAppearsOnlyAboveZero', () => {
    const none = group(sidebarGroups(ctx({ lbBotAvailable: true })).groups, 'you')!;
    assert.equal(none.entries[0].badge, undefined);
    assert.equal('badge' in none.entries[0], false);
    const two = group(
        sidebarGroups(ctx({ attentionCount: 2, lbBotAvailable: true })).groups,
        'you',
    )!;
    assert.equal(two.entries[0].badge, 2);
    assert.equal(two.entries[1].badge, undefined);
    // Without lb-bot there is no row to carry it, whatever the count says.
    assert.equal(group(sidebarGroups(ctx({ attentionCount: 3 })).groups, 'you'), undefined);
});

test('listeningUnsupportedDropsStatistics', () => {
    const on = sidebarGroups(ctx({ lbBotAvailable: true, listeningSupported: true })).groups;
    assert.deepEqual(ids(group(on, 'listening')!.entries), ['statistics', 'savedQueues']);
    assert.equal(group(on, 'listening')!.entries[0].route, '/listening');
    const off = sidebarGroups(ctx({ lbBotAvailable: true, listeningSupported: false })).groups;
    assert.deepEqual(ids(group(off, 'listening')!.entries), ['savedQueues']);
});

test('libraryToolsNeedOverrides', () => {
    assert.equal(
        group(sidebarGroups(ctx({ lbBotAvailable: true })).groups, 'libraryTools'),
        undefined,
    );
    assert.equal(
        group(sidebarGroups(ctx({ overridesSupported: true })).groups, 'libraryTools'),
        undefined,
    );
    const tools = group(
        sidebarGroups(ctx({ lbBotAvailable: true, overridesSupported: true })).groups,
        'libraryTools',
    )!;
    assert.deepEqual(ids(tools.entries), ['libraryMatches']);
    assert.equal(tools.entries[0].route, '/library-matches');
    assert.equal(tools.label, 'Library tools');
});

test('groupsComeInTheBoardOrder', () => {
    assert.deepEqual(
        sidebarGroups(everyGate()).groups.map((g) => g.id),
        ['main', 'you', 'listening', 'libraryTools', 'app'],
    );
});

test('libraryChildrenFollowTheEnabledItemsInOrder', () => {
    assert.deepEqual(libraryChildren(sidebarGroups(ctx()).groups), [
        'Favorites',
        'Albums',
        'Tracks',
        'Artists',
        'Artists-all',
        'Genres',
        'Folders',
        'Radio',
    ]);
    const reordered = storedItems().reverse();
    reordered.find((i) => i.id === 'Search')!.disabled = false;
    const children = group(sidebarGroups(ctx({ libraryItems: reordered })).groups, 'main')!
        .entries[1].children!;
    assert.deepEqual(ids(children), [
        'Radio',
        'Folders',
        'Genres',
        'Artists-all',
        'Artists',
        'Tracks',
        'Albums',
        'Favorites',
        'Search',
    ]);
    assert.equal(children[0].route, '/library/radio');
});

test('libraryChildrenSkipHomeSettingsPlaylistsCollections', () => {
    const allEnabled = storedItems().map((i) => ({ ...i, disabled: false }));
    const children = libraryChildren(sidebarGroups(ctx({ libraryItems: allEnabled })).groups);
    for (const id of ['Home', 'Settings', 'Playlists', 'Collections']) {
        assert.equal(children.includes(id), false, id);
    }
    assert.deepEqual(children.slice(0, 2), ['Now Playing', 'Search']);
});

test('aRoutelessItemIsNotAChild', () => {
    const items = [
        ...storedItems(),
        { disabled: false, id: 'SomethingNew', label: 'Something new', route: '' },
    ];
    assert.equal(
        libraryChildren(sidebarGroups(ctx({ libraryItems: items })).groups).includes(
            'SomethingNew',
        ),
        false,
    );
});

test('libraryChildrenDedupeById', () => {
    // Arrays merge by index, so a stored list shorter than the defaults can repeat a tail item.
    const items = [
        ...storedItems(),
        { disabled: false, id: 'Albums', label: 'Albums again', route: '/library/albums?dup' },
    ];
    const children = group(sidebarGroups(ctx({ libraryItems: items })).groups, 'main')!.entries[1]
        .children!;
    assert.equal(ids(children).filter((id) => id === 'Albums').length, 1);
    assert.equal(children.find((c) => c.id === 'Albums')!.route, '/library/albums');
});

test('discoverAndMixesAreAppended', () => {
    const both = libraryChildren(
        sidebarGroups(ctx({ hasDiscoverSources: true, hubConnected: true })).groups,
    );
    assert.deepEqual(both.slice(-2), ['Discover', 'Mixes']);
    assert.equal(both.length, 10);
    const children = group(
        sidebarGroups(ctx({ hasDiscoverSources: true, hubConnected: true })).groups,
        'main',
    )!.entries[1].children!;
    assert.equal(children.at(-2)!.route, '/explore');
    assert.equal(children.at(-1)!.route, '/mixes');
    assert.deepEqual(libraryChildren(sidebarGroups(ctx({ hubConnected: true })).groups).slice(-1), [
        'Mixes',
    ]);
    assert.deepEqual(
        libraryChildren(sidebarGroups(ctx({ hasDiscoverSources: true })).groups).slice(-1),
        ['Discover'],
    );
    // A stored item that happens to carry the same id is not shown twice.
    const stored = [
        ...storedItems(),
        { disabled: false, id: 'Discover', label: 'Discover', route: '/explore' },
    ];
    const deduped = libraryChildren(
        sidebarGroups(ctx({ hasDiscoverSources: true, libraryItems: stored })).groups,
    );
    assert.equal(deduped.filter((id) => id === 'Discover').length, 1);
});

test('narrowFoldsTheLowerGroupsIntoMore', () => {
    const { groups, more } = sidebarGroups(everyGate({ narrow: true }));
    assert.deepEqual(
        groups.map((g) => g.id),
        ['main', 'you'],
    );
    assert.deepEqual(ids(more), ['statistics', 'savedQueues', 'libraryMatches', 'settings']);
    const wide = sidebarGroups(everyGate());
    assert.deepEqual(wide.more, []);
    // Without lb-bot the fold still holds Saved queues and Settings.
    const bare = sidebarGroups(ctx({ narrow: true }));
    assert.deepEqual(
        bare.groups.map((g) => g.id),
        ['main'],
    );
    assert.deepEqual(ids(bare.more), ['savedQueues', 'settings']);
});

test('settingsIsInTheAppGroupEvenIfTheStoredItemIsDisabled', () => {
    const items = storedItems();
    assert.equal(items.find((i) => i.id === 'Settings')!.disabled, true);
    const app = group(sidebarGroups(ctx({ libraryItems: items })).groups, 'app')!;
    assert.deepEqual(ids(app.entries), ['settings']);
    assert.equal(app.label, 'App');
    // And with no stored list at all.
    assert.deepEqual(ids(group(sidebarGroups(ctx({ libraryItems: [] })).groups, 'app')!.entries), [
        'settings',
    ]);
});

test('nothingIsDroppedFromTheOldList', () => {
    const items = storedItems().map((i, n) => ({ ...i, disabled: n % 3 === 0 }));
    const expected = items
        .filter(
            (i) =>
                !i.disabled &&
                i.route &&
                !['Collections', 'Home', 'Playlists', 'Settings'].includes(i.id),
        )
        .map((i) => i.id);
    const children = libraryChildren(sidebarGroups(ctx({ libraryItems: items })).groups);
    for (const id of expected) {
        assert.equal(children.filter((c) => c === id).length, 1, id);
    }
    assert.equal(children.length, expected.length);
});

test('attentionCountIgnoresGaveUpCancelledAndRunning', () => {
    assert.equal(
        attentionCount([
            { outcome: 'failed', settled: true },
            { outcome: 'needsPick', settled: true },
            { outcome: 'gaveUp', settled: true },
            { outcome: 'cancelled', settled: true },
            { outcome: 'failed', settled: false },
        ]),
        2,
    );
    assert.equal(attentionCount([{ outcome: 'running', settled: false }]), 0);
    assert.equal(attentionCount([{ outcome: 'done', settled: true }]), 0);
    assert.equal(attentionCount([]), 0);
});
