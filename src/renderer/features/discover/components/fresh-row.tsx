import { generatePath, useNavigate } from 'react-router';

import { DiscoverRow, discoverRowStyles as styles } from './discover-row';

import { useLbBotFreshReleases } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { externalAlbumPath } from '/@/renderer/features/lbbot/utils/external-paths';
import { AppRoute } from '/@/renderer/router/routes';
import { Text } from '/@/shared/components/text/text';

/** The Fresh feed as a row, which is what `DESIGN-lbbot-client-integration.md`
 *  specified in the first place — the whole tab came first and the row never
 *  followed. The tab stays: this is the glance, `/fresh` is the full feed with
 *  its filters.
 *
 *  Scoped to `artistOwned`, i.e. new records by artists you already listen to.
 *  That is the half with a real reason line; the site-wide half is a chart, and
 *  a chart belongs behind "See all" rather than at the top of Discover. The two
 *  scopes are never conflated — that rule is lb-bot's, enforced in its own
 *  route docstring. */
export const FreshRow = ({ title }: { title: string }) => {
    const navigate = useNavigate();
    const { data } = useLbBotFreshReleases(30);

    const releases = (data?.releases ?? []).filter((r) => r.artistOwned).slice(0, 20);

    return (
        <DiscoverRow
            because="New releases from artists already in your library"
            isEmpty={releases.length === 0}
            seeAll={{ label: 'See all', to: AppRoute.FRESH }}
            title={title}
        >
            {releases.map((release) => (
                <button
                    className={`${styles.tile} ${release.releaseOwned ? '' : styles.unowned}`}
                    key={`${release.releaseGroupMbid || release.releaseMbid}-${release.artist}`}
                    // An owned release opens the library album directly.
                    // `releaseAlbumId` exists precisely so a tile badged "in
                    // library" does not have to route through the virtual page
                    // and wait for its redirect — which cannot fire at all for
                    // an album lb-bot filled itself.
                    onClick={() =>
                        navigate(
                            release.releaseOwned && release.releaseAlbumId
                                ? generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, {
                                      albumId: release.releaseAlbumId,
                                  })
                                : externalAlbumPath(release),
                        )
                    }
                    type="button"
                >
                    <img
                        alt=""
                        className={styles.cover}
                        loading="lazy"
                        // Plenty of release-groups have no front cover, and an
                        // empty slot beats a broken-image icon.
                        onError={(e) => {
                            e.currentTarget.style.visibility = 'hidden';
                        }}
                        src={release.coverUrl}
                    />
                    <Text className={styles.name} size="sm">
                        {release.releaseName}
                    </Text>
                    <Text className={styles.name} isMuted size="sm">
                        {release.artist}
                    </Text>
                </button>
            ))}
        </DiscoverRow>
    );
};
