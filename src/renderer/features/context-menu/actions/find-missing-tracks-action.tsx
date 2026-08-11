import { useMemo } from 'react';

import { openGapFillModal } from '/@/renderer/features/lbbot/components/gap-fill-modal';
import {
    gapsByAlbumId,
    useHubSupports,
    useLbBotDiscography,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { Album } from '/@/shared/types/domain-types';

interface FindMissingTracksActionProps {
    album: Album | undefined;
}

/**
 * "Find 3 missing tracks" for an album the library holds only part of.
 *
 * It lives in the context menu rather than on the tile on purpose: tapping an
 * incomplete album opens the album, because the gap is the exception and not the
 * headline. Navic shipped it the other way round first and it was wrong.
 *
 * Renders nothing at all unless lb-bot knows this exact album is incomplete —
 * same fail-soft contract as the rest of the surface, only stricter: not
 * configured, unreachable, unindexed and complete all look identical from here.
 */
export const FindMissingTracksAction = ({ album }: FindMissingTracksActionProps) => {
    const artistId = album?.albumArtists?.[0]?.id ?? '';
    const discographyQuery = useLbBotDiscography(artistId);
    // A hub older than this app proxies no gap routes, and a 404 from an unknown
    // route is an ordinary HTTP response — so without asking, this would be a
    // menu entry that silently does nothing.
    const supported = useHubSupports('POST /lb/gap/search');

    const release = useMemo(
        () => (album ? gapsByAlbumId(discographyQuery.data).get(album.id) : undefined),
        [discographyQuery.data, album],
    );

    if (!album || !release?.groupId || !supported) return null;

    // lb-bot already knows the count, so the label says it rather than making the
    // user open a modal to find out whether it is worth opening.
    const missing = Math.max((release.totalTracks ?? 0) - (release.presentTracks ?? 0), 0);

    return (
        <ContextMenu.Item
            leftIcon="download"
            onSelect={() => openGapFillModal(album.name, release.groupId!, missing)}
        >
            {missing ? `Find ${missing} missing tracks` : 'Find missing tracks'}
        </ContextMenu.Item>
    );
};
