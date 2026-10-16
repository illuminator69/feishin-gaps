import type { QueryClient } from '@tanstack/react-query';

import { api } from '/@/renderer/api';
import { queryKeys } from '/@/renderer/api/query-keys';
import {
    AlchemyParams,
    AudioMuseSettings,
    fetchAlchemyIds,
    fetchFingerprintIds,
} from '/@/renderer/features/player/auto-dj/audio-muse-source';
import { runAutoDjSongs } from '/@/renderer/features/player/auto-dj/auto-dj-songs';
import {
    buildStationQueue,
    currentCharacter,
    stationsReady,
} from '/@/renderer/features/player/station/station-client';
import {
    characterFromAny,
    StationBinding,
    toCharacterId,
} from '/@/renderer/features/player/station/station-logic';
import { songsQueries } from '/@/renderer/features/songs/api/songs-api';
import { Mix, MixKind } from '/@/renderer/store';
import { AUTO_DJ_STRATEGY } from '/@/renderer/store/settings.store';
import { shuffleInPlace } from '/@/renderer/utils/shuffle';
import { Played, QueueSong, ServerListItem, Song } from '/@/shared/types/domain-types';

/**
 * Regenerating a mix from its recipe.
 *
 * **This is the whole point of the feature, and the one thing a snapshot would
 * also pass a casual test of.** Playing a mix twice must produce two different
 * tracklists — otherwise it is a saved queue with a nicer name. Every branch
 * below therefore re-asks its source rather than reading anything cached: the
 * random and alchemy sources are non-deterministic by nature, and the two
 * library-query branches shuffle a pool several times the size of the answer.
 *
 * Nothing here is a new engine. With the hub's station engine (I-040) the
 * radio-like kinds start a station, which never serves what it served before or
 * what was played in the last two weeks, so a second play differs by design. The
 * other kinds, and every kind without the engine, route into machinery this
 * client already runs for Auto DJ.
 */

/**
 * The station character a recipe asks for (PROTOCOL §17.1): its own `character`, else the one
 * its legacy `moodCharacter` names. An unknown value is Balanced, the hub's default, rather
 * than an error: a mix made by a newer client must still play here.
 */
const mixCharacter = (mix: Mix) => characterFromAny(mix.character || mix.moodCharacter);

/**
 * Song Alchemy knobs for an `adaptive` mix played without the station engine: the numbers the
 * old Mood Flow presets used, kept so that path plays as it always did.
 */
const legacyAlchemyParams = (mix: Mix): AlchemyParams => {
    switch (mixCharacter(mix)) {
        case 'close':
            return { temperature: 0.5 };
        case 'explore':
            return { temperature: 1.6 };
        default:
            return { subtractDistance: 0.35, temperature: 0.6 };
    }
};

export interface MixEngineDeps {
    audioMuse: AudioMuseSettings;
    queryClient: QueryClient;
    server: null | ServerListItem | undefined;
    serverId: string;
}

/**
 * One run of a recipe. `station` is set when it played through the hub's station engine: the
 * queue then belongs to that station, and playing it binds the session to it (I-040).
 */
export interface MixRun {
    songs: Song[];
    station?: StationBinding;
}

/** Bare ids → full Songs. Mirrors `use-auto-dj`'s `resolveSongsByIds`; a song
 *  that no longer exists is dropped rather than faking a row, because unlike a
 *  hub queue there is no index here for a gap to shift. */
const resolveSongsByIds = async (serverId: string, ids: string[]): Promise<Song[]> => {
    if (ids.length === 0) return [];
    const songs = await Promise.all(
        ids.map((id) =>
            api.controller
                .getSongDetail({ apiClientProps: { serverId }, query: { id } })
                .catch(() => null),
        ),
    );
    return songs.filter((song): song is Song => Boolean(song));
};

const seedSong = (serverId: string, id: string): Promise<null | Song> =>
    api.controller.getSongDetail({ apiClientProps: { serverId }, query: { id } }).catch(() => null);

/**
 * With the hub's station engine (PROTOCOL §17.1): `similar` is a track radio on Balanced,
 * `fingerprint` and `adaptive` are Your mix (adaptive keeping its character), and `station` is
 * the radio its recipe names. Null: not a station kind, or the engine did not start one, and
 * the old path runs.
 */
const runThroughStation = async (
    mix: Mix,
    serverId: string,
    count: number,
): Promise<MixRun | null> => {
    const start = async (
        seed: 'yourMix' | Song,
        character: ReturnType<typeof mixCharacter>,
    ): Promise<MixRun | null> => {
        const queue = await buildStationQueue({
            character,
            count,
            leading: seed === 'yourMix' ? [] : [seed],
            seed:
                seed === 'yourMix'
                    ? { kind: 'yourMix' }
                    : { ids: [seed.id], kind: 'track', name: seed.name },
            serverId,
        });
        return queue ? { songs: queue.songs, station: queue.binding } : null;
    };

    switch (mix.kind as MixKind) {
        case 'adaptive':
            return start('yourMix', mixCharacter(mix));
        case 'fingerprint':
            return start('yourMix', toCharacterId(mix.character) ?? currentCharacter());
        case 'similar': {
            if (!mix.seedId) return null;
            const seed = await seedSong(serverId, mix.seedId);
            return seed ? start(seed, 'balanced') : null;
        }
        case 'station': {
            if (!mix.seedId) return start('yourMix', mixCharacter(mix));
            const seed = await seedSong(serverId, mix.seedId);
            return seed ? start(seed, mixCharacter(mix)) : null;
        }
        default:
            return null;
    }
};

