import formatDuration from 'format-duration';
import { type KeyboardEvent, type MouseEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './artist-track-list.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import equalizer from '/@/renderer/components/item-list/item-table-list/columns/row-index-column.module.css';
import {
    JOINED_ARTISTS_MUTED_PROPS,
    JoinedArtists,
} from '/@/renderer/features/albums/components/joined-artists';
import {
    hasOtherArtists,
    visibleTracks,
} from '/@/renderer/features/artists/artist-track-list-model';
import { ContextMenuController } from '/@/renderer/features/context-menu/context-menu-controller';
import { useRemoteAwareStatus } from '/@/renderer/features/hub/hooks/use-remote-aware';
import { useDragDrop } from '/@/renderer/hooks/use-drag-drop';
import { useHubIsRemoteActive, useHubRemoteNowPlaying, usePlayerSong } from '/@/renderer/store';
import { ExplicitIndicator } from '/@/shared/components/explicit-indicator/explicit-indicator';
import { Icon } from '/@/shared/components/icon/icon';
import { Skeleton } from '/@/shared/components/skeleton/skeleton';
import { LibraryItem, Song } from '/@/shared/types/domain-types';
import { DragOperation, DragTarget } from '/@/shared/types/drag-and-drop';
import { PlayerStatus } from '/@/shared/types/types';

// The artist page binds Enter to "play the selection" app-wide, and the hotkey hook prevents the
// default of every Enter it sees, so a focused button or link would never activate. The list keeps
// its keys: the toggle here, and every control inside a row through the row's own handler.
const keepKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
};

/**
 * The playing song's id, the remote session's while another device plays (as the player bar shows
 * it). Only the id: `useRemoteAwarePlayerSong` would also resolve the remote song's detail.
 */
const usePlayingId = (): string | undefined => {
    const isRemote = useHubIsRemoteActive();
    const local = usePlayerSong();
    const remote = useHubRemoteNowPlaying();
    return isRemote && remote ? remote.id : local?.id;
};

interface ArtistTrackListProps {
    /** The page's artist: a row shows its artists on a second line only when someone else is credited. */
    artistId?: string;
    initial?: number;
    max?: number;
    /** Plays from that row; the caller decides the queue (the whole list, as the table did). */
    onPlay: (song: Song) => void;
    songs: Song[];
}

/**
 * The artist page's compact track list (R10, B-218), Spotify's Popular: number (an equaliser on the
 * playing row, a play button on hover), a 40 px cover, the title with the other artists under it, the
 * play count when there is one, the duration and the row menu. Its own columns: nothing here reads
 * the Songs library's table settings, so the library's columns and filters never reach it. Folded
 * to `initial` rows, "See more" shows up to `max`.
 */
export const ArtistTrackList = ({
    artistId,
    initial = 5,
    max = 10,
    onPlay,
    songs,
}: ArtistTrackListProps) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const playingId = usePlayingId();
    const status = useRemoteAwareStatus();
    const { rows, toggle } = visibleTracks({ expanded, initial, max, songs });

    return (
        <div className={styles.root} data-artist-track-list="">
            <ol className={styles.list}>
                {rows.map((song, index) => {
                    const active = playingId === song.id;
                    return (
                        <TrackRow
                            active={active}
                            artistId={artistId}
                            index={index}
                            key={song.id}
                            onPlay={onPlay}
                            playing={active && status === PlayerStatus.PLAYING}
                            song={song}
                        />
                    );
                })}
            </ol>
            {toggle && (
                <button
                    className={styles.toggle}
                    onClick={() => setExpanded(toggle === 'more')}
                    onKeyDown={keepKeys}
                    type="button"
                >
                    {toggle === 'more'
                        ? t('page.albumArtistDetail.seeMore')
                        : t('page.albumArtistDetail.showLess')}
                </button>
            )}
        </div>
    );
};

interface TrackRowProps {
    active: boolean;
    artistId?: string;
    index: number;
    onPlay: (song: Song) => void;
    playing: boolean;
    song: Song;
}

