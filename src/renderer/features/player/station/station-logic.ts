import type {
    StationAnswer,
    StationCatalog,
    StationCharacter,
    StationCharacterId,
    StationEngine,
    StationNextBody,
    StationResult,
    StationSeed,
    StationStartBody,
} from '/@/shared/types/station-types';

// navi-connect stations (I-040, PROTOCOL §18): the decisions, with no React, store, IPC or clock,
// so they can be replayed in station-logic.harness.ts. The hook (use-station-autoplay.ts) and the
// store (station-store.ts) only feed them and carry out what they answer.
//
// What the hub owns and what this client owns. The hub keeps each station: its seed, its
// character, what it served, what was skipped and liked, and `seq`, the count of tracks it has
// served, which is also the cursor every device continues from. This client keeps which station
// the queue it is listening to belongs to (`StationBinding`), asks for the next few tracks when
// the queue is about to run out, and puts the answer into the queue. A queue that was not built
// by a station (an album, a playlist, a Journey) continues as one when it runs out: the last
// tracks played become the seed.

/** Top up when fewer than this many tracks remain after the current one, in play order. */
export const LOOKAHEAD_MIN = 2;
/** How many tracks a top-up asks for. Short on purpose: skips steer the next batch. */
export const NEXT_COUNT = 5;
/** A radio's first batch, after its seed track(s). */
export const START_COUNT = 20;
/** The hub's limit on `exclude`. */
export const EXCLUDE_MAX = 1000;
/** The hub's limit on a `tracks` seed. */
export const SEED_TRACKS_MAX = 5;
/** How many of the last tracks played seed the station a queue continues as. */
export const CONTINUE_SEED_MAX = 3;
/** How long a local change of binding outranks a `session` frame that disagrees with it. */
export const LOCAL_BINDING_HOLD_MS = 5000;
/** How long an armed binding waits for the queue it belongs to. */
export const ARM_TTL_MS = 30_000;
/**
 * After another device served this station (a `station` frame, or `servedElsewhere`), its batch
 * is still on its way into the session queue. Asking with the new `seq` meanwhile would compute
 * a second batch, so this client waits this long before asking again.
 */
export const SERVED_ELSEWHERE_GRACE_MS = 8000;
/** Retries of one trigger after a partial or failed answer, before waiting for the next. */
export const RETRY_MAX = 3;
export const RETRY_DELAY_MS = 8000;

export const CHARACTER_IDS: readonly StationCharacterId[] = ['close', 'balanced', 'explore'];

/**
 * The hub's catalogue as PROTOCOL §18.1 states it, for when it cannot be asked. The probe's own
 * answer always wins: both clients render the hub's words, so the two cannot drift again.
 */
export const BUNDLED_CHARACTERS: readonly StationCharacter[] = [
    {
        description: 'Stays right next to what you started with.',
        id: 'close',
        label: 'Close',
        legacy: 'EchoMatch',
    },
    {
        description: 'Near what you started with, with room to move.',
        id: 'balanced',
        label: 'Balanced',
        legacy: 'SteadyVibes',
    },
    {
        description: 'Wanders further, steered by what you skip and like.',
        id: 'explore',
        label: 'Explore',
        legacy: 'TransitionMaestro',
    },
];

export const toCharacterId = (value: unknown): null | StationCharacterId =>
    CHARACTER_IDS.includes(value as StationCharacterId) ? (value as StationCharacterId) : null;

/**
 * A character from anything that may have stored one: a new id, the hub's legacy MoodCharacter
 * name, or Feishin's own old preset id. Anything else is Balanced, the hub's default.
 */
export const characterFromAny = (value: unknown): StationCharacterId => {
    const id = toCharacterId(value);
    if (id) return id;
    switch (value) {
        case 'echo':
        case 'EchoMatch':
            return 'close';
        case 'transition':
        case 'TransitionMaestro':
            return 'explore';
        default:
            return 'balanced';
    }
};

