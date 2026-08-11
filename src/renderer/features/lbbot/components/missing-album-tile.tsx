import styles from './missing-album-tile.module.css';

import { openMissingAlbumModal } from '/@/renderer/features/lbbot/components/missing-album-modal';
import {
    caaCoverUrl,
    isAwaitingLibrary,
    useWatchedFill,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { Badge } from '/@/shared/components/badge/badge';
import { Progress } from '/@/shared/components/progress/progress';
import { Text } from '/@/shared/components/text/text';
import { LbBotFillState, LbBotRelease } from '/@/shared/types/lbbot-types';

interface MissingAlbumTileProps {
    artistName: string;
    ndArtistId: string;
    release: LbBotRelease;
}

const SHORT_STATE: Partial<Record<LbBotFillState, string>> = {
    downloading: 'Downloading',
    failed: 'Failed',
    needs_match: 'Needs review',
    placed: 'Placed',
    placing: 'Placing',
    queued: 'Queued',
    searching: 'Searching',
};

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
    const fill = useWatchedFill(release.rgid, ndArtistId);
    // lb-bot flips its index row to `present` the moment a fill is placed, well
    // before Navidrome has indexed anything — so a row that is no longer
    // `missing` but still has no album here is a download that worked, and must
    // not be captioned as absent.
    const label =
        (fill ? SHORT_STATE[fill.state] : undefined) ??
        (isAwaitingLibrary(release) ? 'Added — waiting for library' : undefined);

    return (
        <button
            className={styles.tile}
            onClick={() => openMissingAlbumModal(artistName, release)}
            type="button"
        >
            <div className={styles.frame}>
                <img
                    alt=""
                    className={styles.cover}
                    loading="lazy"
                    onError={(e) => {
                        // Plenty of release-groups have no Cover Art Archive
                        // front; the empty frame stands in for it.
                        e.currentTarget.style.visibility = 'hidden';
                    }}
                    src={caaCoverUrl(release.rgid)}
                />
                <Badge className={styles.badge} size="xs">
                    {label ?? 'Not in library'}
                </Badge>
                {fill && fill.percent > 0 && fill.percent < 100 && (
                    <Progress className={styles.progress} size="xs" value={fill.percent} />
                )}
            </div>
            <Text className={styles.name} size="sm">
                {release.title}
            </Text>
            <Text isMuted size="xs">
                {release.year}
            </Text>
        </button>
    );
};
