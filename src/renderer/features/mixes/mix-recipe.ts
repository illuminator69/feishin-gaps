import type { Mix, MixKind } from '/@/renderer/store/mixes.store';
import type { StationCharacterId } from '/@/shared/types/station-types';

import {
    characterFromAny,
    legacyMoodCharacter,
    toCharacterId,
} from '/@/renderer/features/player/station/station-logic';

// navi-connect "Mixed for You" (B-149, B-151): the form's kinds and their words, the recipe each
// one saves, what a stored recipe plays as, and the seed pickers' search rule. Pure, so
// mix-recipe.harness.ts can replay them; the form, the page and mix-engine.ts only feed them and
// carry out what they answer. The same spec is implemented in Navic, so the two clients offer
// the same kinds in the same order with the same words.

// --- The form's kinds ----------------------------------------------------------------------------

/** What the form offers. Not the wire `kind`: Radio and Your mix are both `station` recipes. */
export type FormKind = 'artist' | 'genre' | 'radio' | 'yourMix';

export interface FormKindRow {
    description: string;
    id: FormKind;
    label: string;
}

/** The line under Your mix, on the form and on the page's always-present Your mix entry. */
export const YOUR_MIX_LINE = 'Built from what you play most';

/**
 * The four kinds, in order. Similar, Adaptive and Sonic fingerprint are not offered any more:
 * with the station engine they are a Balanced radio and Your mix, and "Adaptive" was seeded by
 * whatever happened to be playing. Recipes of those kinds still play (see `mixPlan`).
 */
export const FORM_KINDS: readonly FormKindRow[] = [
    { description: 'Around a song, steered by your skips and likes', id: 'radio', label: 'Radio' },
    { description: YOUR_MIX_LINE, id: 'yourMix', label: 'Your mix' },
    { description: 'A random run through one genre', id: 'genre', label: 'Genre' },
    { description: 'More like one artist', id: 'artist', label: 'Artist' },
];

/**
 * The kinds offered. Your mix is the hub's fingerprint station, which nothing else can build, so
 * it needs the station engine; Radio, Genre and Artist each have a path without it.
 */
export const formKindsFor = (engine: boolean): readonly FormKindRow[] =>
    engine ? FORM_KINDS : FORM_KINDS.filter((row) => row.id !== 'yourMix');

/** A genre run is random, so it has no character; the other three are stations. */
export const formKindTakesCharacter = (kind: FormKind): boolean => kind !== 'genre';

/** The name the form suggests, until the user writes their own. Empty: nothing to suggest yet. */
export const suggestedMixName = (
    kind: FormKind,
    seeds: { artist?: null | string; genre?: null | string; song?: null | string },
): string => {
    switch (kind) {
        case 'artist':
            return seeds.artist ?? '';
        case 'genre':
            return seeds.genre ?? '';
        case 'radio':
            return seeds.song ? `${seeds.song} radio` : '';
        case 'yourMix':
            return 'Your mix';
    }
};

// --- The recipe each kind saves (PROTOCOL §17.1) ------------------------------------------------

export interface MixRecipe {
    /** Absent for a genre run, which has none; the hub then stores none either. */
    character?: StationCharacterId;
    count: number;
    coverArtId: string;
    kind: MixKind;
    /** `character`'s legacy name, for a client from before stations. */
    moodCharacter?: string;
    name: string;
    seedId: string;
    seedName: string;
}

export interface RecipeInput {
    artist: null | { id: string; name: string };
    character: StationCharacterId;
    count: number;
    /** A genre NAME. Navidrome's genre ids are not portable: Navic and `getRandomSongs` take names. */
    genre: null | string;
    kind: FormKind;
    name: string;
    /** The playing song, for Radio. */
    song: null | undefined | { albumId?: string; id: string; name: string };
}

/** The recipe to save, or null while it cannot be: no name, or the kind's seed is missing. */
export const buildRecipe = (input: RecipeInput): MixRecipe | null => {
    const name = input.name.trim();
    if (!name) return null;
    const character = {
        character: input.character,
        moodCharacter: legacyMoodCharacter(input.character),
    };
    const { count } = input;
    switch (input.kind) {
        case 'artist':
            if (!input.artist?.id) return null;
            return {
                ...character,
                count,
                // The seed's artwork (§17.1), stamped once: the artist's own image.
                coverArtId: input.artist.id,
                kind: 'artist',
                name,
                seedId: input.artist.id,
                seedName: input.artist.name,
            };
        case 'genre': {
            const genre = input.genre?.trim();
            if (!genre) return null;
            return { count, coverArtId: '', kind: 'genre', name, seedId: genre, seedName: genre };
        }
        case 'radio':
            if (!input.song?.id) return null;
            return {
                ...character,
                count,
                coverArtId: input.song.albumId ?? '',
                kind: 'station',
                name,
                seedId: input.song.id,
                seedName: input.song.name,
            };
        case 'yourMix':
            return {
                ...character,
                count,
                coverArtId: '',
                kind: 'station',
                name,
                seedId: '',
                seedName: '',
            };
    }
};

