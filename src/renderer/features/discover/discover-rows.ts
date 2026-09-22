/**
 * navi-connect: the Discover row catalogue.
 *
 * **This table is duplicated in Navic, on purpose, and the ids are the
 * contract.** There is no shared build between the two repos and no codegen, so
 * "shared catalogue" can only ever mean "written twice and kept in sync". The
 * precedent is `MoodCharacter`, and it is a cautionary one: the same three
 * presets live in `auto-dj/audio-muse-source.ts` and in Navic's
 * `MoodCharacter.kt` with matching numbers but different ids and labels, and
 * they have already drifted — Feishin's auto-DJ escalates temperature per pass
 * and Navic's `topUp` does not. Writing the ids down in one place
 * (`navi-connect/CLAUDE.md` §6) is the only thing standing between this table
 * and the same fate.
 *
 * Every row declares the capability it needs, so the screen can answer "is
 * there anything to show" without each row inventing its own empty state. The
 * rule for lb-bot surfaces is stricter than for AudioMuse ones: not configured,
 * unreachable and unindexed all render **nothing**, and the page must look
 * exactly as it does without lb-bot at all.
 */

/** What a row needs in order to have anything to say. */
export type DiscoverCapability =
    /** AudioMuse's CLAP index, probed through `/sonic/clap/stats`. */
    | { kind: 'clap' }
    /** Navidrome alone — always answerable. */
    | { kind: 'lbbot'; route: string }
    /** An lb-bot route, gated on `/lb/status.routes` advertising it. */
    | { kind: 'library' };

export interface DiscoverRowDefinition {
    /** What the row needs before it renders anything. */
    capability: DiscoverCapability;
    id: DiscoverRowId;
    title: string;
}

export type DiscoverRowId = 'fresh' | 'mood' | 'rediscovery' | 'similar-artists';

/**
 * Render order. Leverage first: what is new, then who you are missing, then
 * what you already own and forgot, then a way to ask a question of your own.
 *
 * `stations` is deliberately absent rather than disabled. Persistent named
 * stations were scoped and deferred to a hub-side implementation next to saved
 * queues, and a placeholder entry here would be a row that can never render.
 */
export const DISCOVER_ROWS: DiscoverRowDefinition[] = [
    {
        capability: { kind: 'lbbot', route: 'GET /lb/fresh-releases' },
        id: 'fresh',
        title: 'Fresh releases',
    },
    {
        capability: { kind: 'lbbot', route: 'GET /lb/artist/similar' },
        id: 'similar-artists',
        title: 'Fans also like',
    },
    {
        capability: { kind: 'library' },
        id: 'rediscovery',
        title: 'Rediscover',
    },
    {
        capability: { kind: 'clap' },
        id: 'mood',
        title: 'Search by how it sounds',
    },
];
