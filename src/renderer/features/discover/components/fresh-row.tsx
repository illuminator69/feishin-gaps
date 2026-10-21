import clsx from 'clsx';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, useNavigate } from 'react-router';

import { DiscoverRow } from './discover-row';
import styles from './discover-row.module.css';
import { DiscoverTile } from './discover-tile';

import { AcquireButton } from '/@/renderer/features/lbbot/components/acquire-button';
import { useLbBotFreshReleases } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { externalAlbumPath } from '/@/renderer/features/lbbot/utils/external-paths';
import { useLibraryContextMenu } from '/@/renderer/features/shared/hooks/use-library-context-menu';
import { AppRoute } from '/@/renderer/router/routes';
import { LibraryItem } from '/@/shared/types/domain-types';

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
    const { t } = useTranslation();
    const navigate = useNavigate();
    const openMenu = useLibraryContextMenu();
    const { data, isLoading } = useLbBotFreshReleases(30);

    const releases = useMemo(
        () => (data?.releases ?? []).filter((r) => r.artistOwned).slice(0, 20),
        [data],
    );

    const cards = useMemo(
        () =>
            releases.map((release) => ({
                content: (
                    <DiscoverTile
                        // One tap to fetch it, but never blind: the control
                        // reviews lb-bot's ranked sources first and opens the
                        // picker whenever there is anything left to decide.
                        action={
                            release.releaseOwned ? undefined : (
                                <AcquireButton
                                    artist={release.artist}
                                    className={styles.action}
                                    onReview={() => navigate(externalAlbumPath(release))}
                                    rgid={release.releaseGroupMbid}
                                    title={release.releaseName}
                                />
                            )
                        }
                        badge={
                            <span
                                className={clsx(
                                    styles.ownedBadge,
                                    release.releaseOwned ? styles.owned : styles.notOwned,
                                )}
                                data-owned-badge={release.releaseOwned ? 'owned' : 'not-owned'}
                            >
                                {release.releaseOwned ? t('common.owned') : t('common.notOwned')}
                            </span>
                        }
                        badgePlacement="top-start"
                        imageUrl={release.coverUrl}
                        isUnowned={!release.releaseOwned}
                        itemType={LibraryItem.ALBUM}
                        // An owned release opens the library album directly.
                        // `releaseAlbumId` exists precisely so a tile badged "in
                        // library" does not have to route through the virtual
                        // page and wait for its redirect — which cannot fire at
                        // all for an album lb-bot filled itself.
                        onClick={() =>
                            navigate(
                                release.releaseOwned && release.releaseAlbumId
                                    ? generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, {
                                          albumId: release.releaseAlbumId,
                                      })
                                    : externalAlbumPath(release),
                            )
                        }
                        onContextMenu={(event) =>
                            void openMenu(
                                event,
                                release.releaseAlbumId
                                    ? { id: release.releaseAlbumId, kind: 'album' }
                                    : null,
                            )
                        }
                        subtitle={release.artist}
                        title={release.releaseName}
                    />
                ),
                id: `${release.releaseGroupMbid || release.releaseMbid}-${release.artist}`,
            })),
        [navigate, openMenu, releases, t],
    );

    return (
        <DiscoverRow
            because="New releases from artists already in your library"
            cards={cards}
            isEmpty={cards.length === 0}
            isLoading={isLoading}
            seeAll={{ label: 'See all', to: AppRoute.FRESH }}
            title={title}
        />
    );
};
