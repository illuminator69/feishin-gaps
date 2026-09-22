import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { generatePath, useNavigate } from 'react-router';

import { DiscoverRow } from './discover-row';
import { DiscoverTile } from './discover-tile';

import { playlistsQueries } from '/@/renderer/features/playlists/api/playlists-api';
import { AppRoute } from '/@/renderer/router/routes';
import { useCurrentServerId } from '/@/renderer/store';
import { LibraryItem, PlaylistListSort, SortOrder } from '/@/shared/types/domain-types';

/**
 * ListenBrainz's Daily Jams, Weekly Jams and Weekly Exploration, which arrive as
 * ordinary Navidrome playlists and had nowhere to be seen.
 *
 * The `listenbrainz-daily-playlist` plugin writes them server-side, so every
 * Subsonic client already has them — this row costs **no** backend code, no
 * lb-bot route and no capability probe. It is a name filter, exactly like the
 * rediscovery row, and it shares that row's react-query cache entry: the query
 * args here are byte-identical on purpose, so two rows are one fetch.
 *
 * Two things that are different from `Rediscover: ` and worth knowing before
 * changing anything here:
 *
 * 1. **This app does not control the naming.** It mints the rediscovery
 *    playlists itself and can rely on their prefix; these come from someone
 *    else's plugin, so the prefix is an observation rather than a contract.
 *    Confirmed against the live server on 2026-09-23: "ListenBrainz Daily Jams",
 *    "ListenBrainz Weekly Jams", "ListenBrainz Weekly Exploration". If the
 *    plugin ever renames them the row goes quiet rather than wrong, which is the
 *    right failure.
 * 2. **They depend on the library's tags carrying MBIDs**, because the plugin
 *    matches on them. A library without them produces no playlists and this row
 *    renders nothing — the same honest empty as the rediscovery row.
 */

/** Also written down in `navi-connect/CLAUDE.md` §6, with the row ids. */
export const LISTENBRAINZ_PREFIX = 'ListenBrainz ';

export const ListenBrainzRow = ({ title }: { title: string }) => {
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
        () => (data?.items ?? []).filter((p) => p.name.startsWith(LISTENBRAINZ_PREFIX)),
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
                        subtitle={playlist.description ?? undefined}
                        // "Daily Jams" rather than "ListenBrainz Daily Jams":
                        // the row header already says where they come from, and
                        // repeating it in every tile costs the tile its title.
                        title={playlist.name.slice(LISTENBRAINZ_PREFIX.length)}
                    />
                ),
                id: playlist.id,
            })),
        [navigate, playlists],
    );

    return (
        <DiscoverRow
            because="Built for you from what you listen to, and refreshed by ListenBrainz"
            cards={cards}
            isEmpty={cards.length === 0}
            title={title}
        />
    );
};
