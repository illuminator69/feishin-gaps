import { FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './clap-search-modal.module.css';

import { api } from '/@/renderer/api';
import { ClapResult, fetchClapSearch } from '/@/renderer/features/player/auto-dj/audio-muse-source';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { markNextQueueSource } from '/@/renderer/features/player/utils/saved-queue-source';
import { useAudioMuseSettings, useCurrentServerId } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { closeAllModals, openModal } from '/@/shared/components/modal/modal';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { Song } from '/@/shared/types/domain-types';
import { Play } from '/@/shared/types/types';

const CLAP_LIMIT = 100;

// Resolve CLAP result ids to full Songs so they can be queued (the search only
// returns id + display fields). Order-preserving; drops ids the server can't
// resolve. Mirrors use-auto-dj's resolveSongsByIds.
const resolveSongs = async (serverId: string, ids: string[]): Promise<Song[]> => {
    const songs = await Promise.all(
        ids.map((id) =>
            api.controller
                .getSongDetail({ apiClientProps: { serverId }, query: { id } })
                .catch(() => null),
        ),
    );
    return songs.filter((song): song is Song => Boolean(song));
};

const ClapSearchModal = () => {
    const { t } = useTranslation();
    const player = usePlayer();
    const serverId = useCurrentServerId();
    const audioMuse = useAudioMuseSettings();

    const [query, setQuery] = useState('');
    const [isSearching, setIsSearching] = useState(false);
    const [isQueuing, setIsQueuing] = useState(false);
    const [results, setResults] = useState<ClapResult[] | null>(null);

    const handleSearch = async (e?: FormEvent) => {
        e?.preventDefault();
        if (!query.trim() || isSearching) return;
        setIsSearching(true);
        try {
            const found = await fetchClapSearch(audioMuse, query, CLAP_LIMIT);
            setResults(found);
        } finally {
            setIsSearching(false);
        }
    };

    const playResults = async (type: Play.LAST | Play.NOW) => {
        if (!serverId || !results || results.length === 0 || isQueuing) return;
        setIsQueuing(true);
        try {
            const songs = await resolveSongs(
                serverId,
                results.map((r) => r.id),
            );
            if (songs.length === 0) {
                toast.warn({
                    message: t('common.noResultsFound', { postProcess: 'sentenceCase' }),
                });
                return;
            }
            if (type === Play.NOW) markNextQueueSource('moodFlow', query.trim() || undefined);
            player.addToQueueByData(songs, type);
            closeAllModals();
        } finally {
            setIsQueuing(false);
        }
    };

    const isEmpty = results !== null && results.length === 0;

    return (
        <form onSubmit={handleSearch}>
            <Stack>
                <Group gap="sm" wrap="nowrap">
                    <TextInput
                        autoFocus
                        onChange={(e) => setQuery(e.currentTarget.value)}
                        placeholder={t('sonic.clapPlaceholder', {
                            defaultValue: 'Describe a mood, e.g. "rainy late-night drive"',
                        })}
                        style={{ flex: 1 }}
                        value={query}
                    />
                    <Button disabled={!query.trim() || isSearching} type="submit" variant="filled">
                        {isSearching ? <Spinner /> : <Icon icon="search" />}
                    </Button>
                </Group>

                {results !== null && (
                    <ScrollArea className={styles.results}>
                        {isEmpty ? (
                            <Text isMuted>
                                {t('sonic.clapNoResults', {
                                    defaultValue:
                                        'No matches. CLAP search may be disabled or your library is not yet analyzed.',
                                })}
                            </Text>
                        ) : (
                            <Stack gap="xs">
                                {results.map((r) => (
                                    <Group gap="sm" key={r.id} wrap="nowrap">
                                        <Text className={styles.title} overflow="hidden">
                                            {r.title || r.id}
                                        </Text>
                                        <Text isMuted overflow="hidden" size="sm">
                                            {r.author}
                                        </Text>
                                    </Group>
                                ))}
                            </Stack>
                        )}
                    </ScrollArea>
                )}

                {results !== null && !isEmpty && (
                    <Group gap="sm" justify="end">
                        <Button
                            disabled={isQueuing}
                            onClick={() => playResults(Play.LAST)}
                            variant="default"
                        >
                            {t('player.addLast', { postProcess: 'sentenceCase' })}
                        </Button>
                        <Button
                            disabled={isQueuing}
                            onClick={() => playResults(Play.NOW)}
                            variant="filled"
                        >
                            {t('player.play', { postProcess: 'sentenceCase' })}
                        </Button>
                    </Group>
                )}
            </Stack>
        </form>
    );
};

export const openClapSearchModal = () => {
    openModal({
        children: <ClapSearchModal />,
        size: 'lg',
        title: 'Mood search',
    });
};
