import { ReactNode } from 'react';
import { generatePath, Link } from 'react-router';

import styles from './listening.module.css';

import { MissingAlbumTile } from '/@/renderer/features/lbbot/components/missing-album-tile';
import {
    externalAlbumPathFor,
    externalArtistPath,
} from '/@/renderer/features/lbbot/utils/external-paths';
import {
    AlbumTarget,
    albumTarget,
    ArtistTarget,
    artistTarget,
    formatListeningTime,
    genresNote,
    heatmapGrid,
    hoursBars,
    listeningTimeNote,
    unownedAlbumRelease,
} from '/@/renderer/features/listening/listening-logic';
import { AppRoute } from '/@/renderer/router/routes';
import { Button } from '/@/shared/components/button/button';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import {
    LbBotListeningSummary,
    LbBotRecentRow,
    LbBotUnownedRow,
} from '/@/shared/types/lbbot-types';

/**
 * The sections of the My Listening screen. Each renders only fields of lb-bot's
 * response; rows link OUT (library page when owned, the virtual page when not)
 * and never start a download — the one acquire control is the shared
 * missing-album tile's own, behind its review step.
 */

const artistPath = (target: ArtistTarget, name?: string): string | undefined =>
    target?.kind === 'library'
        ? generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, { albumArtistId: target.id })
        : target?.kind === 'external'
          ? externalArtistPath(target.mbid, name)
          : undefined;

const albumPath = (
    target: AlbumTarget,
    hints: { artist?: string; artistMbid?: string; title?: string },
): string | undefined =>
    target?.kind === 'library'
        ? generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: target.id })
        : target?.kind === 'external'
          ? externalAlbumPathFor({ ...hints, rgid: target.rgid })
          : undefined;

const MaybeLink = ({ children, to }: { children: ReactNode; to?: string }) =>
    to ? (
        <Text className={styles.clip} component={Link} isLink size="sm" to={to}>
            {children}
        </Text>
    ) : (
        <Text className={styles.clip} size="sm">
            {children}
        </Text>
    );

export const Section = ({
    children,
    note,
    title,
}: {
    children: ReactNode;
    note?: string;
    title: string;
}) => (
    <Stack gap="sm">
        <Text size="lg" weight={700}>
            {title}
        </Text>
        {note && (
            <Text isMuted size="xs">
                {note}
            </Text>
        )}
        {children}
    </Stack>
);

const Tile = ({ label, note, value }: { label: string; note?: string; value: string }) => (
    <div className={styles.tile}>
        <Text isMuted size="xs">
            {label}
        </Text>
        <Text size="xl" weight={700}>
            {value}
        </Text>
        {note && (
            <Text isMuted size="xs">
                {note}
            </Text>
        )}
    </div>
);

export const StatTiles = ({ summary }: { summary: LbBotListeningSummary }) => {
    const { streak, totals } = summary;
    return (
        <div className={styles.tiles}>
            <Tile label="Plays" value={totals.plays.toLocaleString()} />
            <Tile
                label="Listening time"
                note={listeningTimeNote(totals)}
                value={formatListeningTime(totals.seconds)}
            />
            <Tile label="Artists" value={totals.artists.toLocaleString()} />
            <Tile label="Albums" value={totals.albums.toLocaleString()} />
            <Tile label="Current streak" value={`${streak.current} d`} />
            <Tile label="Longest streak" value={`${streak.longest} d`} />
        </div>
    );
};

export const Heatmap = ({ summary }: { summary: LbBotListeningSummary }) => {
    const { columns } = heatmapGrid(summary.heatmap);
    if (columns.length === 0) return null;
    return (
        <Section note="Plays per day, the last 16 weeks." title="Activity">
            <div className={styles.heatmap}>
                {columns.flatMap((week, w) =>
                    week.map((cell, d) =>
                        cell ? (
                            <div
                                className={styles.cell}
                                data-level={cell.level}
                                key={cell.date}
                                title={`${cell.date}: ${cell.count} ${cell.count === 1 ? 'play' : 'plays'}`}
                            />
                        ) : (
                            <div className={`${styles.cell} ${styles.pad}`} key={`pad-${w}-${d}`} />
                        ),
                    ),
                )}
            </div>
        </Section>
    );
};

export const HoursChart = ({ summary }: { summary: LbBotListeningSummary }) => {
    const bars = hoursBars(summary.hours);
    return (
        <Section note="Plays by hour of the day, in your time zone." title="When you listen">
            <div className={styles.hours}>
                {bars.map((bar) => (
                    <div
                        className={styles.bar}
                        key={bar.hour}
                        style={{ height: `${Math.round(bar.ratio * 100)}%` }}
                        title={`${String(bar.hour).padStart(2, '0')}:00 — ${bar.count} plays`}
                    />
                ))}
            </div>
            <div className={styles.hourLabels}>
                {bars.map((bar) => (
                    <Text isMuted key={bar.hour} size="xs">
                        {bar.hour % 6 === 0 ? bar.hour : ''}
                    </Text>
                ))}
            </div>
        </Section>
    );
};

const RankRow = ({
    children,
    plays,
    rank,
    sub,
}: {
    children: ReactNode;
    plays: number;
    rank: number;
    sub?: string;
}) => (
    <div className={styles.row}>
        <Text isMuted size="sm">
            {rank}
        </Text>
        <Stack gap={0}>
            {children}
            {sub && (
                <Text className={styles.clip} isMuted size="xs">
                    {sub}
                </Text>
            )}
        </Stack>
        <Text isMuted size="sm">
            {plays.toLocaleString()}
        </Text>
    </div>
);

