import type { QueryClient } from '@tanstack/react-query';

import { api } from '/@/renderer/api';
import { queryKeys } from '/@/renderer/api/query-keys';
import {
    fetchAlchemyIds,
    fetchFingerprintIds,
    MoodCharacter,
    moodCharacterParams,
} from '/@/renderer/features/player/auto-dj/audio-muse-source';
import { AudioMuseSettings } from '/@/renderer/features/player/auto-dj/audio-muse-source';
import { runAutoDjSongs } from '/@/renderer/features/player/auto-dj/auto-dj-songs';
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
 * Nothing here is a new engine. Each kind routes into machinery this client
 * already runs for Auto DJ — which is exactly why the hub stores a recipe and
 * not a result: the client that plays it is the client that owns the engine, and
 * the two clients' engines are allowed to differ.
 */

/**
 * The hub's mood vocabulary, translated to this client's.
 *
 * The two clients already disagree about these ids — Navic's `MoodCharacter`
 * and Feishin's `audio-muse-source.ts` carry the same three presets under
 * different names — so the wire form is Navic's and this is the one place the
 * translation happens. An unknown value falls back to `steady`, the server's own
 * middle setting, rather than throwing: a mix made by a newer client must still
 * play here.
 */
const toMoodCharacter = (wire: string): MoodCharacter => {
    switch (wire) {
        case 'EchoMatch':
            return 'echo';
        case 'TransitionMaestro':
            return 'transition';
        case 'SteadyVibes':
        default:
            return 'steady';
    }
};

/** The reverse, for what this client writes. */
export const toWireMoodCharacter = (character: MoodCharacter): string => {
    switch (character) {
        case 'echo':
            return 'EchoMatch';
        case 'transition':
            return 'TransitionMaestro';
        case 'steady':
        default:
            return 'SteadyVibes';
    }
};

export interface MixEngineDeps {
    audioMuse: AudioMuseSettings;
    queryClient: QueryClient;
    server: null | ServerListItem | undefined;
    serverId: string;
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

/**
 * Run one mix's recipe and answer with a fresh tracklist.
 *
 * Empty is a legitimate answer — an AudioMuse index that has not been built, a
 * seed song that has been deleted, a genre with nothing in it — and the caller
 * says so rather than starting silent playback.
 */
export const regenerateMix = async (mix: Mix, deps: MixEngineDeps): Promise<Song[]> => {
    const { audioMuse, queryClient, server, serverId } = deps;
    const count = Math.max(1, mix.count || 50);

    switch (mix.kind as MixKind) {
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
                moodCharacterParams(toMoodCharacter(mix.moodCharacter)),
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