// --- What a stored recipe plays as --------------------------------------------------------------

type RecipeFields = Pick<Mix, 'character' | 'kind' | 'moodCharacter' | 'seedId' | 'seedName'>;

/**
 * A recipe's character: its own `character`, else the one its legacy `moodCharacter` names. An
 * unknown value is Balanced, the hub's default: a mix made by a newer client must still play.
 */
export const mixCharacter = (mix: Pick<Mix, 'character' | 'moodCharacter'>): StationCharacterId =>
    characterFromAny(mix.character || mix.moodCharacter);

export interface MixPlan {
    /**
     * The path that runs without the station engine, and when the station starts nothing: a kind
     * of the local engine, never `station`. Null: a kind this build does not know, refused.
     */
    local: Exclude<MixKind, 'station'> | null;
    /** The station to try first. Null without the engine, or for a kind that is not a station. */
    station: null | StationPlan;
}

/** A station to start for a recipe (PROTOCOL §18.1). */
export type StationPlan =
    | { artistId: string; artistName: string; character: StationCharacterId; kind: 'artist' }
    | { character: StationCharacterId; kind: 'track'; songId: string }
    | { character: StationCharacterId; kind: 'yourMix' };

/**
 * Without the engine a radio recipe plays as its nearest old kind: a seeded one as `similar`,
 * Your mix as `fingerprint` (PROTOCOL §18 "Without the engine").
 */
const localKind = (mix: RecipeFields): MixPlan['local'] => {
    switch (mix.kind) {
        case 'adaptive':
        case 'artist':
        case 'fingerprint':
        case 'genre':
        case 'similar':
            return mix.kind;
        case 'station':
            return mix.seedId ? 'similar' : 'fingerprint';
        default:
            return null;
    }
};

/**
 * With the engine (PROTOCOL §17.1): `similar` is a track radio on Balanced; `fingerprint` and
 * `adaptive` are Your mix (adaptive keeping its character, fingerprint the preference unless it
 * stored one); `station` is the radio or Your mix it names; `artist` is an artist radio like the
 * artist-radio entry point's, in the recipe's character. `genre` is a random run either way.
 */
const stationPlan = (mix: RecipeFields, preferred: StationCharacterId): null | StationPlan => {
    switch (mix.kind) {
        case 'adaptive':
            return { character: mixCharacter(mix), kind: 'yourMix' };
        case 'artist':
            return mix.seedId
                ? {
                      artistId: mix.seedId,
                      artistName: mix.seedName,
                      character: mixCharacter(mix),
                      kind: 'artist',
                  }
                : null;
        case 'fingerprint':
            return { character: toCharacterId(mix.character) ?? preferred, kind: 'yourMix' };
        case 'similar':
            return mix.seedId ? { character: 'balanced', kind: 'track', songId: mix.seedId } : null;
        case 'station':
            return mix.seedId
                ? { character: mixCharacter(mix), kind: 'track', songId: mix.seedId }
                : { character: mixCharacter(mix), kind: 'yourMix' };
        default:
            return null;
    }
};

export const mixPlan = (
    mix: RecipeFields,
    context: { engine: boolean; preferred: StationCharacterId },
): MixPlan => {
    const local = localKind(mix);
    return {
        local,
        station: context.engine && local ? stationPlan(mix, context.preferred) : null,
    };
};

/**
 * The genre a `genre` recipe runs through, by NAME. A recipe from before B-151 holds Navidrome's
 * genre id in `seedId` (and, from this client, the name in `seedName`): the id is resolved
 * through the genre list when one is given, else the stored name is used. Empty: nothing to run.
 */
export const genreNameOf = (
    mix: Pick<Mix, 'seedId' | 'seedName'>,
    genres?: null | readonly { id: string; name: string }[],
): string => {
    const byId = mix.seedId ? genres?.find((row) => row.id === mix.seedId)?.name : undefined;
    return (byId || mix.seedName || mix.seedId).trim();
};

// --- The row's words -----------------------------------------------------------------------------

/**
 * The character a recipe stores, read as Navic reads it: its `character`, else its legacy
 * `moodCharacter`, each as an id, a hub MoodCharacter name or this client's old preset id. Null
 * when it stores none (an Artist recipe from before characters), unlike `mixCharacter`, which
 * plays such a recipe on Balanced.
 */
