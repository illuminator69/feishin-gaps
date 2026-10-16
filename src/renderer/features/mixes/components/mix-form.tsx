import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { artistsQueries } from '/@/renderer/features/artists/api/artists-api';
import { genresQueries } from '/@/renderer/features/genres/api/genres-api';
import { legacyMoodCharacter } from '/@/renderer/features/player/station/station-logic';
import { useStationMode } from '/@/renderer/features/player/station/station-store';
import { useStationWords } from '/@/renderer/features/player/station/use-station-words';
import { MixKind, useCurrentServerId, usePlayerSong } from '/@/renderer/store';
import { useStationSettings } from '/@/renderer/store/settings.store';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { closeAllModals } from '/@/shared/components/modal/modal';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Select } from '/@/shared/components/select/select';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { AlbumArtistListSort, GenreListSort, SortOrder } from '/@/shared/types/domain-types';
import { StationCharacterId } from '/@/shared/types/station-types';

/**
 * Creating a recipe.
 *
 * The common path is still "save what I am listening to": the form opens on the
 * playing song, and (I-040) on a Radio with the character autoplay uses, when the
 * hub's station engine is there. A new mix is 50 tracks long; Auto DJ's item
 * count is a top-up of five and was never a mix length.
 *
 * **But three of the five kinds cannot be expressed that way, and two of them
 * had no create path at all.** `similar`, `adaptive` and `fingerprint` are the
 * autoplay modes; `genre` and `artist` are not, so seeding them from the playing
 * track meant a genre mix could only ever be the genre of whatever happened to
 * be on, and an artist mix that artist — and neither could be made at all with
 * nothing playing. An earlier revision of this file argued a picker would be "a
 * second search UI for a field whose right answer is always *this*". That holds
 * for `similar` and `adaptive`, where the seed is a track and the track is the
 * one you are listening to. It does not hold for a genre or an artist, which are
 * choices rather than context — Navic reached the same conclusion from the
 * opposite direction, where those two kinds were entirely unreachable.
 *
 * So the seed control is **per kind**: a stated fact for the track kinds, a
 * searchable list of the library's own artists or genres for the two that are
 * choices, and nothing at all for `fingerprint`, which is seeded from listening
 * history and has no seed to pick.
 */

const KIND_LABEL: Record<MixKind, string> = {
    adaptive: 'Adaptive - built from what you listen to, with a character',
    artist: 'Artist radio - more like one artist',
    fingerprint: 'Sonic fingerprint - built from what you listen to',
    genre: 'Genre - a random run through one genre',
    similar: 'Similar - tracks close to a seed track',
    station: 'Radio - around a track, steered by your skips and likes',
};

/** Radio first: with the hub's station engine it is what a new mix usually is. */
const KIND_ORDER: MixKind[] = ['station', 'similar', 'adaptive', 'fingerprint', 'artist', 'genre'];

/** The kinds seeded by the playing track. The other three are: two picked from
 *  the library, and `fingerprint`, which needs no seed. */
const NEEDS_SEED_SONG = new Set<MixKind>(['adaptive', 'similar', 'station']);

/** The kinds a character steers (I-040): a radio, and adaptive, which plays as Your mix. */
const TAKES_CHARACTER = new Set<MixKind>(['adaptive', 'station']);

/** A new mix's length. Not Auto DJ's item count, which is a top-up size of five. */
const NEW_MIX_COUNT = 50;

interface MixFormProps {
    onSubmit: (mix: {
        character: string;
        count: number;
        coverArtId: string;
        kind: MixKind;
        moodCharacter: string;
        name: string;
        seedId: string;
        seedName: string;
    }) => void;
}

const defaultName = (kind: MixKind, songName?: string): string =>
    songName ? (kind === 'station' ? `${songName} radio` : `Like ${songName}`) : 'Your Mix';