/** The legacy MoodCharacter name a mix record keeps beside `character` (PROTOCOL §17.1). */
export const legacyMoodCharacter = (character: StationCharacterId): string => {
    switch (character) {
        case 'close':
            return 'EchoMatch';
        case 'explore':
            return 'TransitionMaestro';
        default:
            return 'SteadyVibes';
    }
};

/** The characters to render: the hub's, or the bundled copy when it has given none. */
export const charactersOf = (catalog: null | StationCatalog): readonly StationCharacter[] =>
    catalog && catalog.characters.length > 0 ? catalog.characters : BUNDLED_CHARACTERS;

export const characterLabel = (
    catalog: null | StationCatalog,
    character: StationCharacterId,
): string =>
    charactersOf(catalog).find((row) => row.id === character)?.label ??
    BUNDLED_CHARACTERS.find((row) => row.id === character)!.label;

// --- Which path runs ---------------------------------------------------------------------------

/**
 * `stations`: the hub's engine. `fallback`: upstream's Auto DJ (no hub, no `station` feature, a
 * probe that answered unavailable, or a `start` that answered 503). `pending`: the hub has the
 * feature and this connection's probe has not answered yet, so neither runs for that moment.
 */
export type StationMode = 'fallback' | 'pending' | 'stations';

export const stationMode = (args: {
    /** This connection's probe answered `available: true`. */
    available: boolean;
    connected: boolean;
    fallbackLatched: boolean;
    hasFeature: boolean;
    probed: boolean;
}): StationMode => {
    if (!args.connected || !args.hasFeature) return 'fallback';
    if (args.fallbackLatched) return 'fallback';
    if (!args.probed) return 'pending';
    return args.available ? 'stations' : 'fallback';
};

// --- Play order ---------------------------------------------------------------------------------

/**
 * Tracks left after the current one in PLAY order, for this client's own player. Feishin's
 * `player.index` is a position in the shuffled order while shuffle is on, so this is the same
 * arithmetic either way.
 */
export const remainingLocal = (playIndex: number, length: number): number =>
    Math.max(0, length - playIndex - 1);

/**
 * The same for the hub's session, whose `index` is a queue index and whose `order` (when shuffle
 * is on) lists queue indexes in play order. An `order` that does not cover the queue is ignored:
 * the hub rebuilds it on the next frame, and counting by queue order meanwhile errs late, not
 * twice.
 */
export const remainingRemote = (
    index: number,
    length: number,
    order: null | readonly number[] | undefined,
): number => {
    if (order && order.length === length) {
        const position = order.indexOf(index);
        if (position >= 0) return Math.max(0, order.length - position - 1);
    }
    return Math.max(0, length - index - 1);
};

/** Queue ids in play order, for a session described by queue index + optional `order`. */
export const idsInPlayOrder = (
    ids: readonly string[],
    order: null | readonly number[] | undefined,
): string[] => (order && order.length === ids.length ? order.map((index) => ids[index]) : [...ids]);

/**
 * The seed a queue that ran out continues from: the current track and up to two before it in
 * play order (they are the tracks just played), oldest first, without repeats.
 */
export const continueSeedIds = (
    playOrderIds: readonly string[],
    playPosition: number,
): string[] => {
    const from = Math.max(0, playPosition - (CONTINUE_SEED_MAX - 1));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of playOrderIds.slice(from, playPosition + 1)) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
    }
    return out;
};

/** At most `max` items spread evenly over a list, first and last included. */
export const spreadPick = <T>(items: readonly T[], max: number = SEED_TRACKS_MAX): T[] => {
    if (items.length <= max) return [...items];
    if (max <= 1) return items.slice(0, 1);
    const step = (items.length - 1) / (max - 1);
    return Array.from({ length: max }, (_, i) => items[Math.round(i * step)]);
};

