/**
 * Which groups and entries the sidebar shows, from the runtime gates and the persisted
 * `sidebarItems`. The expanded sidebar, the collapsed rail and the mobile drawer all render
 * this one model. Pure: no imports, no enum (the harness runs under `node --test`), so the
 * routes arrive as strings and the labels are English defaults the component re-labels by id.
 */

export interface SidebarContext {
    attentionCount: number;
    hasDiscoverSources: boolean;
    hubConnected: boolean;
    lbBotAvailable: boolean;
    libraryItems: { disabled: boolean; id: string; label: string; route: string }[];
    listeningSupported: boolean;
    narrow: boolean;
    overridesSupported: boolean;
    routes: SidebarRoutes;
}

export interface SidebarEntry {
    badge?: number;
    children?: SidebarEntry[];
    id: string;
    label: string;
    route: string;
    /** What marks the entry selected when it differs from `route`; `''` means never. */
    selectedRoute?: string;
}

export interface SidebarGroup {
    entries: SidebarEntry[];
    id: SidebarGroupId;
    label?: string;
}

export type SidebarGroupId = 'app' | 'libraryTools' | 'listening' | 'main' | 'you';

export interface SidebarRoutes {
    activity: string;
    discover: string;
    fresh: string;
    home: string;
    libraryMatches: string;
    listening: string;
    mixes: string;
    savedQueues: string;
    settings: string;
}

// Reached elsewhere: Home and Settings have their own rows, Playlists and Collections their sections.
const NOT_LIBRARY_CHILDREN = new Set(['Collections', 'Home', 'Playlists', 'Settings']);

const libraryChildren = (ctx: SidebarContext): SidebarEntry[] => {
    const children: SidebarEntry[] = [];
    const seen = new Set<string>();
    const add = (entry: SidebarEntry) => {
        if (seen.has(entry.id)) return;
        seen.add(entry.id);
        children.push(entry);
    };
    for (const item of ctx.libraryItems) {
        if (item.disabled || !item.route || NOT_LIBRARY_CHILDREN.has(item.id)) continue;
        add({ id: item.id, label: item.label, route: item.route });
    }
    if (ctx.hasDiscoverSources)
        add({ id: 'Discover', label: 'Discover', route: ctx.routes.discover });
    if (ctx.hubConnected) add({ id: 'Mixes', label: 'Mixed for You', route: ctx.routes.mixes });
    return children;
};

export const sidebarGroups = (
    ctx: SidebarContext,
): { groups: SidebarGroup[]; more: SidebarEntry[] } => {
    const { routes } = ctx;
    const lb = ctx.lbBotAvailable;

    const main: SidebarEntry[] = [
        { id: 'home', label: 'Home', route: routes.home },
        { children: libraryChildren(ctx), id: 'library', label: 'Library', route: '' },
    ];
    if (lb) main.push({ id: 'fresh', label: 'Fresh', route: routes.fresh });

    const you: SidebarEntry[] = lb
        ? [
              {
                  id: 'needsAttention',
                  label: 'Needs attention',
                  route: routes.activity,
                  selectedRoute: '',
                  ...(ctx.attentionCount > 0 ? { badge: ctx.attentionCount } : {}),
              },
              { id: 'activity', label: 'Activity', route: routes.activity },
          ]
        : [];

    const listening: SidebarEntry[] = [];
    if (ctx.listeningSupported) {
        listening.push({ id: 'statistics', label: 'Statistics', route: routes.listening });
    }
    listening.push({ id: 'savedQueues', label: 'Saved queues', route: routes.savedQueues });

    const libraryTools: SidebarEntry[] =
        lb && ctx.overridesSupported
            ? [{ id: 'libraryMatches', label: 'Library Matches', route: routes.libraryMatches }]
            : [];

    const app: SidebarEntry[] = [{ id: 'settings', label: 'Settings', route: routes.settings }];

    const upper: SidebarGroup[] = [
        { entries: main, id: 'main' },
        { entries: you, id: 'you', label: 'You' },
    ];
    const lower: SidebarGroup[] = [
        { entries: listening, id: 'listening', label: 'Listening' },
        { entries: libraryTools, id: 'libraryTools', label: 'Library tools' },
        { entries: app, id: 'app', label: 'App' },
    ];
    const present = (groups: SidebarGroup[]) => groups.filter((g) => g.entries.length > 0);

    if (ctx.narrow) {
        return { groups: present(upper), more: lower.flatMap((g) => g.entries) };
    }
    return { groups: present([...upper, ...lower]), more: [] };
};

/** Settled fills the user has to act on: failed, or waiting for a pick. */
export const attentionCount = (rows: readonly { outcome: string; settled: boolean }[]): number =>
    rows.filter((r) => r.settled && (r.outcome === 'failed' || r.outcome === 'needsPick')).length;
