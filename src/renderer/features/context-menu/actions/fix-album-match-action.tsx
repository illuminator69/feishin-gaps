import { openAlbumMatchModal } from '/@/renderer/features/lbbot/components/album-match-modal';
import { useAlbumOverrideControls } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { Album } from '/@/shared/types/domain-types';
import { ServerType } from '/@/shared/types/types';

interface FixAlbumMatchActionProps {
    album: Album | undefined;
}

/**
 * "Fix album match…": tell lb-bot which MusicBrainz release this owned album is
 * (I-022). The album page's "more" button opens this same menu, so this one item
 * is both entry points of the contract.
 *
 * Renders nothing unless the hub advertises the write route and no answer has said
 * this lb-bot is older - the same fail-soft contract as the rest of the lb-bot
 * surface - and only on a Navidrome library, whose album ids lb-bot speaks.
 */
export const FixAlbumMatchAction = ({ album }: FixAlbumMatchActionProps) => {
    const controls = useAlbumOverrideControls();

    if (!album || !controls || album._serverType !== ServerType.NAVIDROME) return null;

    return (
        <ContextMenu.Item
            leftIcon="edit"
            onSelect={() =>
                openAlbumMatchModal({
                    albumId: album.id,
                    artistId: album.albumArtists?.[0]?.id,
                    title: album.name,
                })
            }
        >
            Fix album match…
        </ContextMenu.Item>
    );
};