/** What is queued, for `exclude`: the newest EXCLUDE_MAX distinct ids. */
export const excludeIds = (ids: readonly string[]): string[] => {
    const distinct = [...new Set(ids.filter(Boolean))];
    return distinct.length > EXCLUDE_MAX ? distinct.slice(-EXCLUDE_MAX) : distinct;
};

// --- The binding: which station the listened queue belongs to -----------------------------------

export interface StationBinding {
    character: StationCharacterId;
    engine: null | StationEngine;
    exhausted: boolean;
    /** The hub's name for it ("Cinnamon Girl radio", "Your mix"); empty when not yet told. */
    name: string;
    rev: number;
    /** Kept so an expired station (404 station_unknown) can be started again once. */
    seed: null | StationSeed;
    /** The `seq` this client last applied or learned: the `after` of its next `next`. */
    seq: number;
    stationId: string;
}

/** A `station` frame or `welcome.station`, read defensively. Null when it names no station. */
export interface StationCursor {
    character: null | StationCharacterId;
    exhausted: boolean;
    name?: string;
    rev: number;
    seed?: null | StationSeed;
    seq: number;
    stationId: string;
}

const asSeed = (value: unknown): null | StationSeed => {
    if (!value || typeof value !== 'object') return null;
    const seed = value as { ids?: unknown; kind?: unknown; name?: unknown };
    const name = typeof seed.name === 'string' && seed.name ? seed.name : undefined;
    if (seed.kind === 'yourMix') return { kind: 'yourMix', name };
    const ids = Array.isArray(seed.ids)
        ? seed.ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
    if (ids.length === 0) return null;
    if (seed.kind === 'track') return { ids: ids.slice(0, 1), kind: 'track', name };
    if (seed.kind === 'tracks') return { ids: ids.slice(0, SEED_TRACKS_MAX), kind: 'tracks', name };
    return null;
};

export const parseStationCursor = (value: unknown): null | StationCursor => {
    if (!value || typeof value !== 'object') return null;
    const frame = value as Record<string, unknown>;
    if (typeof frame.stationId !== 'string' || !frame.stationId) return null;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return {
        character: toCharacterId(frame.character),
        exhausted: frame.exhausted === true,
        ...(typeof frame.name === 'string' ? { name: frame.name } : {}),
        ...('seed' in frame ? { seed: asSeed(frame.seed) } : {}),
        rev: num(frame.rev),
        seq: num(frame.seq),
        stationId: frame.stationId,
    };
};

/** A binding from a cursor, keeping what the cursor does not carry from `known`. */
export const bindingFromCursor = (
    cursor: StationCursor,
    known: null | StationBinding,
): StationBinding => {
    const same = known && known.stationId === cursor.stationId ? known : null;
    return {
        character: cursor.character ?? same?.character ?? 'balanced',
        engine: same?.engine ?? null,
        exhausted: cursor.exhausted,
        name: cursor.name ?? same?.name ?? '',
        rev: cursor.rev,
        seed: cursor.seed !== undefined ? cursor.seed : (same?.seed ?? null),
        // A cursor never moves a binding backwards: a frame that left before this client's own
        // last batch was applied carries a smaller seq.
        seq: Math.max(cursor.seq, same?.seq ?? 0),
        stationId: cursor.stationId,
    };
};

/** A binding from a `start` answer. */
export const bindingFromAnswer = (answer: StationAnswer): StationBinding => ({
    character: answer.character,
    engine: answer.engine,
    exhausted: answer.exhausted,
    name: answer.name,
    rev: answer.rev,
    seed: answer.seed,
    seq: answer.seq,
    stationId: answer.stationId,
});

/** A `next` answer applied to the binding it was asked for. Other stations are left alone. */
export const applyNextAnswer = (
    bound: null | StationBinding,
    answer: StationAnswer,
): null | StationBinding => {
    if (!bound || bound.stationId !== answer.stationId) return bound;
    return {
        ...bound,
        character: answer.character,
        engine: answer.engine ?? bound.engine,
        exhausted: answer.servedElsewhere ? bound.exhausted : answer.exhausted,
        rev: Math.max(bound.rev, answer.rev),
        seq: Math.max(bound.seq, answer.seq),
    };
};