/**
 * Run one mix's recipe and answer with a fresh tracklist.
 *
 * Empty is a legitimate answer - an AudioMuse index that has not been built, a
 * seed song that has been deleted, a genre with nothing in it - and the caller
 * says so rather than starting silent playback.
 */
export const regenerateMix = async (mix: Mix, deps: MixEngineDeps): Promise<MixRun> => {
    const { serverId } = deps;
    const count = Math.max(1, Math.min(50, mix.count || 50));

    if (stationsReady()) {
        const viaStation = await runThroughStation(mix, serverId, count);
        if (viaStation) return viaStation;
    }

    return { songs: await regenerateLocally(mix, deps, Math.max(1, mix.count || 50)) };
};

/** The paths that run without the station engine, as they always did. */
const regenerateLocally = async (mix: Mix, deps: MixEngineDeps, count: number): Promise<Song[]> => {
    const { audioMuse, queryClient, server, serverId } = deps;

    // Without the engine a radio recipe plays as its nearest old kind: a seeded one as
    // `similar`, Your mix as `fingerprint` (PROTOCOL §18 "Without the engine").
    const kind: MixKind =
        mix.kind === 'station' ? (mix.seedId ? 'similar' : 'fingerprint') : (mix.kind as MixKind);

    switch (kind) {
        case 'adaptive': {
            // Song Alchemy off the stored seed. `subtractIds` is empty on
            // purpose: the skip signals Auto DJ feeds it are a property of the
            // *current* listening session, and a recipe that carried a
            // fossilised set of them would drift further from the seed every
            // time it was replayed.
            if (!mix.seedId) return [];
            const ids = await fetchAlchemyIds(
                audioMuse,
                [mix.seedId],
                [],
                count,
                legacyAlchemyParams(mix),
            );
            return resolveSongsByIds(serverId, ids);
        }
        case 'artist': {
            if (!mix.seedId) return [];
            const radio = await queryClient
                .fetchQuery({
                    ...songsQueries.artistRadio({
                        query: { artistId: mix.seedId, count },
                        serverId,
                    }),
                    // A fresh key each run, so react-query cannot hand back the
                    // previous regeneration's answer — which would turn the mix
                    // back into a snapshot for as long as the cache lived.
                    queryKey: queryKeys.player.fetch({ at: Date.now(), mixArtist: mix.id }),
                })
                .catch(() => null);
            return radio ?? [];
        }
        case 'fingerprint': {
            // Seeded from listening history rather than from a stored id, which
            // is why this is the one kind with no seed: its recipe is "me,
            // lately", and that moves on its own.
            const ids = await fetchFingerprintIds(audioMuse, server ?? null, count);
            return resolveSongsByIds(serverId, ids);
        }
        case 'genre': {
            // `getRandomSongList` takes a genre NAME, not an id — hence
            // `seedName` being the load-bearing field here while every other
            // kind reads `seedId`.
            const random = await queryClient
                .fetchQuery({
                    ...songsQueries.random({
                        query: {
                            genre: mix.seedName || undefined,
                            limit: count,
                            played: Played.All,
                        },
                        serverId,
                    }),
                    queryKey: queryKeys.player.fetch({ at: Date.now(), mixGenre: mix.id }),
                })
                .catch(() => null);
            return shuffleInPlace((random?.items ?? []).slice()).slice(0, count);
        }
        case 'similar': {
            // The Auto DJ similarity runner, given the seed song as its
            // "current" track. It wants a QueueSong; a Song satisfies every
            // field it actually reads (id, artists, albumId, genres) and the
            // cast is the same one `use-auto-dj` makes on its remote path.
            if (!mix.seedId) return [];
            const seed = await api.controller
                .getSongDetail({ apiClientProps: { serverId }, query: { id: mix.seedId } })
                .catch(() => null);
            if (!seed) return [];
            return runAutoDjSongs({
                allowDuplicates: false,
                currentSong: seed as unknown as QueueSong,
                itemCount: count,
                musicFolderId: server?.musicFolderId || undefined,
                onlySimilar: false,
                queryClient,
                queueSongIdSet: new Set<string>(),
                server,
                serverId,
                songStrategy: AUTO_DJ_STRATEGY.SIMILAR,
                trySimilarSongs: true,
            });
        }
        default:
            // A kind this build does not know, from a newer client. Refused, not
            // approximated — see `isKnownMixKind`. The caller checks first and
            // says so; this is the second line of that defence, because falling
            // through to `similar` here would undo the whole point of carrying
            // the unknown kind through the parser.
            return [];
    }
};
