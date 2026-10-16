import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { LbModalLayout } from '/@/renderer/features/lbbot/components/lb-modal-layout';
import { useMixRunner } from '/@/renderer/features/mixes/hooks/use-mixes';
import { MixRun } from '/@/renderer/features/mixes/mix-engine';
import { PreviewSongRow } from '/@/renderer/features/shared/components/preview-song-row';
import { Mix } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { closeAllModals } from '/@/shared/components/modal/modal';
import { Skeleton } from '/@/shared/components/skeleton/skeleton';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

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
    const { t } = useTranslation();
    const { generate, playGenerated } = useMixRunner();
    const [run, setRun] = useState<MixRun | null>(null);
    const [done, setDone] = useState(false);

    useEffect(() => {
        let live = true;
        void generate(mix).then((result) => {
            if (!live) return;
            setRun(result);
            setDone(true);
        });
        return () => {
            live = false;
        };
        // Built once per open, deliberately: re-running on any dependency change
        // would replace the list the user is reading.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const close = (
        <Button onClick={() => closeAllModals()} variant="subtle">
            {t('common.close')}
        </Button>
    );

    if (!done) {
        // A skeleton of the list it will become, in the dialog's final height, so nothing
        // jumps when the sample lands.
        return (
            <LbModalLayout
                footer={<Group justify="flex-end">{close}</Group>}
                header={
                    <Text isMuted size="sm">
                        {t('naviConnect.mixPreview.building', { name: mix.name })}
                    </Text>
                }
            >
                <Stack gap="xs">
                    {Array.from({ length: 8 }, (_, index) => (
                        <Skeleton height={44} key={index} />
                    ))}
                </Stack>
            </LbModalLayout>
        );
    }

    const songs = run?.songs ?? null;
    if (!run || !songs || songs.length === 0) {
        return (
            <LbModalLayout footer={<Group justify="flex-end">{close}</Group>}>
                <Text isMuted size="sm">
                    {songs === null
                        ? t('naviConnect.mixPreview.failed', { name: mix.name })
                        : t('naviConnect.mixPreview.empty', { name: mix.name })}
                </Text>
            </LbModalLayout>
        );
    }

    return (
        <LbModalLayout
            footer={
                <Group justify="flex-end">
                    {close}
                    <Button
                        onClick={() => {
                            playGenerated(mix, run);
                            closeAllModals();
                        }}
                        variant="filled"
                    >
                        {t('naviConnect.mixPreview.playThese')}
                    </Button>
                </Group>
            }
            header={
                <Text isMuted size="sm">
                    {t('naviConnect.mixPreview.sampleNote')}
                </Text>
            }
        >
            <Stack gap={2}>
                {songs.map((song, index) => (
                    <PreviewSongRow
                        imageId={song.imageId}
                        imageUrl={song.imageUrl}
                        key={`${song.id}-${index}`}
                        serverId={song._serverId}
                        subtitle={[song.artistName, song.album].filter(Boolean).join(' · ')}
                        title={song.name}
                    />
                ))}
            </Stack>
        </LbModalLayout>
    );
};