/** A `station` frame applied: only the bound station's cursor moves. */
export const applyStationFrame = (
    bound: null | StationBinding,
    cursor: StationCursor,
): null | StationBinding =>
    bound && bound.stationId === cursor.stationId ? bindingFromCursor(cursor, bound) : bound;

/**
 * `session.stationId` (or `welcome`'s) arriving. The hub's session is the authority on which
 * station the live queue belongs to, with one exception: right after this client changed the
 * binding itself (it started a radio, or began a queue that is not one), the frames still in
 * flight describe the queue before that change, so for LOCAL_BINDING_HOLD_MS a disagreeing frame
 * is ignored. A frame that agrees ends the hold early. `undefined` is a hub that does not speak
 * stations: nothing changes.
 */
export const applySessionStationId = (args: {
    bound: null | StationBinding;
    /** Cursors this client has heard for stations, by id: a newly bound one starts from them. */
    cursors: Readonly<Record<string, StationCursor>>;
    incoming: unknown;
    localUntil: number;
    now: number;
}): { bound: null | StationBinding; localUntil: number } => {
    const { bound, cursors, incoming, localUntil, now } = args;
    if (incoming === undefined) return { bound, localUntil };
    const id = typeof incoming === 'string' && incoming ? incoming : null;
    if ((bound?.stationId ?? null) === id) return { bound, localUntil: 0 };
    if (now < localUntil) return { bound, localUntil };
    if (id === null) return { bound: null, localUntil: 0 };
    const cursor = cursors[id];
    return {
        bound: cursor
            ? bindingFromCursor(cursor, null)
            : {
                  character: 'balanced',
                  engine: null,
                  exhausted: false,
                  name: '',
                  rev: 0,
                  seed: null,
                  seq: 0,
                  stationId: id,
              },
        localUntil: 0,
    };
};

// --- The autoplay decision ---------------------------------------------------------------------

export type AutoplayDecision =
    | { body: StationNextBody; kind: 'next' }
    | { body: StationStartBody; kind: 'start' }
    | { kind: 'wait'; reason: AutoplayWait };

export interface AutoplayInput {
    /** The station the listened queue belongs to, if any. */
    bound: null | StationBinding;
    deviceId?: string;
    /** Whether this client drives the queue it is looking at: it plays it, or it controls another
     *  device that does. */
    driving: boolean;
    /** Another device served the bound station less than SERVED_ELSEWHERE_GRACE_MS ago. */
    elsewhereRecent?: boolean;
    enabled: boolean;
    /** A request of this client's is already out. */
    inFlight: boolean;
    isPlaying: boolean;
    mode: StationMode;
    /** Queue ids, any order: what `exclude` carries. */
    queueIds: readonly string[];
    remaining: number;
    /** The hub session's saved-queue id, which `bindSession` names. */
    savedQueueId: null | string;
    /** The last tracks played, for a queue that is not a station's (continueSeedIds). */
    seedIds: readonly string[];
}

export type AutoplayWait =
    | 'enough'
    | 'exhausted'
    | 'in-flight'
    | 'no-seed'
    | 'not-driving'
    | 'not-playing'
    | 'off'
    | 'served-elsewhere'
    | 'unavailable';

