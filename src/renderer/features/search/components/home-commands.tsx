import { nanoid } from 'nanoid/non-secure';
import { Dispatch, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createSearchParams, generatePath, useNavigate } from 'react-router';

import { fetchClapAvailable } from '/@/renderer/features/player/auto-dj/audio-muse-source';
import { openCreatePlaylistModal } from '/@/renderer/features/playlists/components/create-playlist-form';
import { Command, CommandPalettePages } from '/@/renderer/features/search/components/command';
import { openClapSearchModal } from '/@/renderer/features/sonic/components/clap-search-modal';
import { AppRoute } from '/@/renderer/router/routes';
import { useAudioMuseSettings, useCurrentServer } from '/@/renderer/store';
import { LibraryItem } from '/@/shared/types/domain-types';

interface HomeCommandsProps {
    handleClose: () => void;
    pages: CommandPalettePages[];
    query: string;
    setPages: Dispatch<CommandPalettePages[]>;
    setQuery: Dispatch<string>;
}

export const HomeCommands = ({
    handleClose,
    pages,
    query,
    setPages,
    setQuery,
}: HomeCommandsProps) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const server = useCurrentServer();
    const audioMuse = useAudioMuseSettings();

    // CLAP text→mood search (AudioMuse Tier 2). Probe once so the command only
    // shows when it's actually usable (enabled + library analyzed); fail-soft.
    const [clapAvailable, setClapAvailable] = useState(false);
    useEffect(() => {
        let cancelled = false;
        void fetchClapAvailable(audioMuse).then((ok) => {
            if (!cancelled) setClapAvailable(ok);
        });
        return () => {
            cancelled = true;
        };
    }, [audioMuse]);

    const handleCreatePlaylistModal = useCallback(() => {
        handleClose();
        openCreatePlaylistModal(server);
    }, [handleClose, server]);

    const handleClapSearch = useCallback(() => {
        handleClose();
        openClapSearchModal();
    }, [handleClose]);

    const handleSearch = () => {
        navigate(
            {
                pathname: generatePath(AppRoute.SEARCH, { itemType: LibraryItem.SONG }),
                search: createSearchParams({
                    query,
                }).toString(),
            },
            {
                state: {
                    navigationId: nanoid(),
                },
            },
        );
        handleClose();
        setQuery('');
    };

    return (
        <>
            <Command.Group heading={t('page.globalSearch.title')}>
                <Command.Item onSelect={handleSearch} value={t('common.search')}>
                    {query
                        ? t('page.globalSearch.commands.searchFor', { query })
                        : `${t('common.search')}...`}
                </Command.Item>
                <Command.Item onSelect={handleCreatePlaylistModal}>
                    {t('action.createPlaylist')}...
                </Command.Item>
                {clapAvailable && (
                    <Command.Item
                        onSelect={handleClapSearch}
                        value={t('sonic.moodSearch', { defaultValue: 'Mood search' })}
                    >
                        {t('sonic.moodSearch', { defaultValue: 'Mood search' })}...
                    </Command.Item>
                )}
                <Command.Item onSelect={() => setPages([...pages, CommandPalettePages.GO_TO])}>
                    {t('page.globalSearch.commands.goToPage')}...
                </Command.Item>
                <Command.Item
                    onSelect={() => setPages([...pages, CommandPalettePages.MANAGE_SERVERS])}
                >
                    {t('page.globalSearch.commands.serverCommands')}
                    ...
                </Command.Item>
            </Command.Group>
        </>
    );
};
