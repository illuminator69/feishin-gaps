import { ReactNode } from 'react';
import { generatePath, Link } from 'react-router';

import styles from './listening.module.css';

import { MissingAlbumTile } from '/@/renderer/features/lbbot/components/missing-album-tile';
import { useActiveFill } from '/@/renderer/features/lbbot/stores/active-fills.store';
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
    playsLabel,
    ReadState,
    unownedAlbumRelease,
} from '/@/renderer/features/listening/listening-logic';
import { AppRoute } from '/@/renderer/router/routes';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import {
    LbBotListeningSummary,
    LbBotRecentRow,
    LbBotUnownedRow,
} from '/@/shared/types/lbbot-types';

/**
 * The sections of the My Listening screen. Each renders only fields of lb-bot's
 * response; rows link OUT (the library page when owned, plain text for an owned
 * row lb-bot has no id for yet, the virtual page when not owned). The one acquire
 * control is the shared missing-album tile's own, on unowned albums, behind its
 * reviewed flow. The two lists read separately say what was read: "reading" only
 * in flight, "empty" only from a 200, a failure with lb-bot's own text.
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
                                title={`${cell.date}: ${playsLabel(cell.count)}`}
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
                        title={`${String(bar.hour).padStart(2, '0')}:00 — ${playsLabel(bar.count)}`}
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
        {summary.topArtists.length > 0 && (
            <Section title="Top artists">
                {summary.topArtists.map((artist, i) => (
                    <RankRow
                        key={`${artist.mbid}-${artist.name}`}
                        plays={artist.plays}
                        rank={i + 1}
                    >
                        <MaybeLink
                            to={artistPath(
                                artistTarget(artist.ndArtistId, artist.mbid),
                                artist.name,
                            )}
                        >
                            {artist.name}
                        </MaybeLink>
                    </RankRow>
                ))}
            </Section>
        )}
        {summary.topAlbums.length > 0 && (
            <Section title="Top albums">
                {summary.topAlbums.map((album, i) => (
                    <RankRow
                        key={`${album.rgid}-${album.title}`}
                        plays={album.plays}
                        rank={i + 1}
                        sub={album.owned ? album.artist : `${album.artist} · not in your library`}
                    >
                        <MaybeLink
                            to={albumPath(albumTarget(album.ndAlbumId, album.rgid, album.owned), {
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
        )}
        {summary.topTracks.length > 0 && (
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
        )}
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

const UnownedAlbumTile = ({ row }: { row: LbBotUnownedRow }) => {
    // A fill the ledger finished is no longer "missing": the tile must not go
    // back to offering the download that just succeeded.
    const fill = useActiveFill(row.rgid);
    const fillDone = !!fill && fill.settled && fill.outcome === 'done';
    return (
        <div>
            <MissingAlbumTile
                artistName={row.artist}
                ndArtistId={row.artistId}
                release={unownedAlbumRelease(row, fillDone)}
            />
            <Text isMuted size="xs">
                {`${row.artist} · ${playsLabel(row.plays)}`}
            </Text>
        </div>
    );
};

/** What a list says in place of rows, from {@link ReadState}. */
const ReadLine = ({
    emptyText,
    onRetry,
    read,
    unreachableText,
}: {
    emptyText: string;
    onRetry: () => void;
    read: ReadState;
    unreachableText: string;
}) => {
    switch (read.kind) {
        case 'empty':
            return (
                <Text isMuted size="sm">
                    {emptyText}
                </Text>
            );
        case 'failed':
            return (
                <Group gap="sm">
                    <Text c="red" size="sm">
                        {read.text}
                    </Text>
                    {!read.permanent && (
                        <Button onClick={onRetry} size="compact-sm" variant="default">
                            Retry
                        </Button>
                    )}
                </Group>
            );
        case 'older':
            return (
                <Text isMuted size="sm">
                    This lb-bot does not provide this yet.
                </Text>
            );
        case 'reading':
            return (
                <Text isMuted size="sm">
                    Loading…
                </Text>
            );
        case 'unreachable':
            return (
                <Text isMuted size="sm">
                    {unreachableText}
                </Text>
            );
        default:
            return null;
    }
};

export const UnownedSection = ({
    kind,
    onKind,
    onRetry,
    read,
    rows,
}: {
    kind: 'album' | 'artist';
    onKind: (kind: 'album' | 'artist') => void;
    onRetry: () => void;
    read: ReadState;
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
        <ReadLine
            emptyText="Nothing here for this period."
            onRetry={onRetry}
            read={read}
            unreachableText="lb-bot is not reachable, so this list cannot be read."
        />
        {read.kind === 'rows' &&
            (kind === 'album' ? (
                <div className={styles.grid}>
                    {(rows ?? [])
                        .filter((row) => row.rgid)
                        .map((row) => (
                            <UnownedAlbumTile key={row.rgid} row={row} />
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
            ))}
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
    onRetry,
    read,
    rows,
}: {
    hasMore: boolean;
    loadingMore: boolean;
    onMore: () => void;
    onRetry: () => void;
    read: ReadState;
    rows: LbBotRecentRow[];
}) => (
    <Section title="Recent plays">
        <ReadLine
            emptyText="No plays yet."
            onRetry={onRetry}
            read={read}
            unreachableText="lb-bot is not reachable, so recent plays cannot be read."
        />
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