export const decideAutoplay = (
    input: AutoplayInput,
    character: StationCharacterId,
): AutoplayDecision => {
    if (!input.enabled) return { kind: 'wait', reason: 'off' };
    if (input.mode !== 'stations') return { kind: 'wait', reason: 'unavailable' };
    if (!input.driving) return { kind: 'wait', reason: 'not-driving' };
    if (!input.isPlaying) return { kind: 'wait', reason: 'not-playing' };
    if (input.remaining >= LOOKAHEAD_MIN) return { kind: 'wait', reason: 'enough' };
    if (input.inFlight) return { kind: 'wait', reason: 'in-flight' };
    const exclude = excludeIds(input.queueIds);
    const deviceId = input.deviceId ? { deviceId: input.deviceId } : {};
    if (input.bound) {
        // An answer, not a failure: the station has nothing left that fits. Autoplay stops here
        // until a like or a character change moves its rev and the hub clears it.
        if (input.bound.exhausted) return { kind: 'wait', reason: 'exhausted' };
        if (input.elsewhereRecent) return { kind: 'wait', reason: 'served-elsewhere' };
        return {
            body: {
                after: input.bound.seq,
                count: NEXT_COUNT,
                exclude,
                stationId: input.bound.stationId,
                ...deviceId,
            },
            kind: 'next',
        };
    }
    if (input.seedIds.length === 0) return { kind: 'wait', reason: 'no-seed' };
    return {
        body: {
            ...(input.savedQueueId ? { bindSession: input.savedQueueId } : {}),
            character,
            count: NEXT_COUNT,
            exclude,
            seed: { ids: input.seedIds.slice(-CONTINUE_SEED_MAX), kind: 'tracks' },
            ...deviceId,
        },
        kind: 'start',
    };
};

// --- What an answer means ---------------------------------------------------------------------

export type AnswerOutcome =
    /** Put these tracks at the end of the queue; the binding becomes `binding`. */
    | { binding: StationBinding; kind: 'adopt'; recheck: boolean; servedElsewhere: boolean }
    /** Nothing to add, by design: exhausted, or another device served this batch. */
    | { binding: StationBinding; kind: 'append'; partial: boolean; tracks: StationAnswer['tracks'] }
    /** `start` found the session already bound (409): continue that station with `next`. */
    | { kind: 'continue'; stationId: string }
    /** The hub has no usable tier (503): run the fallback. */
    | { kind: 'fallback' }
    /** The station expired or the hub lost it (404 station_unknown): start it again from its seed. */
    | { kind: 'restart' }
    /**
     * Anything else: nothing changed. `transient` (no answer, a timeout, a 5xx, a 429) is tried
     * again shortly; a refusal of the request itself (400 bad_seed, 404 seed_unknown) waits for
     * the next trigger, which brings other seed tracks.
     */
    | { kind: 'retry'; status: number; transient: boolean };

export const outcomeOf = (
    result: StationResult<StationAnswer>,
    previous: null | StationBinding,
    asked: 'next' | 'start',
): AnswerOutcome => {
    if (!result.ok || !result.data) {
        if (result.status === 503 || result.fallback) return { kind: 'fallback' };
        if (asked === 'start' && result.status === 409 && result.stationId) {
            return { kind: 'continue', stationId: result.stationId };
        }
        if (asked === 'next' && result.status === 404 && result.code === 'station_unknown') {
            return { kind: 'restart' };
        }
        const status = result.status;
        return {
            kind: 'retry',
            status,
            transient: status === 0 || status === 408 || status === 429 || status >= 500,
        };
    }
    const answer = result.data;
    const binding =
        asked === 'start' || !previous || previous.stationId !== answer.stationId
            ? {
                  ...bindingFromAnswer(answer),
                  // A `next` answer names no seed or name; keep what the binding had.
                  name: answer.name || previous?.name || '',
                  seed: answer.seed ?? previous?.seed ?? null,
              }
            : applyNextAnswer(previous, answer)!;
    if (answer.servedElsewhere) {
        return { binding, kind: 'adopt', recheck: true, servedElsewhere: true };
    }
    if (answer.tracks.length > 0) {
        return { binding, kind: 'append', partial: answer.partial, tracks: answer.tracks };
    }
    // No tracks and not exhausted is a partial answer (a source failed or the budget ran out):
    // try again shortly rather than waiting for a trigger that may not come at the queue's end.
    return { binding, kind: 'adopt', recheck: !answer.exhausted, servedElsewhere: false };
};