export const MixForm = ({ onSubmit }: MixFormProps) => {
    const song = usePlayerSong();
    const serverId = useCurrentServerId();
    // The Radio kind plays through the hub's station engine and is offered only with it.
    const stationMode = useStationMode();
    const words = useStationWords();
    const stationSettings = useStationSettings();
    const offered = KIND_ORDER.filter((value) => value !== 'station' || stationMode !== 'fallback');
    const [kind, setKind] = useState<MixKind>(offered[0]);
    const [character, setCharacter] = useState<StationCharacterId>(
        stationSettings?.character ?? 'balanced',
    );
    const [name, setName] = useState(defaultName(offered[0], song?.name));
    const [nameEdited, setNameEdited] = useState(false);
    // The picked seed for the two library kinds, held separately so switching
    // kinds and switching back does not silently keep the other kind's choice.
    const [pickedArtist, setPickedArtist] = useState<null | string>(null);
    const [pickedGenre, setPickedGenre] = useState<null | string>(null);

    // Both lists are fetched only for the kind that needs them. They are the
    // library's own artists and genres, so a mix can only ever be seeded with
    // something this server actually has.
    const artists = useQuery({
        ...artistsQueries.albumArtistList({
            query: {
                limit: 500,
                sortBy: AlbumArtistListSort.NAME,
                sortOrder: SortOrder.ASC,
                startIndex: 0,
            },
            serverId,
        }),
        enabled: kind === 'artist' && Boolean(serverId),
    });
    const genres = useQuery({
        ...genresQueries.list({
            query: {
                limit: -1,
                sortBy: GenreListSort.NAME,
                sortOrder: SortOrder.ASC,
                startIndex: 0,
            },
            serverId,
        }),
        enabled: kind === 'genre' && Boolean(serverId),
    });

    const needsSong = NEEDS_SEED_SONG.has(kind);
    const artistRow = (artists.data?.items ?? []).find((row) => row.id === pickedArtist);
    const genreRow = (genres.data?.items ?? []).find((row) => row.id === pickedGenre);

    const seedId =
        kind === 'artist'
            ? (pickedArtist ?? '')
            : kind === 'genre'
              ? (pickedGenre ?? '')
              : (song?.id ?? '');
    const seedName =
        kind === 'artist'
            ? (artistRow?.name ?? '')
            : kind === 'genre'
              ? (genreRow?.name ?? '')
              : (song?.name ?? '');

    /**
     * The cover, stamped from the **seed** rather than from a generated queue.
     *
     * The seed is a fixed part of the recipe, so it stays true on a second play;
     * the tracklist is the one thing about a mix guaranteed to change, so a
     * cover taken from it would be a picture of what played last time.
     *
     * A genre has no cover art of its own and a fingerprint has no seed at all —
     * both fall through to the kind glyph `MixArtwork` draws, which is an honest
     * answer rather than a missing one.
     */
    const coverArtId =
        kind === 'artist' ? (artistRow?.id ?? '') : needsSong ? (song?.albumId ?? '') : '';

    const blocked =
        (needsSong && !song?.id) ||
        (kind === 'artist' && !pickedArtist) ||
        (kind === 'genre' && !pickedGenre) ||
        name.trim().length === 0;

    return (
        <Stack gap="md">
            <TextInput
                autoFocus
                label="Name"
                onChange={(event) => {
                    setName(event.currentTarget.value);
                    setNameEdited(true);
                }}
                value={name}
            />
            <Select
                data={offered.map((value) => ({
                    label: KIND_LABEL[value],
                    value,
                }))}
                label="How it is built"
                onChange={(value) => {
                    const next = (value as MixKind) ?? offered[0];
                    setKind(next);
                    // The suggested name follows the kind until the user writes their own.
                    if (!nameEdited) setName(defaultName(next, song?.name));
                }}
                value={kind}
            />
            {TAKES_CHARACTER.has(kind) && (
                <Stack gap={4}>
                    <Text size="sm">Character</Text>
                    <SegmentedControl
                        data={words.characters.map((row) => ({ label: row.label, value: row.id }))}
                        onChange={(value) => setCharacter(value as StationCharacterId)}
                        value={character}
                        w="100%"
                    />
                    <Text isMuted size="xs">
                        {words.characters.find((row) => row.id === character)?.description}
                    </Text>
                </Stack>
            )}
            {/* The track seed is not editable, so it is stated rather than
                offered - and stated as a fact about what will be saved, since
                "the currently playing track" stops being true the moment
                playback moves on. */}
            {needsSong && (
                <Text isMuted size="sm">
                    {song?.name
                        ? `Seeded from "${song.name}" by ${song.artistName}.`
                        : 'Play something first - this kind of mix is built around a track.'}
                </Text>
            )}
            {kind === 'artist' && (
                <Select
                    data={(artists.data?.items ?? []).map((row) => ({
                        label: row.name,
                        value: row.id,
                    }))}
                    label="Artist"
                    onChange={setPickedArtist}
                    placeholder={artists.isLoading ? 'Loading artists…' : 'Pick an artist'}
                    searchable
                    value={pickedArtist}
                />
            )}
            {kind === 'genre' && (
                <Select
                    data={(genres.data?.items ?? []).map((row) => ({
                        label: row.name,
                        value: row.id,
                    }))}
                    label="Genre"
                    onChange={setPickedGenre}
                    placeholder={genres.isLoading ? 'Loading genres…' : 'Pick a genre'}
                    searchable
                    value={pickedGenre}
                />
            )}
            {kind === 'fingerprint' && (
                <Text isMuted size="sm">
                    Built from your listening history, so it needs no seed - and changes on its own
                    over time.
                </Text>
            )}
            <Group justify="flex-end">
                <Button onClick={() => closeAllModals()} variant="subtle">
                    Cancel
                </Button>
                <Button
                    disabled={blocked}
                    onClick={() => {
                        onSubmit({
                            // Both names of the character: `moodCharacter` is what a client from
                            // before stations reads (PROTOCOL §17.1).
                            character,
                            count: NEW_MIX_COUNT,
                            coverArtId,
                            kind,
                            moodCharacter: legacyMoodCharacter(character),
                            name: name.trim(),
                            seedId: kind === 'fingerprint' ? '' : seedId,
                            seedName: kind === 'fingerprint' ? '' : seedName,
                        });
                        closeAllModals();
                    }}
                    variant="filled"
                >
                    Save mix
                </Button>
            </Group>
        </Stack>
    );
};
