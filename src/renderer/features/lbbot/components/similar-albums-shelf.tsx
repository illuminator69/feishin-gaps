import { generatePath, useNavigate } from 'react-router';

import { useGridCarouselContainerQuery } from '/@/renderer/components/grid-carousel/grid-carousel-v2';
import { DiscoverRow } from '/@/renderer/features/discover/components/discover-row';
import { DiscoverTile } from '/@/renderer/features/discover/components/discover-tile';
import { useLbBotSimilarAlbums } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { useLibraryContextMenu } from '/@/renderer/features/shared/hooks/use-library-context-menu';
import { AppRoute } from '/@/renderer/router/routes';
import { LibraryItem } from '/@/shared/types/domain-types';

/**
 * "Similar albums" — the shelf DESIGN-lbbot-client-integration.md specified as
 * step 5. lb-bot's route, its two-source similarity engine, the hub whitelist and
 * the 24h cache back it.
 *
 * Every row is an album the library already holds, by an artist ListenBrainz
 * (cross-checked with Last.fm when a key is configured) puts near this one. So
 * it is a rediscovery surface, not a shopping list — which is why the tiles are
 * the library's own covers rather than the faded missing-album tiles.
 *
 * `because` is rendered, always. The attribution rule this stack follows is that
 * a recommendation names the thing that justifies it; an unattributed shelf is
 * indistinguishable from a popularity chart.
 *
 * It is one of the album page's carousels, after upstream's "More from" rows and
 * paged by the same container query, so its cards are theirs in size at every
 * width. It used to be a sideways-scrolling strip of its own whose covers grew
 * with how few albums it held (one album was a cover as wide as the page).
 *
 * Fail-soft in the usual way: no hub, lb-bot down, an unindexed library or
 * simply no similar artist in it all end at "render nothing".
 */

interface SimilarAlbumsShelfProps {
    artistMbid?: null | string;
    artistName?: null | string;
    containerQuery?: ReturnType<typeof useGridCarouselContainerQuery>;
    /** The album on screen, so lb-bot can leave it out and backfill the slot. */
    rgid?: null | string;
}

export const SimilarAlbumsShelf = ({
    artistMbid,
    artistName,
    containerQuery,
    rgid,
}: SimilarAlbumsShelfProps) => {
    const navigate = useNavigate();
    const openMenu = useLibraryContextMenu();
    const { data, isLoading } = useLbBotSimilarAlbums({ artistMbid, artistName, rgid });
    const albums = data?.albums ?? [];

    return (
        <DiscoverRow
            because={
                data?.because
                    ? `Because you're listening to ${data.because}`
                    : 'Albums in your library by artists near this one'
            }
            cards={albums.map((album) => ({
                content: (
                    <DiscoverTile
                        imageId={album.albumId || null}
                        // The library's cover by album id; lb-bot's URL only for a row
                        // it could not resolve to a library album.
                        imageUrl={album.albumId ? null : album.coverUrl}
                        itemType={LibraryItem.ALBUM}
                        // Straight to the library album. Every row here is a record
                        // the library already holds; the external page stays the
                        // fallback for a row lb-bot genuinely cannot resolve.
                        onClick={() =>
                            navigate(
                                album.albumId
                                    ? generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, {
                                          albumId: album.albumId,
                                      })
                                    : generatePath(AppRoute.EXTERNAL_ALBUM_DETAIL, {
                                          rgid: album.rgid,
                                      }),
                            )
                        }
                        onContextMenu={(event) =>
                            void openMenu(
                                event,
                                album.albumId ? { id: album.albumId, kind: 'album' } : null,
                            )
                        }
                        subtitle={album.artist}
                        title={album.title}
                    />
                ),
                id: album.rgid,
            }))}
            containerQuery={containerQuery}
            isEmpty={albums.length === 0}
            isLoading={isLoading}
            title="Similar albums"
        />
    );
};