export const TopLists = ({ summary }: { summary: LbBotListeningSummary }) => (
    <div className={styles.columns}>
        <Section title="Top artists">
            {summary.topArtists.map((artist, i) => (
                <RankRow key={`${artist.mbid}-${artist.name}`} plays={artist.plays} rank={i + 1}>
                    <MaybeLink
                        to={artistPath(artistTarget(artist.ndArtistId, artist.mbid), artist.name)}
                    >
                        {artist.name}
                    </MaybeLink>
                </RankRow>
            ))}
        </Section>
        <Section title="Top albums">
            {summary.topAlbums.map((album, i) => (
                <RankRow
                    key={`${album.rgid}-${album.title}`}
                    plays={album.plays}
                    rank={i + 1}
                    sub={album.owned ? album.artist : `${album.artist} · not in your library`}
                >
                    <MaybeLink
                        to={albumPath(albumTarget(album.ndAlbumId, album.rgid), {
                            artist: album.artist,
                            artistMbid: album.artistMbid,
                            title: album.title,
                        })}
                    >
                        {album.title}
                    </MaybeLink>
                </RankRow>
            ))}
        </Section>
        <Section title="Top tracks">
            {summary.topTracks.map((track, i) => (
                <RankRow
                    key={`${track.recordingMbid}-${track.title}-${i}`}
                    plays={track.plays}
                    rank={i + 1}
                    sub={track.artist}
                >
                    <MaybeLink
                        to={albumPath(albumTarget(track.ndAlbumId, track.rgid), {
                            artist: track.artist,
                        })}
                    >
                        {track.title}
                    </MaybeLink>
                </RankRow>
            ))}
        </Section>
    </div>
);

export const Genres = ({ summary }: { summary: LbBotListeningSummary }) => {
    if (summary.genres.length === 0) return null;
    const max = summary.genres.reduce((m, g) => Math.max(m, g.plays), 0);
    return (
        <Section note={genresNote(summary.genrePlays, summary.totals.plays)} title="Genres">
            {summary.genres.map((genre) => (
                <div className={styles.row} key={genre.genre}>
                    <span />
                    <Stack gap={2}>
                        <Text className={styles.clip} size="sm">
                            {genre.genre}
                        </Text>
                        <div
                            className={styles.bar}
                            style={{ height: 4, width: `${max ? (genre.plays / max) * 100 : 0}%` }}
                        />
                    </Stack>
                    <Text isMuted size="sm">
                        {genre.plays.toLocaleString()}
                    </Text>
                </div>
            ))}
        </Section>
    );
};

export const UnownedSection = ({
    kind,
    onKind,
    rows,
}: {
    kind: 'album' | 'artist';
    onKind: (kind: 'album' | 'artist') => void;
    rows: LbBotUnownedRow[] | undefined;
}) => (
    <Section note="Only things the library does not hold." title="Most played, not in your library">
        <div style={{ display: 'flex', gap: 8 }}>
            <Button
                onClick={() => onKind('album')}
                size="compact-sm"
                variant={kind === 'album' ? 'filled' : 'default'}
            >
                Albums
            </Button>
            <Button
                onClick={() => onKind('artist')}
                size="compact-sm"
                variant={kind === 'artist' ? 'filled' : 'default'}
            >
                Artists
            </Button>
        </div>
        {rows && rows.length === 0 && (
            <Text isMuted size="sm">
                Nothing here for this period.
            </Text>
        )}
        {kind === 'album' ? (
            <div className={styles.grid}>
                {(rows ?? [])
                    .filter((row) => row.rgid)
                    .map((row) => (
                        <div key={row.rgid}>
                            <MissingAlbumTile
                                artistName={row.artist}
                                ndArtistId={row.artistId}
                                release={unownedAlbumRelease(row)}
                            />
                            <Text isMuted size="xs">
                                {`${row.artist} · ${row.plays} plays`}
                            </Text>
                        </div>
                    ))}
            </div>
        ) : (
            (rows ?? []).map((row, i) => (
                <RankRow key={`${row.artistMbid}-${row.artist}`} plays={row.plays} rank={i + 1}>
                    <MaybeLink
                        to={artistPath(
                            artistTarget(row.artistOwned ? row.artistId : '', row.artistMbid),
                            row.artist,
                        )}
                    >
                        {row.artist}
                    </MaybeLink>
                </RankRow>
            ))
        )}
    </Section>
);

const timeOf = (epochSeconds: number): string =>
    new Date(epochSeconds * 1000).toLocaleString(undefined, {
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
    });

export const RecentSection = ({
    hasMore,
    loadingMore,
    onMore,
    rows,
}: {
    hasMore: boolean;
    loadingMore: boolean;
    onMore: () => void;
    rows: LbBotRecentRow[];
}) => (
    <Section title="Recent plays">
        {rows.length === 0 && (
            <Text isMuted size="sm">
                No plays yet.
            </Text>
        )}
        {rows.map((row, index) => (
            // The index too: two plays in the same second with no recording MBID
            // share every other part of the key. Pages only append, so it is stable.
            <div
                className={styles.recent}
                key={`${row.listenedAt}-${row.recordingMbid}-${row.track}-${index}`}
            >
                <MaybeLink
                    to={albumPath(albumTarget(row.ndAlbumId, row.rgid), {
                        artist: row.artist,
                        artistMbid: row.artistMbid,
                        title: row.release,
                    })}
                >
                    {row.track}
                </MaybeLink>
                <MaybeLink
                    to={artistPath(artistTarget(row.ndArtistId, row.artistMbid), row.artist)}
                >
                    {row.artist}
                </MaybeLink>
                <Text isMuted size="xs">
                    {timeOf(row.listenedAt)}
                </Text>
            </div>
        ))}
        {hasMore && (
            <Button loading={loadingMore} onClick={onMore} size="compact-md" variant="default">
                Show more
            </Button>
        )}
    </Section>
);
