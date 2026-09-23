import { Suspense, useState } from 'react';

import styles from './mixes-route.module.css';

import { NativeScrollArea } from '/@/renderer/components/native-scroll-area/native-scroll-area';
import { MixArtwork } from '/@/renderer/features/mixes/components/mix-artwork';
import { MixForm } from '/@/renderer/features/mixes/components/mix-form';
import { MixPreview } from '/@/renderer/features/mixes/components/mix-preview';
import { useMixActions, usePlayMix } from '/@/renderer/features/mixes/hooks/use-mixes';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { LibraryContainer } from '/@/renderer/features/shared/components/library-container';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import {
    isKnownMixKind,
    Mix,
    MixKind,
    useHubConnected,
    useMixes,
    useWindowSettings,
} from '/@/renderer/store';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Button } from '/@/shared/components/button/button';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Group } from '/@/shared/components/group/group';
import { closeAllModals, openModal } from '/@/shared/components/modal/modal';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { Platform } from '/@/shared/types/types';

/**
 * navi-connect: "Mixed for You" — the recipes, not the results.
 *
 * The name avoids both words this stack has already spent. "Station" is
 * Subsonic internet radio in Navic (`Screen.RadioList`) and in Feishin's
 * create/edit-station forms; "radio" is the ephemeral similarity mix
 * (`RadioManager.startRadio`, `SavedQueueSource.RADIO`); and Navidrome's own
 * "Instant Mix" is ephemeral too — which is precisely what these are not. In
 * code the noun is `mix`.
 *
 * Every card here plays something **different** each time. That is the single
 * behaviour separating this page from `/saved-queues` next door, and the one a
 * frozen tracklist would also appear to pass on first use.
 */

/** How the mix was built, in a phrase, for the row's second line. */
const KIND_LINE: Record<MixKind, (mix: Mix) => string> = {
    adaptive: (mix) => `Mood Flow around ${mix.seedName || 'a track'}`,
    artist: (mix) => `Artist radio · ${mix.seedName || 'an artist'}`,
    fingerprint: () => 'Built from your listening',
    genre: (mix) => `Genre · ${mix.seedName || 'unknown'}`,
    similar: (mix) => `Similar to ${mix.seedName || 'a track'}`,
};

/** A recipe from a newer client. Named, not hidden — the row is still worth
 *  renaming and deleting, and saying which kind is what makes "update the app"
 *  actionable rather than mysterious. */
const kindLine = (mix: Mix): string =>
    isKnownMixKind(mix.kind) ? KIND_LINE[mix.kind](mix) : `Unknown kind · ${mix.kind}`;

const RenameMixForm = ({ mix, onSubmit }: { mix: Mix; onSubmit: (name: string) => void }) => {
    const [value, setValue] = useState(mix.name);
    return (
        <Stack gap="md">
            <TextInput
                autoFocus
                onChange={(event) => setValue(event.currentTarget.value)}
                onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    onSubmit(value);
                    closeAllModals();
                }}
                value={value}
            />
            <Group justify="flex-end">
                <Button onClick={() => closeAllModals()} variant="subtle">
                    Cancel
                </Button>
                <Button
                    onClick={() => {
                        onSubmit(value);
                        closeAllModals();
                    }}
                    variant="filled"
                >
                    Save
                </Button>
            </Group>
        </Stack>
    );
};

