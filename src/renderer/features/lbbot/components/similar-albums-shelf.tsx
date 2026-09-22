import { generatePath, useNavigate } from 'react-router';

import styles from './similar-albums-shelf.module.css';

import { useLbBotSimilarAlbums } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { AppRoute } from '/@/renderer/router/routes';
import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';

/**
 * "Similar albums" — the shelf DESIGN-lbbot-client-integration.md specified as
 * step 5 and nobody ever built. lb-bot's route, its two-source similarity
 * engine, the hub whitelist and the 24h cache have all been shipped and unused.
 *
 * Every row is an album the library already holds, by an artist ListenBrainz
 * (cross-checked with Last.fm when a key is configured) puts near this one. So
 * it is a rediscovery surface, not a shopping list — which is why the tiles look
 * like albums you own rather than like the faded missing-album tiles.
 *
 * `because` is rendered, always. The attribution rule this stack follows is that
 * a recommendation names the thing that justifies it; an unattributed shelf is
 * indistinguishable from a popularity chart.
 *
 * Fail-soft in the usual way: no hub, lb-bot down, an unindexed library or
 * simply no similar artist in it all end at "render nothing".
 */

interface SimilarAlbumsShelfProps {
    artistMbid?: null | string;
    artistName?: null | string;
    /** The album on screen, so lb-bot can leave it out and backfill the slot. */
    rgid?: null | string;
}

export const SimilarAlbumsShelf = ({ artistMbid, artistName, rgid }: SimilarAlbumsShelfProps) => {
    const navigate = useNavigate();
    const { data } = useLbBotSimilarAlbums({ artistMbid, artistName, rgid });
    const albums = data?.albums ?? [];

    if (albums.length === 0) return null;

    return (
        <Stack gap="sm">
            <Stack gap={0}>
                <TextTitle fw={700} order={3}>
                    Similar albums
                </TextTitle>
                {data?.because && (
                    <Text isMuted size="sm">
                        {`Because you're listening to ${data.because}`}
                    </Text>
                )}
            </Stack>
            <div className={styles.shelf}>
                {albums.map((album) => (
                    <button
                        className={styles.tile}
                        key={album.rgid}
                        // Straight to the library album. Every row here is a
                        // record the library already holds, so the external page
                        // was always the wrong destination — it was used only
                        // because the row carried no Navidrome album id, and its
                        // redirect cannot fire when lb-bot's index row has no id
                        // either. The result was a fully-downloaded album opening
                        // its own download page. lb-bot sends `albumId` now; the
                        // external page stays as the fallback for a row it
                        // genuinely cannot resolve.
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
                        type="button"
                    >
                        <img alt="" className={styles.cover} loading="lazy" src={album.coverUrl} />
                        <Text className={styles.name} size="sm">
                            {album.title}
                        </Text>
                        <Text className={styles.name} isMuted size="sm">
                            {album.artist}
                        </Text>
                    </button>
                ))}
            </div>
        </Stack>
    );
};
