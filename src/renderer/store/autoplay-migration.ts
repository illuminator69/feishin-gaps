// navi-connect (I-040): settings v35 -> v36. Pure, so the harness can run it without the store
// (autoplay-migration.harness.ts).
//
// Up to v35 the fork's Auto DJ slice carried two extra fields: `autoplaySource` (autoDj |
// fingerprint | moodFlow), which picked the engine that topped up the queue, and `moodCharacter`
// (echo | steady | transition), Mood Flow's preset. Radio and autoplay are now the hub's
// stations (PROTOCOL §18): autoplay is On/Off and a station has one of three characters. So:
//
//   - `autoDJ` goes back to upstream's own schema: both fields are dropped, `enabled` keeps its
//     value (every source meant "on"), and upstream's own fields are untouched, since without
//     the hub's engine upstream's Auto DJ is what runs.
//   - a fork slice `station: { character }` takes the old preset, renamed: echo -> close,
//     steady -> balanced, transition -> explore. A user on Mood Flow + Transition Maestro lands
//     on On + Explore. An already-present `station.character` (a v36 file migrated again) wins.

export type StationCharacterSetting = 'balanced' | 'close' | 'explore';

interface MigratableSettings {
    autoDJ?: Record<string, unknown>;
    station?: { character?: unknown };
}

const characterOf = (value: unknown): StationCharacterSetting => {
    switch (value) {
        case 'balanced':
        case 'close':
        case 'explore':
            return value;
        case 'echo':
            return 'close';
        case 'transition':
            return 'explore';
        default:
            return 'balanced';
    }
};

export const migrateAutoplayToStations = <T extends MigratableSettings>(
    state: T,
): T & { station: { character: StationCharacterSetting } } => {
    const autoDJ = state.autoDJ;
    const legacy = autoDJ?.moodCharacter;
    if (autoDJ) {
        delete autoDJ.autoplaySource;
        delete autoDJ.moodCharacter;
    }
    const kept = state.station?.character;
    state.station = {
        ...(state.station ?? {}),
        character:
            kept === 'balanced' || kept === 'close' || kept === 'explore'
                ? kept
                : characterOf(legacy),
    };
    return state as T & { station: { character: StationCharacterSetting } };
};
