import type { ReleaseKind } from './release-kind.ts';

import { type DiscographyItem, sortItems } from './discography-model.ts';
import { DEFAULT_VIEW } from './discography-view.ts';

/**
 * The artist page's short shape: a "Popular releases" line and one line per release kind, picked
 * from the discography model's items. Popular releases is Navic's rule translated to this model.
 *
 * Pure: plain data in, plain data out; nothing from `/@/`.
 */

export interface KindLine {
    items: DiscographyItem[];
    kind: ReleaseKind;
    /** True when the kind has more releases than the line shows ("See all"). */
    more: boolean;
    total: number;
}

const isOwned = (item: DiscographyItem) =>
    item.ownership === 'owned' || item.ownership === 'partly';

/** The default discography view's order, so every line agrees with the page's full list. */
const inDefaultOrder = (items: DiscographyItem[]) => sortItems(items, DEFAULT_VIEW);

/**
 * What the artist is known for here: owned and partly owned releases by plays (ties newest year
 * first, no year last), then releases still syncing newest first, then missing albums (not EPs or
 * other kinds) newest first. Distinct by key, at most `limit`.
 */
export const popularReleases = (items: DiscographyItem[], limit: number): DiscographyItem[] => {
    const ordered = inDefaultOrder(items);
    // Array.prototype.sort is stable, so the default order (newest year first) breaks plays ties.
    const owned = ordered.filter(isOwned).sort((a, b) => b.plays - a.plays);
    const syncing = ordered.filter((item) => item.ownership === 'syncing');
    const missing = ordered.filter((item) => item.ownership === 'missing' && item.kind === 'album');
    const seen = new Set<string>();
    const picked: DiscographyItem[] = [];
    for (const item of [...owned, ...syncing, ...missing]) {
        if (picked.length >= limit) break;
        if (seen.has(item.key)) continue;
        seen.add(item.key);
        picked.push(item);
    }
    return picked;
};

/**
 * One line per kind in `order`, skipping hidden kinds and kinds with no releases. A line takes the
 * kind's releases in the default discography view's order; it may repeat a release that Popular
 * releases shows.
 */
export const kindLines = (
    items: DiscographyItem[],
    order: ReleaseKind[],
    hidden: ReadonlySet<ReleaseKind>,
    limit: number,
): KindLine[] => {
    const ordered = inDefaultOrder(items);
    const lines: KindLine[] = [];
    for (const kind of order) {
        if (hidden.has(kind)) continue;
        const ofKind = ordered.filter((item) => item.kind === kind);
        if (ofKind.length === 0) continue;
        lines.push({
            items: ofKind.slice(0, limit),
            kind,
            more: ofKind.length > limit,
            total: ofKind.length,
        });
    }
    return lines;
};

/** Album ids of the owned and partly owned releases, in the default discography view's order. */
export const ownedPlayIds = (items: DiscographyItem[]): string[] =>
    inDefaultOrder(items).flatMap((item) =>
        isOwned(item) && item.albumId !== null ? [item.albumId] : [],
    );