const TrackRow = ({ active, artistId, index, onPlay, playing, song }: TrackRowProps) => {
    const { t } = useTranslation();
    const openMenu = (event: MouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        ContextMenuController.call({ cmd: { items: [song], type: LibraryItem.SONG }, event });
    };
    // The row drags its song, as the library table's rows and the album tiles below it do: onto the
    // queue (which takes a SONG drop) or a sidebar playlist (any ADD drop). One song, no selection.
    const drag = useMemo(
        () => ({
            getId: () => [song.id],
            getItem: () => [song],
            itemType: LibraryItem.SONG,
            operation: [DragOperation.ADD],
            target: DragTarget.SONG,
        }),
        [song],
    );
    const { isDragging, ref } = useDragDrop<HTMLLIElement>({ drag, isEnabled: true });
    // The row is focusable and Enter on it plays from it (the table's Enter). A key on a control
    // inside (play, the artist links, the menu) is that control's, kept from the page's hotkey.
    const onKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
        if (event.target !== event.currentTarget) {
            keepKeys(event);
            return;
        }
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        onPlay(song);
    };

    return (
        <li
            className={styles.row}
            data-active={active || undefined}
            data-dragging={isDragging || undefined}
            onContextMenu={openMenu}
            onDoubleClick={() => onPlay(song)}
            onKeyDown={onKeyDown}
            ref={ref}
            tabIndex={0}
        >
            <div className={styles.index}>
                {active ? (
                    <span
                        aria-hidden
                        className={`${equalizer.equalizer} ${styles.mark}`}
                        data-playing={playing || undefined}
                    >
                        <span />
                        <span />
                        <span />
                    </span>
                ) : (
                    <span className={styles.mark}>{index + 1}</span>
                )}
                <button
                    aria-label={t('page.albumArtistDetail.playSong', { title: song.name })}
                    className={styles.play}
                    onClick={() => onPlay(song)}
                    onDoubleClick={(event) => event.stopPropagation()}
                    type="button"
                >
                    <Icon fill="default" icon="mediaPlay" />
                </button>
            </div>
            <ItemImage
                blurHash={song.blurHash}
                className={styles.coverImage}
                containerClassName={styles.cover}
                explicitStatus={song.explicitStatus}
                id={song.imageId}
                itemType={LibraryItem.SONG}
                serverId={song._serverId}
                src={song.imageUrl}
                thumbHash={song.thumbHash}
                type="table"
            />
            <div className={styles.text}>
                {/* Plain text, as the table's title was: a link here would take the first click of a
                    double-click and open the album instead of playing ("Go to album" is in the menu). */}
                <span className={styles.title}>
                    {song.name}
                    <ExplicitIndicator explicitStatus={song.explicitStatus} />
                </span>
                {hasOtherArtists(song.artists, artistId) && (
                    <span className={styles.artists}>
                        <JoinedArtists
                            artistName={song.artistName}
                            artists={song.artists}
                            {...JOINED_ARTISTS_MUTED_PROPS}
                        />
                    </span>
                )}
            </div>
            <span className={styles.plays}>
                {song.playCount > 0 ? song.playCount.toLocaleString() : ''}
            </span>
            <span className={styles.duration}>{formatDuration(song.duration)}</span>
            <button
                aria-label={t('page.albumArtistDetail.songMenu', { title: song.name })}
                className={styles.more}
                onClick={openMenu}
                onDoubleClick={(event) => event.stopPropagation()}
                type="button"
            >
                <Icon icon="ellipsisHorizontal" />
            </button>
        </li>
    );
};

/** The list's shape while its songs load: the rows it will most likely show, so nothing jumps. */
export const ArtistTrackListSkeleton = ({ rows = 5 }: { rows?: number }) => (
    <div aria-hidden className={styles.root}>
        <div className={styles.list}>
            {Array.from({ length: rows }, (_, index) => (
                <div className={styles.row} key={index}>
                    <span className={styles.index} />
                    <Skeleton className={styles.cover} enableAnimation height={40} width={40} />
                    <Skeleton enableAnimation height="0.9rem" width={`${60 - index * 6}%`} />
                </div>
            ))}
        </div>
    </div>
);