const MixRow = ({ mix }: { mix: Mix }) => {
    const { deleteMix, renameMix } = useMixActions();
    const { play, playingId } = usePlayMix();
    const busy = playingId === mix.id;
    const playable = isKnownMixKind(mix.kind);

    return (
        <div className={styles.row}>
            <button
                className={styles.rowMain}
                disabled={busy || !playable}
                onClick={() => void play(mix)}
                type="button"
            >
                {/* The same renderer the Discover tile uses, so the two cannot
                    come to disagree about what a mix with no cover looks like. */}
                <MixArtwork className={styles.art} mix={mix} />
                <div className={styles.meta}>
                    <Text lineClamp={1} size="md" weight={600}>
                        {mix.name}
                    </Text>
                    <Text isMuted lineClamp={1} size="sm">
                        {kindLine(mix)} · {mix.count} tracks
                    </Text>
                    {/* Said plainly on every row, because it is the property
                        that distinguishes this page from Saved Queues and it is
                        not otherwise visible until the second play. */}
                    <Text isMuted lineClamp={1} size="xs">
                        {!playable
                            ? 'Made with a newer version of navi-connect — this build cannot build it'
                            : busy
                              ? 'Building…'
                              : 'Rebuilt fresh each time you play it'}
                    </Text>
                </div>
            </button>
            <DropdownMenu>
                <DropdownMenu.Target>
                    <ActionIcon icon="ellipsisHorizontal" size="sm" variant="subtle" />
                </DropdownMenu.Target>
                <DropdownMenu.Dropdown>
                    <DropdownMenu.Item disabled={!playable} onClick={() => void play(mix)}>
                        Play
                    </DropdownMenu.Item>
                    {/* Run the recipe and show the result without touching
                        playback. Until this existed the only way to find out
                        what a mix contained was to let it replace what you were
                        listening to. */}
                    <DropdownMenu.Item
                        disabled={!playable}
                        onClick={() =>
                            openModal({
                                children: <MixPreview mix={mix} />,
                                title: `Preview "${mix.name}"`,
                            })
                        }
                    >
                        Preview
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                        onClick={() =>
                            openModal({
                                children: (
                                    <RenameMixForm
                                        mix={mix}
                                        onSubmit={(name) => renameMix(mix.id, name)}
                                    />
                                ),
                                title: 'Rename mix',
                            })
                        }
                    >
                        Rename
                    </DropdownMenu.Item>
                    <DropdownMenu.Item onClick={() => deleteMix(mix.id)}>Delete</DropdownMenu.Item>
                </DropdownMenu.Dropdown>
            </DropdownMenu>
        </div>
    );
};

const MixesRoute = () => {
    const mixes = useMixes();
    const connected = useHubConnected();
    const { saveMix } = useMixActions();
    const { windowBarStyle } = useWindowSettings();

    const openCreate = () =>
        openModal({
            children: <MixForm onSubmit={saveMix} />,
            title: 'New mix',
        });

    return (
        <AnimatedPage>
            <NativeScrollArea
                pageHeaderProps={{
                    backgroundColor: 'var(--theme-colors-background)',
                    children: (
                        <LibraryHeaderBar>
                            <LibraryHeaderBar.Title>Mixed for You</LibraryHeaderBar.Title>
                        </LibraryHeaderBar>
                    ),
                    offset: 200,
                }}
            >
                <LibraryContainer>
                    <Stack
                        gap="lg"
                        mb="5rem"
                        pt={windowBarStyle === Platform.WEB ? '5rem' : '3rem'}
                        px="2rem"
                    >
                        <Group justify="space-between">
                            <Text size="xl" weight={700}>
                                Mixed for You
                            </Text>
                            <Button disabled={!connected} onClick={openCreate} variant="filled">
                                New mix
                            </Button>
                        </Group>
                        {/* Not an error, and not a retry: the recipes live on the
                            hub, so with no hub there is nothing to show and
                            nothing this page could do about it. */}
                        {!connected ? (
                            <Text isMuted>
                                Mixes are stored on your navi-connect hub, so they are unavailable
                                while this device is not connected to it.
                            </Text>
                        ) : mixes.length === 0 ? (
                            <Text isMuted>
                                No mixes yet. A mix stores the recipe — the source, the seed and the
                                mood — rather than a fixed tracklist, so it is built again each time
                                you play it. Start something playing and press New mix.
                            </Text>
                        ) : (
                            <Stack gap="sm">
                                {mixes.map((mix) => (
                                    <MixRow key={mix.id} mix={mix} />
                                ))}
                            </Stack>
                        )}
                    </Stack>
                </LibraryContainer>
            </NativeScrollArea>
        </AnimatedPage>
    );
};

const MixesRouteWithBoundary = () => (
    <PageErrorBoundary>
        <Suspense fallback={<Spinner container />}>
            <MixesRoute />
        </Suspense>
    </PageErrorBoundary>
);

export default MixesRouteWithBoundary;
