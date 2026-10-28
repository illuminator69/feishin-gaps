import formatDuration from 'format-duration';
import { type KeyboardEvent, type MouseEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, Link } from 'react-router';

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
import {
    useRemoteAwarePlayerSong,
    useRemoteAwareStatus,
} from '/@/renderer/features/hub/hooks/use-remote-aware';
import { AppRoute } from '/@/renderer/router/routes';
import { ExplicitIndicator } from '/@/shared/components/explicit-indicator/explicit-indicator';
import { Icon } from '/@/shared/components/icon/icon';
import { Skeleton } from '/@/shared/components/skeleton/skeleton';
import { LibraryItem, Song } from '/@/shared/types/domain-types';
import { PlayerStatus } from '/@/shared/types/types';

// The artist page binds Enter to "play the selection" app-wide, and the hotkey hook prevents the
// default of every Enter it sees, so a focused button would never activate. The list keeps its keys.
const keepKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
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
    const current = useRemoteAwarePlayerSong();
    const status = useRemoteAwareStatus();
    const { rows, toggle } = visibleTracks({ expanded, initial, max, songs });

    return (
        <div className={styles.root} data-artist-track-list="">
            <ol className={styles.list}>
                {rows.map((song, index) => {
                    const active = current?.id === song.id;
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
    const albumPath = song.albumId
        ? generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: song.albumId })
        : null;

    return (
        <li
            className={styles.row}
            data-active={active || undefined}
            onContextMenu={openMenu}
            onDoubleClick={() => onPlay(song)}
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
                    onKeyDown={keepKeys}
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
                <span className={styles.title}>
                    {albumPath ? (
                        <Link className={styles.titleLink} onKeyDown={keepKeys} to={albumPath}>
                            {song.name}
                        </Link>
                    ) : (
                        song.name
                    )}
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
                onKeyDown={keepKeys}
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
