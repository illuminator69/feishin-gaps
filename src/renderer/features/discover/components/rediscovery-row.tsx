import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { generatePath, useNavigate } from 'react-router';

import { DiscoverRow } from './discover-row';
import { DiscoverTile } from './discover-tile';

import { playlistsQueries } from '/@/renderer/features/playlists/api/playlists-api';
import { REDISCOVERY_PREFIX } from '/@/renderer/features/playlists/rediscovery-playlists';
import { AppRoute } from '/@/renderer/router/routes';
import { useCurrentServerId } from '/@/renderer/store';
import { LibraryItem, PlaylistListSort, SortOrder } from '/@/shared/types/domain-types';

/**
 * The rediscovery smart playlists, surfaced instead of buried.
 *
 * They already exist, they are already server-side Navidrome smart playlists so
 * every Subsonic client sees them, and their only entry point is a button on the
 * create-playlist form — after which they sit in the playlist list looking like
 * any other playlist. The `Rediscover: ` prefix was put there so a shelf could
 * filter on it; this is that shelf.
 *
 * Nothing here computes anything or calls lb-bot: it is Navidrome only, which is
 * why this is the one row with no capability gate. If the user has never pressed
 * the button there are no matching playlists and the row renders nothing —
 * which is honest, and better than advertising a set they have not opted into.
 */
export const RediscoveryRow = ({ title }: { title: string }) => {
    const navigate = useNavigate();
    const serverId = useCurrentServerId();

    const { data } = useQuery(
        playlistsQueries.list({
            options: { staleTime: 1000 * 60 * 5 },
            query: {
                sortBy: PlaylistListSort.NAME,
                sortOrder: SortOrder.ASC,
                startIndex: 0,
            },
            serverId,
        }),
    );

    const playlists = useMemo(
        () => (data?.items ?? []).filter((p) => p.name.startsWith(REDISCOVERY_PREFIX)),
        [data],
    );

    const cards = useMemo(
        () =>
            playlists.map((playlist) => ({
                content: (
                    <DiscoverTile
                        imageId={playlist.imageId ?? playlist.id}
                        imageUrl={playlist.imageUrl}
                        itemType={LibraryItem.PLAYLIST}
                        onClick={() =>
                            navigate(
                                generatePath(AppRoute.PLAYLISTS_DETAIL_SONGS, {
                                    playlistId: playlist.id,
                                }),
                            )
                        }
                        // The definition's own one-line description, written
                        // into the Navidrome playlist comment when it was
                        // created and never surfaced anywhere until now. It is a
                        // ready-made reason line, per playlist.
                        subtitle={playlist.description ?? undefined}
                        title={playlist.name.slice(REDISCOVERY_PREFIX.length)}
                    />
                ),
                id: playlist.id,
            })),
        [navigate, playlists],
    );

    return (
        <DiscoverRow
            because="Already in your library, and you have not played it in a long time"
            cards={cards}
            isEmpty={cards.length === 0}
            title={title}
        />
    );
};
