import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ReactNode, useMemo, useState } from 'react';

import { genresQueries } from '/@/renderer/features/genres/api/genres-api';
import {
    artistPickerEmpty,
    buildRecipe,
    FormKind,
    formKindsFor,
    formKindTakesCharacter,
    matchGenres,
    MixRecipe,
    PICKER_DEBOUNCE_MS,
    PICKER_LIMIT,
    pickerOptions,
    pickerTerm,
    suggestedMixName,
} from '/@/renderer/features/mixes/mix-recipe';
import { useStationMode } from '/@/renderer/features/player/station/station-store';
import { useStationWords } from '/@/renderer/features/player/station/use-station-words';
import { searchQueries } from '/@/renderer/features/search/api/search-api';
import { useCurrentServerId, usePlayerSong } from '/@/renderer/store';
import { useStationSettings } from '/@/renderer/store/settings.store';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { closeAllModals } from '/@/shared/components/modal/modal';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Select } from '/@/shared/components/select/select';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { useDebouncedValue } from '/@/shared/hooks/use-debounced-value';
import { GenreListSort, SortOrder } from '/@/shared/types/domain-types';
import { StationCharacterId } from '/@/shared/types/station-types';

/**
 * Creating a recipe (B-149, B-151; the same spec as Navic's form).
 *
 * Four kinds, in this order: Radio (around the playing song), Your mix (the hub's station from
 * what you play most; only with the station engine, which is what builds it), Genre and Artist.
 * The kinds, their words and the recipe each saves live in `mix-recipe.ts`.
 *
 * A genre or an artist is a choice rather than context, so those two have a picker, and **the
 * picker lists nothing until you type**. It used to open on the first 500 artists, which is all
 * an artist mix could ever be seeded with in a library of thousands. The artist picker asks the
 * server (search3) as you type; the genre picker filters the whole genre list, which is loaded
 * once and is small enough to hold.
 */

/** A new mix's length. Not Auto DJ's item count, which is a top-up size of five. */
const NEW_MIX_COUNT = 50;

interface MixFormProps {
    onSubmit: (mix: MixRecipe) => void;
}

/**
 * A searchable Select that opens only on typed text. Its options are already the matches (from
 * the server, or filtered here), so Mantine's own filter is turned off; with no options and no
 * message, Mantine hides the dropdown. The pick stays in the box: Mantine keeps a picked option's
 * label after it leaves `data`, and puts it back on blur.
 */
const TypeToPick = ({
    label,
    nothingFound,
    onPick,
    onTyped,
    options,
    placeholder,
    typed,
    value,
}: {
    label: string;
    nothingFound?: ReactNode;
    onPick: (value: null | string, label: string) => void;
    onTyped: (typed: string) => void;
    options: { label: string; value: string }[];
    placeholder: string;
    typed: string;
    value: null | string;
}) => (
    <Select
        data={options}
        filter={({ options: all }) => all}
        label={label}
        nothingFoundMessage={nothingFound}
        onChange={(next, option) => onPick(next, option?.label ?? '')}
        onSearchChange={onTyped}
        placeholder={placeholder}
        searchable
        searchValue={typed}
        value={value}
    />
);

const ArtistPicker = ({
    onPick,
    picked,
    serverId,
}: {
    onPick: (artist: null | { id: string; name: string }) => void;
    picked: null | { id: string; name: string };
    serverId: string;
}) => {
    const [typed, setTyped] = useState(picked?.name ?? '');
    const term = pickerTerm(typed, picked?.name);
    const [debounced] = useDebouncedValue(term, PICKER_DEBOUNCE_MS);
    const search = useQuery({
        ...searchQueries.search({
            query: {
                albumArtistLimit: PICKER_LIMIT,
                albumArtistStartIndex: 0,
                albumLimit: 0,
                albumStartIndex: 0,
                query: debounced,
                songLimit: 0,
                songStartIndex: 0,
            },
            serverId,
        }),
        enabled: Boolean(serverId && debounced),
        placeholderData: keepPreviousData,
    });

    const options = useMemo(() => {
        // One option per id: Mantine refuses to render a list with a repeated value.
        const byId = new Map<string, { label: string; value: string }>();
        for (const artist of pickerOptions(term, search.data?.albumArtists ?? [])) {
            if (!byId.has(artist.id)) byId.set(artist.id, { label: artist.name, value: artist.id });
        }
        return [...byId.values()];
    }, [search.data, term]);

    return (
        <TypeToPick
            label="Artist"
            nothingFound={
                artistPickerEmpty({
                    error: search.isError,
                    results: options.length,
                    settled: debounced === term && !search.isFetching,
                    term,
                }) ?? undefined
            }
            onPick={(id, name) => onPick(id ? { id, name } : null)}
            onTyped={setTyped}
            options={options}
            placeholder="Type to search your artists"
            typed={typed}
            value={picked?.id ?? null}
        />
    );
};

