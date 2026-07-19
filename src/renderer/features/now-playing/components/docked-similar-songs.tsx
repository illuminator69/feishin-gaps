import { SimilarSongsList } from '/@/renderer/features/similar-songs/components/similar-songs-list';
import { usePlayerSong } from '/@/renderer/store';
import { ItemListKey } from '/@/shared/types/types';

/**
 * Related-songs list for the docked queue sheet. Same as the full-screen player's Related tab
 * ([FullScreenSimilarSongs]) but uses the side-queue column config. Renders nothing when nothing
 * is playing (there's no seed to derive from).
 */
export const DockedSimilarSongs = () => {
    const currentSong = usePlayerSong();

    return currentSong?.id ? (
        <div style={{ height: '100%', width: '100%' }}>
            <SimilarSongsList itemListKey={ItemListKey.SIDE_QUEUE} song={currentSong} />
        </div>
    ) : null;
};
