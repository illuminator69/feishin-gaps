import styles from './incomplete-album-badge.module.css';

import { gapIsBusy, gapProgress, useWatchedGap } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { Badge } from '/@/shared/components/badge/badge';
import { Progress } from '/@/shared/components/progress/progress';
import { LbBotRelease } from '/@/shared/types/lbbot-types';

interface IncompleteAlbumBadgeProps {
    ndArtistId: string;
    release: LbBotRelease;
}

/**
 * The `9/12` on an album the library holds only part of.
 *
 * A badge and nothing more, because the discography is one cohesive list per
 * release type: owned albums, count-badged incomplete ones, and greyed-out
 * unowned ones side by side. Tapping still opens the album — the gap action
 * lives in its context menu, since the gap is the exception rather than the
 * headline.
 *
 * It also carries the fill watch. A gap fill takes minutes and outlives the
 * modal that started it, so the shelf is what keeps polling and what refreshes
 * the page when the tracks land.
 */
export const IncompleteAlbumBadge = ({ ndArtistId, release }: IncompleteAlbumBadgeProps) => {
    const gap = useWatchedGap(release.groupId ?? '', ndArtistId);
    const progress = gapProgress(gap);
    // Busy, not `status === 'downloading'`: lb-bot flips the group's own status
    // well after the first track is queued, so gating on it left the tile silent
    // through the opening minutes of a fill.
    const filling = !!gap && gapIsBusy(gap) && progress.wanted > 0;

    const present = gap?.present ?? release.presentTracks ?? 0;
    const total = gap?.total ?? release.totalTracks ?? 0;
    const missing = Math.max(total - present, 0);
    if (!total || !missing) return null;

    return (
        <>
            {/* Says the number that matters rather than the ratio it can be
                derived from: the question this badge exists to answer is "which
                albums am I short of tracks on, and by how many". */}
            <Badge className={styles.badge} size="xs" variant="filled">
                {filling ? `${progress.done}/${progress.wanted} filling` : `${missing} missing`}
            </Badge>
            {filling && <Progress className={styles.progress} size="xs" value={progress.percent} />}
        </>
    );
};