export const storedCharacter = (
    mix: Pick<Mix, 'character' | 'moodCharacter'>,
): null | StationCharacterId => {
    for (const value of [mix.character, mix.moodCharacter]) {
        const id = toCharacterId(value);
        if (id) return id;
        switch (value) {
            case 'Balanced':
            case 'steady':
            case 'SteadyVibes':
                return 'balanced';
            case 'Close':
            case 'echo':
            case 'EchoMatch':
                return 'close';
            case 'Explore':
            case 'transition':
            case 'TransitionMaestro':
                return 'explore';
        }
    }
    return null;
};

type CharacterWords = (id: StationCharacterId) => string;

/** How each kind was built, in a phrase, for a row's second line. */
const KIND_LINE: Record<MixKind, (mix: RecipeFields, words: CharacterWords) => string> = {
    adaptive: (mix, words) => `Adaptive · ${words(mixCharacter(mix))}`,
    // An Artist row names its character as a Radio row does; one that stores none is not given
    // a guessed one (Navic's `mixKindLabel`).
    artist: (mix, words) => {
        const character = storedCharacter(mix);
        const line = `Artist · ${mix.seedName || 'an artist'}`;
        return character ? `${line} · ${words(character)}` : line;
    },
    fingerprint: () => 'Built from your listening',
    genre: (mix) => `Genre · ${genreNameOf(mix) || 'unknown'}`,
    similar: (mix) => `Similar to ${mix.seedName || 'a track'}`,
    station: (mix, words) =>
        mix.seedId
            ? `Radio · ${mix.seedName || 'a track'} · ${words(mixCharacter(mix))}`
            : `Your mix · ${words(mixCharacter(mix))}`,
};

/** A recipe's row line, or null for a kind this build does not know. */
export const mixLine = (mix: RecipeFields, words: CharacterWords): null | string =>
    Object.hasOwn(KIND_LINE, mix.kind) ? KIND_LINE[mix.kind as MixKind](mix, words) : null;

/**
 * The always-present Your mix entry's line, as Navic words it: what it is built from, then the
 * character it plays in, the one autoplay uses.
 */
export const yourMixLine = (characterWords: string): string =>
    `${YOUR_MIX_LINE} · ${characterWords}`;

// --- The seed pickers ---------------------------------------------------------------------------

/** How many options a picker lists at once. */
export const PICKER_LIMIT = 20;
/** How long the artist picker waits after the last keystroke before it asks the server. */
export const PICKER_DEBOUNCE_MS = 250;

/**
 * What a picker searches for: the typed text, or nothing while the box is empty or still shows
 * the pick. Nothing means no list: the dropdown appears only once the user types (B-149; it used
 * to open on the first 500 artists, and a library has thousands).
 */
export const pickerTerm = (typed: string, pickedLabel?: null | string): string => {
    const term = typed.trim();
    if (!term) return '';
    if (pickedLabel && term === pickedLabel.trim()) return '';
    return term;
};

/** A server search's answer as a picker's options: none without a term, at most PICKER_LIMIT. */
export const pickerOptions = <T>(term: string, results: readonly T[]): T[] =>
    term ? results.slice(0, PICKER_LIMIT) : [];

/**
 * What the artist picker's dropdown says when it has no options; null: nothing (no term, so no
 * dropdown, or there are options). A one-letter term is answered with nothing by Navidrome
 * whatever the library holds, so it asks for more rather than calling the library empty.
 */
export const artistPickerEmpty = (state: {
    error: boolean;
    results: number;
    settled: boolean;
    term: string;
}): null | string => {
    if (!state.term || state.results > 0) return null;
    if (!state.settled) return 'Searching...';
    if (state.error) return 'The search did not answer';
    if ([...state.term].length < 2) return 'Keep typing...';
    return 'No artist matches';
};

/**
 * The genre names matching a term, from the whole genre list held locally: the exact name first,
 * then the names it starts, then the rest containing it, each in list order; case-insensitive,
 * each name once, at most PICKER_LIMIT. None without a term.
 */
export const matchGenres = (term: string, genres: readonly { name: string }[]): string[] => {
    const needle = term.trim().toLocaleLowerCase();
    if (!needle) return [];
    const tiers: [string[], string[], string[]] = [[], [], []];
    const seen = new Set<string>();
    for (const row of genres) {
        const name = row.name.trim();
        if (!name || seen.has(name)) continue;
        const folded = name.toLocaleLowerCase();
        const at = folded.indexOf(needle);
        if (at < 0) continue;
        seen.add(name);
        tiers[folded === needle ? 0 : at === 0 ? 1 : 2].push(name);
    }
    return [...tiers[0], ...tiers[1], ...tiers[2]].slice(0, PICKER_LIMIT);
};
