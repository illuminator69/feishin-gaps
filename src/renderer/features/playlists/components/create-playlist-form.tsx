import { useQuery } from '@tanstack/react-query';
import { t } from 'i18next';
import { MouseEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { playlistsQueries } from '/@/renderer/features/playlists/api/playlists-api';
import {
    PlaylistQueryBuilder,
    PlaylistQueryBuilderRef,
} from '/@/renderer/features/playlists/components/playlist-query-builder';
import { useAddToPlaylist } from '/@/renderer/features/playlists/mutations/add-to-playlist-mutation';
import { useCreatePlaylist } from '/@/renderer/features/playlists/mutations/create-playlist-mutation';
import { missingRediscoveryPlaylists } from '/@/renderer/features/playlists/rediscovery-playlists';
import { convertQueryGroupToNDQuery } from '/@/renderer/features/playlists/utils';
import { useCurrentServer } from '/@/renderer/store';
import { hasFeature } from '/@/shared/api/utils';
import { Group } from '/@/shared/components/group/group';
import { closeAllModals, openModal } from '/@/shared/components/modal/modal';
import { ModalButton } from '/@/shared/components/modal/model-shared';
import { Stack } from '/@/shared/components/stack/stack';
import { Switch } from '/@/shared/components/switch/switch';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { Textarea } from '/@/shared/components/textarea/textarea';
import { toast } from '/@/shared/components/toast/toast';
import { useForm } from '/@/shared/hooks/use-form';
import {
    CreatePlaylistBody,
    PlaylistListSort,
    ServerListItem,
    ServerType,
    Song,
    SongListSort,
    SortOrder,
} from '/@/shared/types/domain-types';
import { ServerFeature } from '/@/shared/types/features-types';

interface CreatePlaylistFormProps {
    onCancel: () => void;
    songs?: Song[];
}

export const CreatePlaylistForm = ({ onCancel, songs }: CreatePlaylistFormProps) => {
    const { t } = useTranslation();

    const createPlaylistMutation = useCreatePlaylist({});
    const addToPlaylistMutation = useAddToPlaylist({});

    const server = useCurrentServer();
    const queryBuilderRef = useRef<PlaylistQueryBuilderRef>(null);

    const form = useForm<CreatePlaylistBody>({
        initialValues: {
            comment: '',
            name: '',
            queryBuilderRules: undefined,
        },
    });
    const [isSmartPlaylist, setIsSmartPlaylist] = useState(false);
    const [step, setStep] = useState<1 | 2>(1);
    const [rediscoveryPending, setRediscoveryPending] = useState(false);

    // Existing playlist names, so the rediscovery set can be created
    // idempotently — matched by name, so pressing it twice leaves one copy of
    // each rather than two. Navidrome only: the rules are its criteria grammar.
    const isNavidrome = server?.type === ServerType.NAVIDROME;
    const playlistListQuery = useQuery({
        ...playlistsQueries.list({
            query: { sortBy: PlaylistListSort.NAME, sortOrder: SortOrder.ASC, startIndex: 0 },
            serverId: server?.id,
        }),
        enabled: Boolean(server?.id && isNavidrome),
    });

    /**
     * Create the four rediscovery smart playlists Navidrome will then keep
     * current by itself — so every client sees them, not just this one.
     *
     * Sequential rather than parallel: four `POST /api/playlist` calls fired at
     * once against Navidrome is needless, and reporting partial failure means
     * knowing which one failed.
     */
    const handleCreateRediscoverySet = async () => {
        if (!server) return;
        const existing = (playlistListQuery.data?.items ?? []).map((playlist) => playlist.name);
        const missing = missingRediscoveryPlaylists(existing);
        if (missing.length === 0) {
            toast.success({ message: 'The rediscovery playlists already exist' });
            return;
        }
        setRediscoveryPending(true);
        const failed: string[] = [];
        for (const definition of missing) {
            try {
                await createPlaylistMutation.mutateAsync({
                    apiClientProps: { serverId: server.id },
                    body: {
                        comment: definition.comment,
                        name: definition.name,
                        queryBuilderRules:
                            definition.rules as CreatePlaylistBody['queryBuilderRules'],
                    },
                });
            } catch {
                failed.push(definition.name);
            }
        }
        setRediscoveryPending(false);
        if (failed.length > 0) {
            toast.error({
                message: `Could not create: ${failed.join(', ')}`,
                title: t('error.genericError'),
            });
            return;
        }
        toast.success({ message: `Added ${missing.length} rediscovery playlists` });
        onCancel();
    };

    const isPrefilledPlaylist = !!songs && songs.length > 0;

    const handleSubmit = form.onSubmit((values) => {
        if (!server) return;

        // If creating a smart playlist and we're on the first step, advance to step 2
        // to configure the query instead of submitting immediately.
        if (isSmartPlaylist && step === 1) {
            setStep(2);
            return;
        }

        const smartPlaylist = queryBuilderRef.current?.getFilters();

        // New syntax: sortBy is now a single string with comma-separated fields and +/- prefix
        // e.g., "+album,-year" means sort by album ascending, then year descending
        const sortValue =
            isSmartPlaylist && smartPlaylist?.extraFilters?.sortBy?.[0]
                ? smartPlaylist.extraFilters.sortBy[0]
                : undefined;

        const rules =
            isSmartPlaylist && smartPlaylist?.filters
                ? {
                      ...convertQueryGroupToNDQuery(smartPlaylist.filters),
                      limit: smartPlaylist.extraFilters.limit,
                      limitPercent: smartPlaylist.extraFilters.limitPercent,
                      // order field is now optional - sort direction is embedded in sort field
                      sort: sortValue || '+dateAdded',
                  }
                : undefined;

        createPlaylistMutation.mutate(
            {
                apiClientProps: { serverId: server.id },
                body: {
                    ...values,
                    ...(rules ? { queryBuilderRules: rules } : {}),
                },
            },
            {
                onError: (err) => {
                    toast.error({
                        message: err.message,
                        title: t('error.genericError'),
                    });
                },
                onSuccess: (data) => {
                    toast.success({
                        message: t('form.createPlaylist.success'),
                    });

                    handlePlaylistPrefilling(data?.id);

                    onCancel();
                },
            },
        );
    });

    const handlePlaylistPrefilling = (playlistId?: string) => {
        if (!songs || !playlistId) {
            return;
        }

        const allSongIds = songs.map((song) => song.id);

        addToPlaylistMutation.mutate(
            {
                apiClientProps: { serverId: server.id },
                body: { songId: allSongIds },
                query: { id: playlistId },
            },
            {
                onError: (err) => {
                    toast.error({
                        message: `${err.message}`,
                        title: t('error.genericError'),
                    });
                },
            },
        );
    };

    const isPublicDisplayed = hasFeature(server, ServerFeature.PUBLIC_PLAYLIST);
    const isSubmitDisabled = !form.values.name || createPlaylistMutation.isPending;

    return (
        <form onSubmit={handleSubmit}>
            <Stack>
                {step === 1 && (
                    <>
                        <TextInput
                            data-autofocus
                            label={t('form.createPlaylist.input', {
                                context: 'name',
                            })}
                            required
                            {...form.getInputProps('name')}
                        />
                        {server?.type === ServerType.NAVIDROME && (
                            <Textarea
                                autosize
                                label={t('form.createPlaylist.input', {
                                    context: 'description',
                                })}
                                minRows={5}
                                {...form.getInputProps('comment')}
                            />
                        )}
                        <Group>
                            {isPublicDisplayed && (
                                <Switch
                                    label={t('form.createPlaylist.input', {
                                        context: 'public',
                                    })}
                                    {...form.getInputProps('public', {
                                        type: 'checkbox',
                                    })}
                                />
                            )}
                            {server?.type === ServerType.NAVIDROME &&
                                hasFeature(server, ServerFeature.PLAYLISTS_SMART) &&
                                !isPrefilledPlaylist && (
                                    <Switch
                                        checked={isSmartPlaylist}
                                        label="Is smart playlist?"
                                        onChange={(e) => {
                                            const next = e.currentTarget.checked;
                                            setIsSmartPlaylist(next);
                                            if (!next) {
                                                setStep(1);
                                            }
                                        }}
                                    />
                                )}
                        </Group>
                    </>
                )}

                {isSmartPlaylist && step === 2 && (
                    <Stack pt="1rem">
                        <Text>Query Editor</Text>
                        <PlaylistQueryBuilder
                            limit={undefined}
                            query={undefined}
                            ref={queryBuilderRef}
                            sortBy={[SongListSort.ALBUM]}
                            sortOrder="asc"
                        />
                    </Stack>
                )}

                {/* Four ready-made smart playlists for music already in the
                    library and rarely or never played — the one thing no
                    surface here does today. Opt-in, and idempotent by name. */}
                {isNavidrome && !isPrefilledPlaylist && step === 1 && (
                    <Stack gap="xs" pt="1rem">
                        <Text isMuted size="sm">
                            Or add the rediscovery set: never played, loved but stale, highly rated
                            and long unplayed, deep cuts. Navidrome keeps them current.
                        </Text>
                        <Group justify="flex-start">
                            <ModalButton
                                disabled={rediscoveryPending || playlistListQuery.isLoading}
                                loading={rediscoveryPending}
                                onClick={handleCreateRediscoverySet}
                                px="2xl"
                                uppercase
                                variant="subtle"
                            >
                                Add rediscovery set
                            </ModalButton>
                        </Group>
                    </Stack>
                )}

                <Group justify="flex-end">
                    {isSmartPlaylist && step === 2 && (
                        <ModalButton onClick={() => setStep(1)} px="2xl" uppercase variant="subtle">
                            Back
                        </ModalButton>
                    )}
                    <ModalButton onClick={onCancel} px="2xl" uppercase variant="subtle">
                        {t('common.cancel')}
                    </ModalButton>
                    <ModalButton
                        disabled={isSubmitDisabled}
                        loading={createPlaylistMutation.isPending}
                        type="submit"
                        variant="filled"
                    >
                        {isSmartPlaylist && step === 1 ? t('common.confirm') : t('common.create')}
                    </ModalButton>
                </Group>
            </Stack>
        </form>
    );
};

export const openCreatePlaylistModal = (
    server?: ServerListItem,
    e?: MouseEvent<HTMLButtonElement>,
) => {
    e?.stopPropagation();

    openModal({
        children: <CreatePlaylistForm onCancel={() => closeAllModals()} />,
        size: server?.type === ServerType?.NAVIDROME ? 'xl' : 'sm',
        title: t('form.createPlaylist.title'),
    });
};

export const openCreatePrefilledPlaylistModal = (
    server?: ServerListItem,
    songs?: Song[],
    e?: MouseEvent<HTMLButtonElement>,
) => {
    e?.stopPropagation();

    openModal({
        children: <CreatePlaylistForm onCancel={() => closeAllModals()} songs={songs} />,
        size: server?.type === ServerType?.NAVIDROME ? 'xl' : 'sm',
        title: t('form.createPrefilledPlaylist.title'),
    });
};
