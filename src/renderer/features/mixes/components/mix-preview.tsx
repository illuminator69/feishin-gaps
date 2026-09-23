import { useEffect, useState } from 'react';

import { useMixRunner } from '/@/renderer/features/mixes/hooks/use-mixes';
import { Mix } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { closeAllModals } from '/@/shared/components/modal/modal';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { Song } from '/@/shared/types/domain-types';

/**
 * Looking inside a mix without committing to it.
 *
 * **A mix has no fixed contents - that is the whole feature - so "what is in
 * this" had no answer until the engine had been run, and the only way to run it
 * was to tap the mix, which replaces whatever is playing.** That is a lot of
 * commitment for something whose contents cannot be seen, and it is the reason
 * this exists.
 *
 * Two rules it is built on, both of which a more obvious implementation breaks:
 *
 * - **Play plays the list on screen.** `playGenerated` takes the tracks this
 *   preview already built; it does not re-run the recipe. A second run would
 *   produce a different tracklist and make the preview a lie about the thing it
 *   was previewing.
 * - **Previewing is not playing.** `generate` does not `touchMix`, so opening
 *   this does not move the mix up a list sorted by when things were listened to.
 *
 * The reason line says the tracks are a *sample* rather than a tracklist,
 * because a preview that implied otherwise would teach the wrong model of the
 * whole feature.
 */
export const MixPreview = ({ mix }: { mix: Mix }) => {
    const { generate, playGenerated } = useMixRunner();
    const [songs, setSongs] = useState<null | Song[]>(null);
    const [done, setDone] = useState(false);

    useEffect(() => {
        let live = true;
        void generate(mix).then((result) => {
            if (!live) return;
            setSongs(result);
            setDone(true);
        });
        return () => {
            live = false;
        };
        // Built once per open, deliberately: re-running on any dependency change
        // would replace the list the user is reading.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (!done) {
        return (
            <Stack gap="md">
                <Text isMuted size="sm">
                    {`Building a sample of "${mix.name}"…`}
                </Text>
                <Spinner container />
            </Stack>
        );
    }

    if (!songs || songs.length === 0) {
        return (
            <Stack gap="md">
                <Text isMuted size="sm">
                    {songs === null
                        ? `"${mix.name}" could not be built just now.`
                        : `"${mix.name}" produced nothing this time - its source may be empty or still indexing.`}
                </Text>
                <Group justify="flex-end">
                    <Button onClick={() => closeAllModals()} variant="subtle">
                        Close
                    </Button>
                </Group>
            </Stack>
        );
    }

    return (
        <Stack gap="md">
            <Text isMuted size="sm">
                One run of this recipe - a sample of what it builds, not its tracklist. Playing it
                again gives a different set.
            </Text>
            <Stack gap="xs">
                {songs.slice(0, 30).map((song, index) => (
                    <Text key={`${song.id}-${index}`} lineClamp={1} size="sm">
                        {song.name}
                        <Text component="span" isMuted size="sm">
                            {` — ${song.artistName}`}
                        </Text>
                    </Text>
                ))}
            </Stack>
            {songs.length > 30 && (
                <Text isMuted size="xs">
                    …and {songs.length - 30} more.
                </Text>
            )}
            <Group justify="flex-end">
                <Button onClick={() => closeAllModals()} variant="subtle">
                    Close
                </Button>
                <Button
                    onClick={() => {
                        // These exact tracks, never a second regeneration of them.
                        playGenerated(mix, songs);
                        closeAllModals();
                    }}
                    variant="filled"
                >
                    Play these
                </Button>
            </Group>
        </Stack>
    );
};
