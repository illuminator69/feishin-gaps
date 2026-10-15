import { generatePath, useNavigate } from 'react-router';

import styles from './missing-album-tile.module.css';

import discoverStyles from '/@/renderer/features/discover/components/discover-row.module.css';
import { DiscoverTile } from '/@/renderer/features/discover/components/discover-tile';
import { AcquireButton } from '/@/renderer/features/lbbot/components/acquire-button';
import { openMissingAlbumModal } from '/@/renderer/features/lbbot/components/missing-album-modal';
import { SHORT_STATE } from '/@/renderer/features/lbbot/fill-vocabulary';
import {
    caaCoverUrl,
    isAwaitingLibrary,
    useWatchedFill,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { AppRoute } from '/@/renderer/router/routes';
import { Badge } from '/@/shared/components/badge/badge';
import { Progress } from '/@/shared/components/progress/progress';
import { LibraryItem } from '/@/shared/types/domain-types';
import { LbBotFillState, LbBotRelease } from '/@/shared/types/lbbot-types';

interface MissingAlbumTileProps {
    artistName: string;
    ndArtistId: string;
    release: LbBotRelease;
}

/**
 * One release lb-bot knows about that the library doesn't hold, rendered inside
 * the release-type section it belongs to rather than in a shelf of its own.
 *
 * Sitting next to the owned albums is the point: an artist's Albums section
 * should be that artist's albums, with the ones you have and the ones you don't
 * distinguished by how they look, not by which end of the page they're on. Hence
 * the faded cover and the dashed frame — the tile has to read as "absent" at a
 * glance or the section becomes a lie.
 */
export const MissingAlbumTile = ({ artistName, ndArtistId, release }: MissingAlbumTileProps) => {
    const navigate = useNavigate();
    const fill = useWatchedFill(release.rgid, ndArtistId);
    // A row that names a Navidrome album is not a download any more — the
    // library holds it, and the tile has to open it. This is the case lb-bot's
    // own fills produce: placement flips the index row to `present` and cannot
    // write the album ids, so until the backfill resolves them every such row
    // read as absent and the only thing a tap could offer was to fetch it again.
    const ownedAlbumId = release.navidromeAlbumIds[0];
    // lb-bot flips its index row to `present` the moment a fill is placed, well
    // before Navidrome has indexed anything — so a row that is no longer
    // `missing` but still has no album here is a download that worked, and must
    // not be captioned as absent.
    // From the ledger, which the app-root watcher keeps live — so a fill that
    // failed while this page was closed still shows its badge, and a settled
    // one keeps it until dismissed. Same words as the downloads view.
    const label =
        (fill ? SHORT_STATE[(fill.state || 'searching') as LbBotFillState] : undefined) ??
        (isAwaitingLibrary(release) ? 'Added — waiting for library' : undefined);
    const percent = fill?.percent ?? 0;

    // The app's card (DiscoverTile): the surface, padding and radius of the library cards
    // around it on an artist page, which this tile sat among without. The dashed, faded
    // cover still says the library does not have it.
    return (
        <DiscoverTile
            // Only on a row that is genuinely absent. An owned row's tap opens the
            // library album, and offering to fetch a record already on disk is the
            // trap this whole tile exists to avoid. A fill already in flight has its
            // own progress on the cover.
            action={
                !ownedAlbumId && (!fill || fill.settled) ? (
                    <AcquireButton
                        artist={artistName}
                        className={discoverStyles.action}
                        onReview={() => openMissingAlbumModal(artistName, release)}
                        rgid={release.rgid}
                        title={release.title}
                    />
                ) : undefined
            }
            badge={
                <>
                    <Badge className={styles.badge} size="xs">
                        {label ?? 'Not in library'}
                    </Badge>
                    {fill && !fill.settled && percent > 0 && percent < 100 && (
                        <Progress size="xs" value={percent} />
                    )}
                </>
            }
            imageUrl={caaCoverUrl(release.rgid)}
            isUnowned={!ownedAlbumId}
            itemType={LibraryItem.ALBUM}
            onClick={() =>
                ownedAlbumId
                    ? navigate(
                          generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, {
                              albumId: ownedAlbumId,
                          }),
                      )
                    : openMissingAlbumModal(artistName, release)
            }
            subtitle={release.year || undefined}
            title={release.title}
        />
    );
};