const GenrePicker = ({
    onPick,
    picked,
    serverId,
}: {
    onPick: (genre: null | string) => void;
    picked: null | string;
    serverId: string;
}) => {
    const [typed, setTyped] = useState(picked ?? '');
    const term = pickerTerm(typed, picked);
    const genres = useQuery(
        genresQueries.list({
            query: {
                limit: -1,
                sortBy: GenreListSort.NAME,
                sortOrder: SortOrder.ASC,
                startIndex: 0,
            },
            serverId,
        }),
    );
    // By NAME: a recipe holds the genre's name, which Navic and getRandomSongs both take.
    const options = useMemo(
        () =>
            matchGenres(term, genres.data?.items ?? []).map((name) => ({
                label: name,
                value: name,
            })),
        [genres.data, term],
    );

    return (
        <TypeToPick
            label="Genre"
            nothingFound={
                !term || options.length > 0
                    ? undefined
                    : genres.isLoading
                      ? 'Loading genres...'
                      : 'No genre matches'
            }
            onPick={(name) => onPick(name)}
            onTyped={setTyped}
            options={options}
            placeholder="Type to search your genres"
            typed={typed}
            value={picked}
        />
    );
};

export const MixForm = ({ onSubmit }: MixFormProps) => {
    const song = usePlayerSong();
    const serverId = useCurrentServerId();
    // Your mix is the hub's station from what you play most, so it is offered only with it.
    const offered = formKindsFor(useStationMode() === 'stations');
    const words = useStationWords();
    const stationSettings = useStationSettings();
    const [chosenKind, setKind] = useState<FormKind>('radio');
    // A kind that stopped being offered while the form was open (the engine went away).
    const kind = offered.some((row) => row.id === chosenKind) ? chosenKind : 'radio';
    const [character, setCharacter] = useState<StationCharacterId>(
        stationSettings?.character ?? 'balanced',
    );
    // The picked seed for the two library kinds, held separately so switching kinds and back
    // keeps each kind's own choice and never hands one kind's seed to the other.
    const [pickedArtist, setPickedArtist] = useState<null | { id: string; name: string }>(null);
    const [pickedGenre, setPickedGenre] = useState<null | string>(null);

    // The name follows the recipe (the kind, the song, the pick) until the user writes their own:
    // while the box is empty or still holds the last suggestion.
    const suggested = suggestedMixName(kind, {
        artist: pickedArtist?.name,
        genre: pickedGenre,
        song: song?.name,
    });
    const [name, setName] = useState(suggested);
    const [lastSuggested, setLastSuggested] = useState(suggested);
    if (suggested !== lastSuggested) {
        setLastSuggested(suggested);
        if (name.trim() === '' || name === lastSuggested) setName(suggested);
    }

    const recipe = buildRecipe({
        artist: pickedArtist,
        character,
        count: NEW_MIX_COUNT,
        genre: pickedGenre,
        kind,
        name,
        song: song ? { albumId: song.albumId, id: song.id, name: song.name } : null,
    });

    return (
        <Stack gap="md">
            <TextInput
                autoFocus
                label="Name"
                onChange={(event) => setName(event.currentTarget.value)}
                value={name}
            />
            <Stack gap={4}>
                <Text size="sm">How it is built</Text>
                <SegmentedControl
                    data={offered.map((row) => ({ label: row.label, value: row.id }))}
                    onChange={(value) => setKind(value as FormKind)}
                    value={kind}
                    w="100%"
                />
                <Text isMuted size="xs">
                    {offered.find((row) => row.id === kind)?.description}
                </Text>
            </Stack>
            {/* The song is not editable, so it is stated rather than offered - and stated as a
                fact about what will be saved, since "the playing song" stops being true the
                moment playback moves on. */}
            {kind === 'radio' && (
                <Text isMuted size="sm">
                    {song?.name
                        ? `Seeded from "${song.name}" by ${song.artistName}.`
                        : 'Play something first - a radio is built around a song.'}
                </Text>
            )}
            {kind === 'artist' && serverId && (
                <ArtistPicker onPick={setPickedArtist} picked={pickedArtist} serverId={serverId} />
            )}
            {kind === 'genre' && serverId && (
                <GenrePicker onPick={setPickedGenre} picked={pickedGenre} serverId={serverId} />
            )}
            {formKindTakesCharacter(kind) && (
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
            <Group justify="flex-end">
                <Button onClick={() => closeAllModals()} variant="subtle">
                    Cancel
                </Button>
                <Button
                    disabled={!recipe}
                    onClick={() => {
                        if (!recipe) return;
                        onSubmit(recipe);
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
