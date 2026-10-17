import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { playArtistRadio } from '/@/renderer/features/player/station/station-client';
import { useArtistRadioCount, useCurrentServerId, usePlayButtonBehavior } from '/@/renderer/store';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { AlbumArtist, Artist } from '/@/shared/types/domain-types';
import { Play } from '/@/shared/types/types';

interface PlayArtistRadioActionProps {
    artist: AlbumArtist | Artist;
    disabled?: boolean;
}

export const PlayArtistRadioAction = ({ artist, disabled }: PlayArtistRadioActionProps) => {
    const artistRadioCount = useArtistRadioCount();
    const { t } = useTranslation();
    const player = usePlayer();
    const serverId = useCurrentServerId();
    const playButtonBehavior = usePlayButtonBehavior();

    const handlePlayArtistRadio = useCallback(
        async (playType: Play) => {
            if (!serverId || !artist) return;
            // navi-connect (B-149): the artist's own most played songs, then a station from them
            // (played now, with the engine) or Navidrome's similar songs.
            try {
                await playArtistRadio({
                    artist,
                    count: artistRadioCount,
                    player,
                    playType,
                    serverId,
                });
            } catch (error) {
                console.error('Failed to load artist radio:', error);
            }
        },
        [artist, artistRadioCount, player, serverId],
    );

    const handlePlayArtistRadioNow = useCallback(() => {
        handlePlayArtistRadio(Play.NOW);
    }, [handlePlayArtistRadio]);

    const handlePlayArtistRadioNext = useCallback(() => {
        handlePlayArtistRadio(Play.NEXT);
    }, [handlePlayArtistRadio]);

    const handlePlayArtistRadioLast = useCallback(() => {
        handlePlayArtistRadio(Play.LAST);
    }, [handlePlayArtistRadio]);

    const defaultPlayArtistRadioAction = useCallback(() => {
        handlePlayArtistRadio(playButtonBehavior);
    }, [handlePlayArtistRadio, playButtonBehavior]);

    return (
        <ContextMenu.Submenu>
            <ContextMenu.SubmenuTarget>
                <ContextMenu.Item
                    disabled={disabled}
                    leftIcon="radio"
                    onSelect={defaultPlayArtistRadioAction}
                    rightIcon="arrowRightS"
                >
                    {t('player.artistRadio')}
                </ContextMenu.Item>
            </ContextMenu.SubmenuTarget>
            <ContextMenu.SubmenuContent>
                <ContextMenu.Item leftIcon="mediaPlay" onSelect={handlePlayArtistRadioNow}>
                    {t('player.play')}
                </ContextMenu.Item>
                <ContextMenu.Item leftIcon="mediaPlayNext" onSelect={handlePlayArtistRadioNext}>
                    {t('player.addNext')}
                </ContextMenu.Item>
                <ContextMenu.Item leftIcon="mediaPlayLast" onSelect={handlePlayArtistRadioLast}>
                    {t('player.addLast')}
                </ContextMenu.Item>
            </ContextMenu.SubmenuContent>
        </ContextMenu.Submenu>
    );
};
