import { refreshAlbumMeta, useLbBotAvailable } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { ContextMenu } from '/@/shared/components/context-menu/context-menu';
import { toast } from '/@/shared/components/toast/toast';
import { Album } from '/@/shared/types/domain-types';

interface RefreshAboutActionProps {
    album: Album | undefined;
}

/**
 * navi-connect: ask lb-bot to read an album's About again. It was a text button of its
 * own between the album page's description and its tracklist; an action on one album
 * belongs in that album's menu, beside "Fix album match…". The outcome is a toast, in
 * lb-bot's words: the menu has closed by the time it answers.
 */
export const RefreshAboutAction = ({ album }: RefreshAboutActionProps) => {
    const available = useLbBotAvailable();

    if (!album || !available || !album.mbzReleaseGroupId) return null;

    return (
        <ContextMenu.Item
            leftIcon="refresh"
            onSelect={async () => {
                const outcome = await refreshAlbumMeta(album.mbzReleaseGroupId, album.mbzId);
                if (outcome.ok) toast.success({ message: outcome.message });
                else toast.warn({ message: outcome.message });
            }}
        >
            Refresh About
        </ContextMenu.Item>
    );
};
