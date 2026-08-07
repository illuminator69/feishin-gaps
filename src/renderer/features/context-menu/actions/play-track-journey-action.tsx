import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '/@/renderer/api';
import { queryKeys } from '/@/renderer/api/query-keys';
import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { markNextQueueSource } from '/@/renderer/features/player/utils/saved-queue-source';
import {
    useArtistRadioCount,
    useCurrentServer,
    useCurrentServerId,
    usePlayerStore,
} from '/@/renderer/store';
import { hasFeature } from '/@/shared/api/utils';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { Song } from '/@/shared/types/domain-types';
import { ServerFeature } from '/@/shared/types/features-types';
import { Play } from '/@/shared/types/types';

interface PlayTrackJourneyActionProps {
    disabled?: boolean;
    song: Song;
}

// AudioMuse "Song Journey" (OpenSubsonic findSonicPath): build a queue that
// morphs from the currently-playing track to this one. Only shown when the
// AudioMuse plugin is present and a different track is already playing.
export const PlayTrackJourneyAction = ({ disabled, song }: PlayTrackJourneyActionProps) => {
    const { t } = useTranslation();
    const player = usePlayer();
    const server = useCurrentServer();
    const serverId = useCurrentServerId();
    const queryClient = useQueryClient();
    const radioCount = useArtistRadioCount();
    const currentSong = usePlayerStore((state) => state.getCurrentSong());

    const handleJourney = useCallback(async () => {
        if (!serverId || !currentSong || currentSong.id === song.id) return;

        try {
            const pathSongs = await queryClient.fetchQuery({
                queryFn: ({ signal }) =>
                    api.controller.getSonicPath({
                        apiClientProps: { serverId, signal },
                        query: {
                            count: radioCount,
                            endSongId: song.id,
                            startSongId: currentSong.id,
                        },
                    }),
                queryKey: queryKeys.player.fetch({ sonicPath: `${currentSong.id}:${song.id}` }),
            });

            if (pathSongs && pathSongs.length > 0) {
                markNextQueueSource('journey', song.name);
                player.addToQueueByData(pathSongs, Play.NOW);
            }
        } catch (error) {
            console.error('Failed to start sonic journey:', error);
        }
    }, [currentSong, player, queryClient, radioCount, serverId, song.id]);

    if (
        !hasFeature(server, ServerFeature.SONIC_SIMILARITY) ||
        !currentSong ||
        currentSong.id === song.id
    ) {
        return null;
    }

    return (
        <ContextMenu.Item disabled={disabled} leftIcon="arrowLeftRight" onSelect={handleJourney}>
            {t('player.sonicJourney', { defaultValue: 'Journey to this song' })}
        </ContextMenu.Item>
    );
};
