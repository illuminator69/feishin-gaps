import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * The Fresh tab's filters, persisted.
 *
 * Someone who only cares about artists they already listen to cares about that
 * every time; re-picking the scope, the window and the sort on every visit is the
 * friction that makes a browse page not worth opening. Nothing here is derived
 * from the data, so a value that no longer matches anything is still a valid
 * choice — the page says "nothing matches" rather than silently resetting.
 */

export type FreshScope = 'all' | 'mine';

export type FreshSort = 'artist' | 'newest';

/** `other` deliberately catches everything untyped: MusicBrainz frequently has no
 *  primary type, and a bucket-per-known-type filter would drop those rows out of
 *  every view at once, which reads as the feed being empty. */
export type FreshType = 'album' | 'all' | 'ep' | 'other' | 'single';

interface FreshFiltersState {
    actions: {
        set: (patch: Partial<Omit<FreshFiltersState, 'actions'>>) => void;
    };
    /** Upstream clamps to 1..90 and only 7/30/90 are offered. */
    days: number;
    scope: FreshScope;
    sort: FreshSort;
    type: FreshType;
}

export const useFreshFiltersStore = create<FreshFiltersState>()(
    persist(
        (set) => ({
            actions: { set: (patch) => set(patch) },
            days: 30,
            scope: 'mine',
            sort: 'newest',
            type: 'all',
        }),
        {
            name: 'store_lbbot_fresh_filters',
            partialize: (state) => ({
                days: state.days,
                scope: state.scope,
                sort: state.sort,
                type: state.type,
            }),
            version: 1,
        },
    ),
);

// Four stable selections, NOT one selector building an object: a selector that
// returns a fresh object every call re-renders on every store read and trips
// zustand's infinite-loop guard. Same rule as the fill ledger next door.
export const useFreshDays = (): number => useFreshFiltersStore((state) => state.days);
export const useFreshScope = (): FreshScope => useFreshFiltersStore((state) => state.scope);
export const useFreshSort = (): FreshSort => useFreshFiltersStore((state) => state.sort);
export const useFreshType = (): FreshType => useFreshFiltersStore((state) => state.type);

export const useFreshFiltersActions = () => useFreshFiltersStore((state) => state.actions);
