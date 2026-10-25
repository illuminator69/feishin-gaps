import { useQuery, useSuspenseQuery, UseSuspenseQueryResult } from '@tanstack/react-query';
import { CSSProperties, Suspense, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createSearchParams, generatePath, Link, useLocation, useParams } from 'react-router';

import styles from './album-artist-detail-content.module.css';

import { playSongFromItemListControl } from '/@/renderer/components/item-list/helpers/play-row-from-list';
import { useItemListColumnReorder } from '/@/renderer/components/item-list/helpers/use-item-list-column-reorder';
import { useItemListColumnResize } from '/@/renderer/components/item-list/helpers/use-item-list-column-resize';
import { SONG_TABLE_COLUMNS } from '/@/renderer/components/item-list/item-table-list/default-columns';
import { ItemTableList } from '/@/renderer/components/item-list/item-table-list/item-table-list';
import { ItemTableListColumn } from '/@/renderer/components/item-list/item-table-list/item-table-list-column';
import { ItemControls } from '/@/renderer/components/item-list/types';
import { artistsQueries } from '/@/renderer/features/artists/api/artists-api';
import { AlbumArtistGridCarousel } from '/@/renderer/features/artists/components/album-artist-grid-carousel';
import artistColumns from '/@/renderer/features/discography/components/artist-columns.module.css';
import { Discography } from '/@/renderer/features/discography/components/discography';
import { DiscoverRow } from '/@/renderer/features/discover/components/discover-row';
import { DiscoverTile } from '/@/renderer/features/discover/components/discover-tile';
import { LbBotIndexButton } from '/@/renderer/features/lbbot/components/lbbot-index-button';
import { MetaAbout } from '/@/renderer/features/lbbot/components/meta-about';
import {
    useEffectiveArtistMbid,
    useLbBotArtistMeta,
    useLbBotDiscography,
    useOpenArtist,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { useIsPlayerFetching, usePlayer } from '/@/renderer/features/player/context/player-context';
import { playArtistRadio } from '/@/renderer/features/player/station/station-client';
import {
    ListConfigMenu,
    SONG_DISPLAY_TYPES,
} from '/@/renderer/features/shared/components/list-config-menu';
import {
    CLIENT_SIDE_SONG_FILTERS,
    ListSortByDropdownControlled,
} from '/@/renderer/features/shared/components/list-sort-by-dropdown';
import { ListSortOrderToggleButtonControlled } from '/@/renderer/features/shared/components/list-sort-order-toggle-button';
import {
    LONG_PRESS_PLAY_BEHAVIOR,
    PlayTooltip,
} from '/@/renderer/features/shared/components/play-button-group';
import { usePlayButtonClick } from '/@/renderer/features/shared/hooks/use-play-button-click';
import { searchLibraryItems } from '/@/renderer/features/shared/utils';
import { useGenreRoute } from '/@/renderer/hooks/use-genre-route';
import { AppRoute } from '/@/renderer/router/routes';
import {
    ArtistItem,
    useAppStore,
    useCurrentServer,
    useCurrentServerId,
    usePlayerSong,
    useShowFavorites,
    useShowRatings,
} from '/@/renderer/store';
import {
    useArtistItems,
    useArtistRadioCount,
    useExternalLinks,
    useSettingsStore,
} from '/@/renderer/store/settings.store';
import { sanitize } from '/@/renderer/utils/sanitize';
import { sortSongList } from '/@/shared/api/utils';
import { ActionIcon, ActionIconGroup } from '/@/shared/components/action-icon/action-icon';
import { Badge } from '/@/shared/components/badge/badge';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Icon } from '/@/shared/components/icon/icon';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Skeleton } from '/@/shared/components/skeleton/skeleton';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Spoiler } from '/@/shared/components/spoiler/spoiler';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';
import { useDebouncedValue } from '/@/shared/hooks/use-debounced-value';
import { useLocalStorage } from '/@/shared/hooks/use-local-storage';
import {
    Album,
    AlbumArtist,
    AlbumArtistDetailResponse,
    AlbumListResponse,
    LibraryItem,
    RelatedArtist,
    ServerType,
    Song,
    SongListSort,
    SortOrder,
} from '/@/shared/types/domain-types';
import { LbBotMetaRelation } from '/@/shared/types/lbbot-types';
import { ItemListKey, ListDisplayType, Play } from '/@/shared/types/types';

const NO_ALBUMS: Album[] = [];

/** A section's place: `--order-narrow` in the one-column page, `--order-wide` in the side column. */
const columnOrder = (order = 0, wideOrder?: number) =>
    ({ '--order-narrow': order, '--order-wide': wideOrder ?? order }) as CSSProperties;

interface AlbumArtistActionButtonsProps {
    artistDiscographyLink: string;
    artistSongsLink: string;
    onArtistRadio?: () => void;
}

const AlbumArtistActionButtons = ({
    artistDiscographyLink,
    artistSongsLink,
    onArtistRadio,
}: AlbumArtistActionButtonsProps) => {
    const { t } = useTranslation();
    const isPlayerFetching = useIsPlayerFetching();

    return (
        <>
            <Group gap="lg">
                <Button
                    component={Link}
                    p={0}
                    size="compact-md"
                    to={artistDiscographyLink}
                    variant="transparent"
                >
                    {String(t('page.albumArtistDetail.viewDiscography')).toUpperCase()}
                </Button>
                <Button
                    component={Link}
                    p={0}
                    size="compact-md"
                    to={artistSongsLink}
                    variant="transparent"
                >
                    {String(t('page.albumArtistDetail.viewAllTracks')).toUpperCase()}
                </Button>
                {onArtistRadio && (
                    <Button
                        disabled={isPlayerFetching}
                        leftSection={
                            isPlayerFetching ? (
                                <Spinner color="white" size={16} />
                            ) : (
                                <Icon icon="radio" size="lg" />
                            )
                        }
                        onClick={onArtistRadio}
                        p={0}
                        size="compact-md"
                        variant="transparent"
                    >
                        {String(t('player.artistRadio')).toUpperCase()}
                    </Button>
                )}
            </Group>
        </>
    );
};

interface AlbumArtistMetadataGenresProps {
    genres?: Array<{ id: string; name: string }>;
    order?: number;
    /** Its place in the side column (F7: last), where it differs from the one-column order. */
    wideOrder?: number;
}

const AlbumArtistMetadataGenres = ({
    genres,
    order,
    wideOrder,
}: AlbumArtistMetadataGenresProps) => {
    const { t } = useTranslation();
    const genrePath = useGenreRoute();

    if (!genres || genres.length === 0) return null;

    return (
        <div className={artistColumns.item} style={columnOrder(order, wideOrder)}>
            <Stack gap="xs">
                <Text fw={600} isNoSelect size="sm" tt="uppercase">
                    {t('entity.genre', {
                        count: genres.length,
                    })}
                </Text>
                <Group gap="sm">
                    {genres.map((genre) => (
                        <Button
                            component={Link}
                            key={`genre-${genre.id}`}
                            radius="md"
                            size="compact-md"
                            to={generatePath(genrePath, {
                                albumArtistId: null,
                                albumId: null,
                                artistId: null,
                                // navi-connect: the virtual artist/album routes' params.
                                // generatePath types this against the union of every
                                // AppRoute's params, so each one has to appear here.
                                artistMbid: null,
                                genreId: genre.id,
                                itemType: null,
                                playlistId: null,
                                rgid: null,
                            })}
                            variant="outline"
                        >
                            {genre.name}
                        </Button>
                    ))}
                </Group>
            </Stack>
        </div>
    );
};

/**
 * Last.fm ends every summary with its own "Read more on Last.fm" anchor, and the
 * sanitizer deliberately allows `<a href>`, so it survives into the page.
 *
 * This runs UNCONDITIONALLY. It used to be gated on lb-bot having answered,
 * the reasoning being that until then the anchor was the only route to the rest
 * of the text — but the cost of that was a bio which rendered with a link and
 * then silently lost it a second later, which is the exact defect this whole
 * pass exists to remove. Text on screen does not change under the reader.
 *
 * It also matters much less than it did: with the Apple Music agent ahead of
 * `lastfm` in Navidrome's chain the biography is usually not Last.fm's at all,
 * and carries no anchor to strip.
 */
const stripLastFmReadMore = (html: string): string =>
    html.replace(/<a\b[^>]*last\.fm[^>]*>.*?<\/a>/gis, '').replace(/(\s|<br\s*\/?>)+$/i, '');

interface AlbumArtistMetadataBiographyProps {
    artistMbid?: null | string;
    artistName?: string;
    order?: number;
    routeId: string;
}

const AlbumArtistMetadataBiography = ({
    artistMbid,
    artistName,
    order,
    routeId,
}: AlbumArtistMetadataBiographyProps) => {
    const { t } = useTranslation();
    const server = useCurrentServer();

    const artistInfoQuery = useQuery({
        ...artistsQueries.albumArtistInfo({
            query: { id: routeId, limit: 10 },
            serverId: server?.id,
        }),
        enabled: Boolean(server?.id && routeId),
    });

    const detailQuery = useQuery({
        ...artistsQueries.albumArtistDetail({
            query: { id: routeId },
            serverId: server?.id,
        }),
        enabled: Boolean(server?.id && routeId),
    });

    // lb-bot's editorial metadata. It is NOT in the running for the bio slot on
    // an owned artist any more: it resolves behind a MusicBrainz hop that can
    // queue behind a running discography scan, so preferring it meant Navidrome's
    // text painted first and was then swapped out from under the reader. It
    // fills this slot only when Navidrome has nothing at all — a late arrival
    // into an EMPTY slot changes nothing on screen — and otherwise contributes
    // the supplementary section below.
    const metaQuery = useLbBotArtistMeta(artistMbid, artistName);
    const meta = metaQuery.data;
    const hasMetaText = Boolean(meta?.summary || meta?.paragraphs.length);

    const biography = artistInfoQuery.data?.biography || detailQuery.data?.biography;
    // `metaQuery` is deliberately absent from this: the skeleton belongs to the
    // request the page blocks on, and waiting on lb-bot here would trade a flash
    // for a spinner on every artist page.
    const isLoading = !biography && (artistInfoQuery.isLoading || detailQuery.isLoading);

    const sanitizedBiography = biography ? sanitize(stripLastFmReadMore(biography)) : '';

    if (isLoading) {
        return (
            <div className={artistColumns.item} style={columnOrder(order)}>
                <section style={{ maxWidth: '1280px' }}>
                    <TextTitle fw={700} order={3}>
                        {t('page.albumArtistDetail.about', {
                            artist: artistName,
                        })}
                    </TextTitle>
                    <Stack gap="xs">
                        <Skeleton enableAnimation height="1rem" width="100%" />
                        <Skeleton enableAnimation height="1rem" width="98%" />
                        <Skeleton enableAnimation height="1rem" width="60%" />
                    </Stack>
                </section>
            </div>
        );
    }

    if (!biography && !hasMetaText && !meta?.wikidataDescription) {
        return null;
    }

    return (
        <div className={artistColumns.item} style={columnOrder(order)}>
            <section style={{ maxWidth: '1280px' }}>
                <TextTitle fw={700} order={3}>
                    {t('page.albumArtistDetail.about', {
                        artist: artistName,
                    })}
                </TextTitle>
                {biography ? (
                    // The 56px default made a real bio look like a stub, which
                    // is most of why the old surface felt like a dead end.
                    <Spoiler maxHeight={180}>
                        <Text dangerouslySetInnerHTML={{ __html: sanitizedBiography }} />
                    </Spoiler>
                ) : (
                    meta && <MetaAbout meta={meta} showLinks={false} />
                )}
            </section>
        </div>
    );
};

/**
 * What lb-bot contributes to an OWNED artist page now that the bio slot belongs
 * to Navidrome: the band-members / side-projects graph and the external-links
 * row, neither of which Subsonic has a field for.
 *
 * All three were already fetched, normalized and typed, and rendered by nothing.
 *
 * This section is allowed to arrive late, which is the whole point of the split:
 * nothing was in its place, so appearing changes no text the reader had already
 * started on. It renders nothing at all when lb-bot is absent, unreachable or
 * simply has nothing on this artist (§7).
 */
const AlbumArtistMetadataLbBotExtras = ({
    artistMbid,
    artistName,
    order,
}: {
    artistMbid?: null | string;
    artistName?: string;
    order?: number;
}) => {
    // Same key as the biography's call, so react-query serves both from one
    // request rather than asking lb-bot twice per page.
    const metaQuery = useLbBotArtistMeta(artistMbid, artistName);
    const openArtist = useOpenArtist();
    const meta = metaQuery.data;
    if (!meta) return null;

    const { links, relations } = meta;
    const groups = [
        { rows: relations.members, title: 'Members' },
        { rows: relations.related, title: 'Related' },
    ].filter((group) => group.rows.length > 0);

    if (groups.length === 0 && links.length === 0) return null;

    return (
        <div className={artistColumns.item} style={columnOrder(order)}>
            <section style={{ maxWidth: '1280px' }}>
                <Stack gap="md">
                    {/* Rows of round artist cards, as the page's own "Related Artists"
                        carousel is, rather than a column of names. lb-bot's relations
                        carry an MBID and a name, not a library id: the card is the
                        artist placeholder, and where it leads (the library page for an
                        artist you have, else the virtual one) is found when it is
                        opened, never by a search per card. */}
                    {groups.map((group) => (
                        <DiscoverRow
                            because="From MusicBrainz, via lb-bot"
                            cards={group.rows.map((row) => ({
                                content: (
                                    <DiscoverTile
                                        isRound
                                        itemType={LibraryItem.ALBUM_ARTIST}
                                        onClick={
                                            row.mbid
                                                ? () => void openArtist(row.mbid, row.name)
                                                : undefined
                                        }
                                        subtitle={formatRelationDetail(row) || undefined}
                                        title={row.name}
                                    />
                                ),
                                id: row.mbid || row.name,
                            }))}
                            isEmpty={group.rows.length === 0}
                            key={group.title}
                            title={group.title}
                        />
                    ))}
                    {links.length > 0 && (
                        <Group gap="sm">
                            {links.map((link) => (
                                <Text isMuted key={link.url} size="sm">
                                    <a href={link.url} rel="noreferrer" target="_blank">
                                        {link.label}
                                    </a>
                                </Text>
                            ))}
                        </Group>
                    )}
                </Stack>
            </section>
        </div>
    );
};

/**
 * "guitar, lead vocals (1985–1991)" — the part of a relation that is not the
 * name. `attributes` is what makes a members list worth reading rather than a
 * column of names; an open stint gets an en dash and no end year, because
 * lb-bot clears `ended` the moment any one stint is still running.
 */
const formatRelationDetail = (row: LbBotMetaRelation): string => {
    const roles = row.attributes.join(', ');
    const years = row.begin
        ? `${row.begin}\u2013${row.ended && row.end ? row.end : ''}`
        : row.ended && row.end
          ? `until ${row.end}`
          : '';
    if (roles && years) return `${roles} (${years})`;
    return roles || (years ? `(${years})` : '');
};

const TABLE_ROW_HEIGHT = {
    compact: 40,
    default: 64,
    large: 88,
} as const;

const TABLE_HEADER_HEIGHT = 40;

interface SongTableListContainerProps {
    children: React.ReactNode;
    enableHeader?: boolean;
    itemCount: number;
    maxRows?: number;
    tableSize?: 'compact' | 'default' | 'large';
}

function getTableRowHeight(size: 'compact' | 'default' | 'large' | undefined): number {
    return size ? TABLE_ROW_HEIGHT[size] : TABLE_ROW_HEIGHT.default;
}

const SongTableListContainer = ({
    children,
    enableHeader = true,
    itemCount,
    maxRows = 5,
    tableSize = 'default',
}: SongTableListContainerProps) => {
    const rowHeight = getTableRowHeight(tableSize);
    const headerOffset = enableHeader ? TABLE_HEADER_HEIGHT : 0;
    const height = headerOffset + rowHeight * Math.min(itemCount, maxRows);
    return <div style={{ height }}>{children}</div>;
};

interface AlbumArtistMetadataTopSongsProps {
    detailQuery: ReturnType<typeof useSuspenseQuery<AlbumArtistDetailResponse>>;
    order?: number;
    routeId: string;
}

const AlbumArtistMetadataTopSongsContent = ({
    detailQuery,
    order,
    routeId,
}: AlbumArtistMetadataTopSongsProps) => {
    const { t } = useTranslation();
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm] = useDebouncedValue(searchTerm, 300);
    const [topSongsQueryType, setTopSongsQueryType] = useLocalStorage<'community' | 'personal'>({
        defaultValue: 'community',
        key: 'album-artist-top-songs-query-type',
    });
    const tableConfig = useSettingsStore((state) => state.lists[ItemListKey.SONG]?.table);
    const currentSong = usePlayerSong();
    const player = usePlayer();
    const serverId = useCurrentServerId();
    const server = useCurrentServer();

    const canStartQuery = server?.type === ServerType.JELLYFIN || !!detailQuery.data?.name;

    const topSongsQuery = useQuery({
        ...artistsQueries.topSongs({
            query: {
                artist: detailQuery.data?.name || '',
                artistId: routeId,
                type: topSongsQueryType,
            },
            serverId: serverId,
        }),
        enabled: canStartQuery,
    });

    const songs = useMemo(() => topSongsQuery.data?.items || [], [topSongsQuery.data?.items]);

    const columns = useMemo(() => {
        return tableConfig?.columns || [];
    }, [tableConfig?.columns]);

    const filteredSongs = useMemo(() => {
        return searchLibraryItems(songs, debouncedSearchTerm, LibraryItem.SONG);
    }, [songs, debouncedSearchTerm]);

    const { handleColumnReordered } = useItemListColumnReorder({
        itemListKey: ItemListKey.SONG,
    });

    const { handleColumnResized } = useItemListColumnResize({
        itemListKey: ItemListKey.SONG,
    });

    const overrideControls: Partial<ItemControls> = useMemo(() => {
        return {
            onDoubleClick: ({ index, internalState, item, meta }) => {
                if (!item) {
                    return;
                }

                playSongFromItemListControl({
                    index,
                    internalState,
                    item: item as Song,
                    meta,
                    player,
                });
            },
        };
    }, [player]);

    const handlePlay = useCallback(
        (playType: Play) => {
            if (songs.length === 0) return;
            player.addToQueueByData(songs, playType);
        },
        [songs, player],
    );

    const handlePlayNext = usePlayButtonClick({
        onClick: () => handlePlay(Play.NEXT),
        onLongPress: () => handlePlay(LONG_PRESS_PLAY_BEHAVIOR[Play.NEXT]),
    });
    const handlePlayNow = usePlayButtonClick({
        onClick: () => handlePlay(Play.NOW),
        onLongPress: () => handlePlay(LONG_PRESS_PLAY_BEHAVIOR[Play.NOW]),
    });
    const handlePlayLast = usePlayButtonClick({
        onClick: () => handlePlay(Play.LAST),
        onLongPress: () => handlePlay(LONG_PRESS_PLAY_BEHAVIOR[Play.LAST]),
    });

    const isLoading = topSongsQuery.isLoading || !topSongsQuery.data;

    if (!isLoading && !tableConfig) return null;
    if (!isLoading && songs.length === 0) return null;

    const currentSongId = currentSong?.id;

    return (
        <div className={artistColumns.item} style={columnOrder(order)}>
            <section>
                <Stack gap="md">
                    <div className={styles.albumSectionTitle}>
                        <Group>
                            <TextTitle fw={700} order={3}>
                                {t('page.albumArtistDetail.topSongs')}
                            </TextTitle>
                            {!isLoading && <Badge>{songs.length}</Badge>}
                        </Group>
                        <div className={styles.albumSectionDividerContainer}>
                            <div className={styles.albumSectionDivider} />
                            <Button
                                component={Link}
                                size="compact-md"
                                to={generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL_TOP_SONGS, {
                                    albumArtistId: routeId,
                                })}
                                uppercase
                                variant="subtle"
                            >
                                {t('page.albumArtistDetail.viewAll')}
                            </Button>
                            {songs.length > 0 && (
                                <ActionIconGroup>
                                    <PlayTooltip type={Play.NOW}>
                                        <ActionIcon
                                            icon="mediaPlay"
                                            iconProps={{ size: 'md' }}
                                            size="xs"
                                            variant="subtle"
                                            {...handlePlayNow.handlers}
                                            {...handlePlayNow.props}
                                            disabled={isLoading}
                                        />
                                    </PlayTooltip>
                                    <PlayTooltip type={Play.NEXT}>
                                        <ActionIcon
                                            icon="mediaPlayNext"
                                            iconProps={{ size: 'md' }}
                                            size="xs"
                                            variant="subtle"
                                            {...handlePlayNext.handlers}
                                            {...handlePlayNext.props}
                                            disabled={isLoading}
                                        />
                                    </PlayTooltip>
                                    <PlayTooltip type={Play.LAST}>
                                        <ActionIcon
                                            icon="mediaPlayLast"
                                            iconProps={{ size: 'md' }}
                                            size="xs"
                                            variant="subtle"
                                            {...handlePlayLast.handlers}
                                            {...handlePlayLast.props}
                                            disabled={isLoading}
                                        />
                                    </PlayTooltip>
                                </ActionIconGroup>
                            )}
                        </div>
                    </div>
                    {isLoading ? (
                        <Group justify="center" py="md">
                            <Spinner container />
                        </Group>
                    ) : tableConfig ? (
                        <>
                            <Group gap="sm" w="100%">
                                <TextInput
                                    flex={1}
                                    leftSection={<Icon icon="search" />}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder={t('common.search')}
                                    radius="xl"
                                    rightSection={
                                        searchTerm ? (
                                            <ActionIcon
                                                icon="x"
                                                onClick={() => setSearchTerm('')}
                                                size="sm"
                                                variant="transparent"
                                            />
                                        ) : null
                                    }
                                    styles={{
                                        input: {
                                            background: 'transparent',
                                            border: '1px solid rgba(255, 255, 255, 0.05)',
                                        },
                                    }}
                                    value={searchTerm}
                                />
                                <SegmentedControl
                                    data={[
                                        {
                                            label: t('page.albumArtistDetail.topSongsCommunity'),
                                            value: 'community',
                                        },
                                        {
                                            label: t('page.albumArtistDetail.topSongsPersonal'),
                                            value: 'personal',
                                        },
                                    ]}
                                    onChange={(value) =>
                                        setTopSongsQueryType(value as 'community' | 'personal')
                                    }
                                    size="xs"
                                    value={topSongsQueryType}
                                />
                                <ListConfigMenu
                                    displayTypes={[
                                        { hidden: true, value: ListDisplayType.GRID },
                                        ...SONG_DISPLAY_TYPES,
                                    ]}
                                    listKey={ItemListKey.SONG}
                                    optionsConfig={{
                                        table: {
                                            itemsPerPage: { hidden: true },
                                            pagination: { hidden: true },
                                        },
                                    }}
                                    tableColumnsData={SONG_TABLE_COLUMNS}
                                />
                            </Group>
                            <SongTableListContainer
                                enableHeader={tableConfig.enableHeader}
                                itemCount={filteredSongs.length}
                                maxRows={5}
                                tableSize={tableConfig.size}
                            >
                                <ItemTableList
                                    activeRowId={currentSongId}
                                    autoFitColumns={tableConfig.autoFitColumns}
                                    CellComponent={ItemTableListColumn}
                                    columns={columns}
                                    data={filteredSongs}
                                    enableAlternateRowColors={tableConfig.enableAlternateRowColors}
                                    enableDrag
                                    enableDragScroll={false}
                                    enableExpansion={false}
                                    enableHeader={tableConfig.enableHeader}
                                    enableHorizontalBorders={tableConfig.enableHorizontalBorders}
                                    enableRowHoverHighlight={tableConfig.enableRowHoverHighlight}
                                    enableSelection
                                    enableSelectionDialog={false}
                                    enableVerticalBorders={tableConfig.enableVerticalBorders}
                                    itemType={LibraryItem.SONG}
                                    onColumnReordered={handleColumnReordered}
                                    onColumnResized={handleColumnResized}
                                    overrideControls={overrideControls}
                                    size={tableConfig.size}
                                />
                            </SongTableListContainer>
                        </>
                    ) : null}
                </Stack>
            </section>
        </div>
    );
};

const AlbumArtistMetadataTopSongs = ({
    detailQuery,
    order,
    routeId,
}: AlbumArtistMetadataTopSongsProps) => {
    const server = useCurrentServer();

    const location = useLocation();
    const artistName = location.state?.item?.name || detailQuery.data?.name;

    const canStartQuery = server?.type === ServerType.JELLYFIN || !!artistName;

    return (
        <Suspense fallback={null}>
            {canStartQuery ? (
                <AlbumArtistMetadataTopSongsContent
                    detailQuery={detailQuery}
                    order={order}
                    routeId={routeId}
                />
            ) : null}
        </Suspense>
    );
};

interface AlbumArtistMetadataFavoriteSongsProps {
    order?: number;
    routeId: string;
}

const AlbumArtistMetadataFavoriteSongs = ({
    order,
    routeId,
}: AlbumArtistMetadataFavoriteSongsProps) => {
    const { t } = useTranslation();
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm] = useDebouncedValue(searchTerm, 300);
    const [favoriteSongsQueryType, setFavoriteSongsQueryType] = useLocalStorage<
        'favorite' | 'rating'
    >({
        defaultValue: 'favorite',
        key: 'album-artist-favorite-songs-query-type',
    });
    const albumArtistDetailFavoriteSongsSort = useAppStore(
        (state) => state.albumArtistDetailFavoriteSongsSort,
    );
    const setAlbumArtistDetailFavoriteSongsSort = useAppStore(
        (state) => state.actions.setAlbumArtistDetailFavoriteSongsSort,
    );
    const sortBy = albumArtistDetailFavoriteSongsSort.sortBy;
    const sortOrder = albumArtistDetailFavoriteSongsSort.sortOrder;
    const tableConfig = useSettingsStore((state) => state.lists[ItemListKey.SONG]?.table);
    const currentSong = usePlayerSong();
    const player = usePlayer();
    const serverId = useCurrentServerId();
    const server = useCurrentServer();
    const showRatings = useShowRatings();
    const showFavorites = useShowFavorites();
    const showFavoriteAndRatingSegmentControl =
        server?.type !== ServerType.JELLYFIN && showFavorites && showRatings;

    let favoriteSongsQueryTypeFilter = favoriteSongsQueryType;
    if (showRatings && !showFavorites) {
        favoriteSongsQueryTypeFilter = 'rating';
    } else if (!showRatings && showFavorites) {
        favoriteSongsQueryTypeFilter = 'favorite';
    }

    const favoriteSongsQuery = useQuery({
        ...artistsQueries.favoriteSongs({
            query: {
                artistId: routeId,
                type: favoriteSongsQueryTypeFilter,
            },
            serverId: serverId,
        }),
    });

    const songs = useMemo(
        () => favoriteSongsQuery.data?.items || [],
        [favoriteSongsQuery.data?.items],
    );

    const columns = useMemo(() => {
        return tableConfig?.columns || [];
    }, [tableConfig?.columns]);

    const filteredSongs = useMemo(() => {
        return sortSongList(
            searchLibraryItems(songs, debouncedSearchTerm, LibraryItem.SONG),
            sortBy,
            sortOrder,
        );
    }, [songs, debouncedSearchTerm, sortBy, sortOrder]);

    const { handleColumnReordered } = useItemListColumnReorder({
        itemListKey: ItemListKey.SONG,
    });

    const { handleColumnResized } = useItemListColumnResize({
        itemListKey: ItemListKey.SONG,
    });

    const overrideControls: Partial<ItemControls> = useMemo(() => {
        return {
            onDoubleClick: ({ index, internalState, item, meta }) => {
                if (!item) {
                    return;
                }

                playSongFromItemListControl({
                    index,
                    internalState,
                    item: item as Song,
                    meta,
                    player,
                });
            },
        };
    }, [player]);

    const handlePlay = useCallback(
        (playType: Play) => {
            if (songs.length === 0) return;
            player.addToQueueByData(songs, playType);
        },
        [songs, player],
    );

    const handlePlayNext = usePlayButtonClick({
        onClick: () => handlePlay(Play.NEXT),
        onLongPress: () => handlePlay(LONG_PRESS_PLAY_BEHAVIOR[Play.NEXT]),
    });
    const handlePlayNow = usePlayButtonClick({
        onClick: () => handlePlay(Play.NOW),
        onLongPress: () => handlePlay(LONG_PRESS_PLAY_BEHAVIOR[Play.NOW]),
    });
    const handlePlayLast = usePlayButtonClick({
        onClick: () => handlePlay(Play.LAST),
        onLongPress: () => handlePlay(LONG_PRESS_PLAY_BEHAVIOR[Play.LAST]),
    });

    const isLoading = favoriteSongsQuery.isLoading || !favoriteSongsQuery.data;

    if (!isLoading && !tableConfig) return null;
    if (!isLoading && songs.length === 0) return null;

    const currentSongId = currentSong?.id;

    return (
        <div className={artistColumns.item} style={columnOrder(order)}>
            <section>
                <Stack gap="md">
                    <div className={styles.albumSectionTitle}>
                        <Group>
                            <TextTitle fw={700} order={3}>
                                {t('page.albumArtistDetail.favoriteSongs')}
                            </TextTitle>
                            {!isLoading && <Badge>{songs.length}</Badge>}
                        </Group>
                        <div className={styles.albumSectionDividerContainer}>
                            <div className={styles.albumSectionDivider} />
                            <Button
                                component={Link}
                                size="compact-md"
                                to={generatePath(
                                    AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL_FAVORITE_SONGS,
                                    {
                                        albumArtistId: routeId,
                                    },
                                )}
                                uppercase
                                variant="subtle"
                            >
                                {t('page.albumArtistDetail.viewAll')}
                            </Button>
                            {songs.length > 0 && (
                                <ActionIconGroup>
                                    <PlayTooltip type={Play.NOW}>
                                        <ActionIcon
                                            icon="mediaPlay"
                                            iconProps={{ size: 'md' }}
                                            size="xs"
                                            variant="subtle"
                                            {...handlePlayNow.handlers}
                                            {...handlePlayNow.props}
                                            disabled={isLoading}
                                        />
                                    </PlayTooltip>
                                    <PlayTooltip type={Play.NEXT}>
                                        <ActionIcon
                                            icon="mediaPlayNext"
                                            iconProps={{ size: 'md' }}
                                            size="xs"
                                            variant="subtle"
                                            {...handlePlayNext.handlers}
                                            {...handlePlayNext.props}
                                            disabled={isLoading}
                                        />
                                    </PlayTooltip>
                                    <PlayTooltip type={Play.LAST}>
                                        <ActionIcon
                                            icon="mediaPlayLast"
                                            iconProps={{ size: 'md' }}
                                            size="xs"
                                            variant="subtle"
                                            {...handlePlayLast.handlers}
                                            {...handlePlayLast.props}
                                            disabled={isLoading}
                                        />
                                    </PlayTooltip>
                                </ActionIconGroup>
                            )}
                        </div>
                    </div>
                    {isLoading ? (
                        <Group justify="center" py="md">
                            <Spinner />
                        </Group>
                    ) : tableConfig ? (
                        <>
                            <Group gap="sm" w="100%">
                                <TextInput
                                    flex={1}
                                    leftSection={<Icon icon="search" />}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder={t('common.search')}
                                    radius="xl"
                                    rightSection={
                                        searchTerm ? (
                                            <ActionIcon
                                                icon="x"
                                                onClick={() => setSearchTerm('')}
                                                size="sm"
                                                variant="transparent"
                                            />
                                        ) : null
                                    }
                                    styles={{
                                        input: {
                                            background: 'transparent',
                                            border: '1px solid rgba(255, 255, 255, 0.05)',
                                        },
                                    }}
                                    value={searchTerm}
                                />
                                {showFavoriteAndRatingSegmentControl && (
                                    <SegmentedControl
                                        data={[
                                            {
                                                label: t('common.favorite'),
                                                value: 'favorite',
                                            },
                                            {
                                                label: t('common.rating'),
                                                value: 'rating',
                                            },
                                        ]}
                                        onChange={(value) =>
                                            setFavoriteSongsQueryType(
                                                value as 'favorite' | 'rating',
                                            )
                                        }
                                        size="xs"
                                        value={favoriteSongsQueryType}
                                    />
                                )}
                                <ListSortByDropdownControlled
                                    filters={CLIENT_SIDE_SONG_FILTERS}
                                    itemType={LibraryItem.SONG}
                                    setSortBy={(value) =>
                                        setAlbumArtistDetailFavoriteSongsSort(
                                            value as SongListSort,
                                            sortOrder,
                                        )
                                    }
                                    sortBy={sortBy}
                                />
                                <ListSortOrderToggleButtonControlled
                                    setSortOrder={(value) =>
                                        setAlbumArtistDetailFavoriteSongsSort(
                                            sortBy,
                                            value as SortOrder,
                                        )
                                    }
                                    sortOrder={sortOrder}
                                />
                                <ListConfigMenu
                                    displayTypes={[
                                        { hidden: true, value: ListDisplayType.GRID },
                                        ...SONG_DISPLAY_TYPES,
                                    ]}
                                    listKey={ItemListKey.SONG}
                                    optionsConfig={{
                                        table: {
                                            itemsPerPage: { hidden: true },
                                            pagination: { hidden: true },
                                        },
                                    }}
                                    tableColumnsData={SONG_TABLE_COLUMNS}
                                />
                            </Group>
                            <SongTableListContainer
                                enableHeader={tableConfig.enableHeader}
                                itemCount={filteredSongs.length}
                                maxRows={5}
                                tableSize={tableConfig.size}
                            >
                                <ItemTableList
                                    activeRowId={currentSongId}
                                    autoFitColumns={tableConfig.autoFitColumns}
                                    CellComponent={ItemTableListColumn}
                                    columns={columns}
                                    data={filteredSongs}
                                    enableAlternateRowColors={tableConfig.enableAlternateRowColors}
                                    enableDrag
                                    enableDragScroll={false}
                                    enableExpansion={false}
                                    enableHeader={tableConfig.enableHeader}
                                    enableHorizontalBorders={tableConfig.enableHorizontalBorders}
                                    enableRowHoverHighlight={tableConfig.enableRowHoverHighlight}
                                    enableSelection
                                    enableSelectionDialog={false}
                                    enableVerticalBorders={tableConfig.enableVerticalBorders}
                                    itemType={LibraryItem.SONG}
                                    onColumnReordered={handleColumnReordered}
                                    onColumnResized={handleColumnResized}
                                    overrideControls={overrideControls}
                                    size={tableConfig.size}
                                />
                            </SongTableListContainer>
                        </>
                    ) : null}
                </Stack>
            </section>
        </div>
    );
};

interface AlbumArtistMetadataExternalLinksProps {
    artistName?: string;
    externalLinks: boolean;
    lastFM: boolean;
    listenBrainz: boolean;
    mbzId?: null | string;
    musicBrainz: boolean;
    nativeSpotify: boolean;
    order?: number;
    qobuz: boolean;
    spotify: boolean;
    /** Its place in the side column (F7: last), where it differs from the one-column order. */
    wideOrder?: number;
}

const getListenBrainzUrl = (mbzId: null | string, artistName?: string) => {
    if (mbzId) {
        return `https://listenbrainz.org/artist/${mbzId}`;
    }

    if (artistName) {
        return `https://listenbrainz.org/search/?search_term=${encodeURIComponent(artistName)}`;
    }

    return null;
};

const getQobuzUrl = (artistName?: string) => {
    if (artistName) {
        return `https://www.qobuz.com/us-en/search/artists/${encodeURIComponent(artistName)}`;
    }

    return null;
};

const AlbumArtistMetadataExternalLinks = ({
    artistName,
    externalLinks,
    lastFM,
    listenBrainz,
    mbzId,
    musicBrainz,
    nativeSpotify,
    order,
    qobuz,
    spotify,
    wideOrder,
}: AlbumArtistMetadataExternalLinksProps) => {
    const { t } = useTranslation();
    const listenBrainzUrl = getListenBrainzUrl(mbzId || null, artistName);
    const qobuzUrl = getQobuzUrl(artistName);

    if (!externalLinks || (!lastFM && !listenBrainz && !musicBrainz && !qobuz && !spotify)) {
        return null;
    }

    return (
        <div className={artistColumns.item} style={columnOrder(order, wideOrder)}>
            <Stack gap="xs">
                <Text fw={600} isNoSelect size="sm" tt="uppercase">
                    {t('common.externalLinks')}
                </Text>
                <Group gap="xs">
                    {lastFM && (
                        <ActionIcon
                            component="a"
                            href={`https://www.last.fm/music/${encodeURIComponent(artistName || '')}`}
                            icon="brandLastfm"
                            iconProps={{
                                size: '2xl',
                            }}
                            rel="noopener noreferrer"
                            target="_blank"
                            tooltip={{
                                label: t('action.openIn.lastfm'),
                            }}
                            variant="subtle"
                        />
                    )}
                    {mbzId && musicBrainz ? (
                        <ActionIcon
                            component="a"
                            href={`https://musicbrainz.org/artist/${mbzId}`}
                            icon="brandMusicBrainz"
                            iconProps={{
                                size: '2xl',
                            }}
                            rel="noopener noreferrer"
                            target="_blank"
                            tooltip={{
                                label: t('action.openIn.musicbrainz'),
                            }}
                            variant="subtle"
                        />
                    ) : null}
                    {listenBrainz && listenBrainzUrl && (
                        <ActionIcon
                            component="a"
                            href={listenBrainzUrl}
                            icon="brandListenBrainz"
                            iconProps={{
                                size: '2xl',
                            }}
                            rel="noopener noreferrer"
                            target="_blank"
                            tooltip={{
                                label: t('action.openIn.listenbrainz'),
                            }}
                            variant="subtle"
                        />
                    )}
                    {qobuz && qobuzUrl && (
                        <ActionIcon
                            component="a"
                            href={qobuzUrl}
                            icon="brandQobuz"
                            iconProps={{
                                size: '2xl',
                            }}
                            rel="noopener noreferrer"
                            target="_blank"
                            tooltip={{
                                label: t('action.openIn.qobuz'),
                            }}
                            variant="subtle"
                        />
                    )}
                    {spotify && (
                        <ActionIcon
                            component="a"
                            href={
                                nativeSpotify
                                    ? `spotify:search:${encodeURIComponent(artistName || '')}`
                                    : `https://open.spotify.com/search/${encodeURIComponent(artistName || '')}`
                            }
                            icon="brandSpotify"
                            iconProps={{
                                size: '2xl',
                            }}
                            rel="noopener noreferrer"
                            target={nativeSpotify ? undefined : '_blank'}
                            tooltip={{
                                label: t('action.openIn.spotify'),
                            }}
                            variant="subtle"
                        />
                    )}
                </Group>
            </Stack>
        </div>
    );
};

interface AlbumArtistMetadataSimilarArtistsProps {
    order?: number;
    routeId: string;
}

const AlbumArtistMetadataSimilarArtists = ({
    order,
    routeId,
}: AlbumArtistMetadataSimilarArtistsProps) => {
    const { t } = useTranslation();
    const server = useCurrentServer();
    const serverId = useCurrentServerId();

    const artistInfoQuery = useQuery({
        ...artistsQueries.albumArtistInfo({
            query: { id: routeId, limit: 10 },
            serverId: server?.id,
        }),
        enabled: Boolean(server?.id && routeId),
    });

    const relatedArtists = artistInfoQuery.data?.similarArtists ?? null;

    const similarArtists = useMemo(() => {
        if (!relatedArtists || relatedArtists.length === 0) {
            return [];
        }

        return relatedArtists.map(
            (relatedArtist: RelatedArtist): AlbumArtist => ({
                _itemType: LibraryItem.ALBUM_ARTIST,
                _serverId: serverId || '',
                _serverType: (server?.type as ServerType) || ServerType.JELLYFIN,
                albumCount: null,
                biography: null,
                blurHash: null,
                dominantColor: null,
                duration: null,
                genres: [],
                id: relatedArtist.id,
                imageId: relatedArtist.imageId,
                imageUrl: relatedArtist.imageUrl,
                lastPlayedAt: null,
                mbz: null,
                missing: null,
                name: relatedArtist.name,
                playCount: null,
                ratedAt: null,
                similarArtists: null,
                songCount: null,
                starredAt: null,
                thumbHash: null,
                userFavorite: relatedArtist.userFavorite,
                userRating: relatedArtist.userRating,
            }),
        );
    }, [relatedArtists, server?.type, serverId]);

    const carouselTitle = useMemo(
        () => (
            <div className={styles.similarArtistsTitle}>
                <TextTitle fw={700} order={3}>
                    {t('page.albumArtistDetail.relatedArtists')}
                </TextTitle>
                <div className={styles.albumSectionDividerContainer}>
                    <div className={styles.albumSectionDivider} />
                </div>
            </div>
        ),
        [t],
    );

    if (!artistInfoQuery.isLoading && similarArtists.length === 0) {
        return null;
    }

    return (
        <div className={artistColumns.item} style={columnOrder(order)}>
            <AlbumArtistGridCarousel
                data={similarArtists}
                excludeIds={[routeId]}
                isLoading={artistInfoQuery.isLoading}
                rowCount={1}
                title={carouselTitle}
            />
        </div>
    );
};

interface AlbumArtistDetailContentProps {
    albumsQuery: UseSuspenseQueryResult<AlbumListResponse, Error>;
    detailQuery: UseSuspenseQueryResult<AlbumArtistDetailResponse, Error>;
}

export const AlbumArtistDetailContent = ({
    albumsQuery,
    detailQuery,
}: AlbumArtistDetailContentProps) => {
    const artistItems = useArtistItems();
    const artistRadioCount = useArtistRadioCount();
    const { externalLinks, lastFM, listenBrainz, musicBrainz, nativeSpotify, qobuz, spotify } =
        useExternalLinks();
    const { albumArtistId, artistId } = useParams() as {
        albumArtistId?: string;
        artistId?: string;
    };
    const routeId = (artistId || albumArtistId) as string;
    const server = useCurrentServer();
    const { addToQueueByData } = usePlayer();

    const [enabledItem, itemOrder] = useMemo(() => {
        const enabled: { [key in ArtistItem]?: boolean } = {};
        const order: { [key in ArtistItem]?: number } = {};

        for (const [idx, item] of artistItems.entries()) {
            enabled[item.id] = !item.disabled;
            order[item.id] = idx + 1;
        }

        return [enabled, order];
    }, [artistItems]);

    const artistDiscographyLink = useMemo(
        () =>
            `${generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL_DISCOGRAPHY, {
                albumArtistId: routeId,
            })}?${createSearchParams({
                artistId: routeId,
                artistName: detailQuery.data?.name || '',
            })}`,
        [routeId, detailQuery.data?.name],
    );

    const artistSongsLink = useMemo(
        () =>
            `${generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL_SONGS, {
                albumArtistId: routeId,
            })}?${createSearchParams({
                artistId: routeId,
                artistName: detailQuery.data?.name || '',
            })}`,
        [routeId, detailQuery.data?.name],
    );

    // I-019: Navidrome's tag, unless the user chose a MusicBrainz artist for this
    // one. EVERYTHING below that feeds lb-bot or a MusicBrainz / ListenBrainz
    // link takes `mbzId`; only the override picker needs to know the tag too.
    const tagMbid = detailQuery.data?.mbz;
    const mbzId = useEffectiveArtistMbid(routeId, tagMbid);

    const handleArtistRadio = useCallback(async () => {
        const artistName = detailQuery.data?.name;
        if (!server?.id || !routeId || !artistName) return;
        // navi-connect (B-149): the artist's own most played songs, then a station from them
        // (with the engine) or Navidrome's similar songs.
        try {
            await playArtistRadio({
                artist: { id: routeId, name: artistName },
                count: artistRadioCount,
                player: { addToQueueByData },
                playType: Play.NOW,
                serverId: server.id,
            });
        } catch (error) {
            console.error('Failed to load artist radio:', error);
        }
    }, [addToQueueByData, artistRadioCount, detailQuery.data?.name, routeId, server.id]);

    // In one column the genres and the links come first, as before; in the side column they come last
    // (F7, board ArtistOwned). CSS `order` takes integers.
    const genresOrder = -2;
    const externalLinksOrder = -1;
    const sideLast = artistItems.length + 2;
    // The discography is "Recent albums" in the owner's list; its switch hides the left column.
    const showDiscography = enabledItem.recentAlbums !== false;

    return (
        <div className={styles.contentContainer}>
            <div className={styles.detailContainer}>
                <AlbumArtistActionButtons
                    artistDiscographyLink={artistDiscographyLink}
                    artistSongsLink={artistSongsLink}
                    onArtistRadio={handleArtistRadio}
                />
                {/* F7: two columns from a content width of 960 px, the discography on the left; one
                    column below that, in the page's own order (artist-columns.module.css). */}
                <div
                    className={artistColumns.layout}
                    data-main={showDiscography ? 'true' : 'false'}
                >
                    {showDiscography && (
                        <div className={artistColumns.main}>
                            <ArtistAlbums
                                albumsQuery={albumsQuery}
                                artistMbid={mbzId}
                                artistName={detailQuery.data?.name || ''}
                                order={itemOrder.recentAlbums}
                                tagMbid={tagMbid}
                            />
                        </div>
                    )}
                    <div className={artistColumns.side}>
                        <AlbumArtistMetadataGenres
                            genres={detailQuery.data?.genres}
                            order={genresOrder}
                            wideOrder={sideLast}
                        />
                        {externalLinks &&
                            (lastFM || listenBrainz || musicBrainz || qobuz || spotify) && (
                                <AlbumArtistMetadataExternalLinks
                                    artistName={detailQuery.data?.name}
                                    externalLinks={externalLinks}
                                    lastFM={lastFM}
                                    listenBrainz={listenBrainz}
                                    mbzId={mbzId}
                                    musicBrainz={musicBrainz}
                                    nativeSpotify={nativeSpotify}
                                    order={externalLinksOrder}
                                    qobuz={qobuz}
                                    spotify={spotify}
                                    wideOrder={sideLast + 1}
                                />
                            )}
                        {enabledItem.biography && (
                            <AlbumArtistMetadataBiography
                                artistMbid={mbzId}
                                artistName={detailQuery.data?.name}
                                order={itemOrder.biography}
                                routeId={routeId}
                            />
                        )}
                        {enabledItem.biography && (
                            <AlbumArtistMetadataLbBotExtras
                                artistMbid={mbzId}
                                artistName={detailQuery.data?.name}
                                order={itemOrder.biography}
                            />
                        )}
                        {enabledItem.similarArtists && (
                            <AlbumArtistMetadataSimilarArtists
                                order={itemOrder.similarArtists}
                                routeId={routeId}
                            />
                        )}
                        {enabledItem.topSongs && (
                            <AlbumArtistMetadataTopSongs
                                detailQuery={detailQuery}
                                order={itemOrder.topSongs}
                                routeId={routeId}
                            />
                        )}
                        {enabledItem.favoriteSongs && (
                            <AlbumArtistMetadataFavoriteSongs
                                order={itemOrder.favoriteSongs}
                                routeId={routeId}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

interface ArtistAlbumsProps {
    albumsQuery: UseSuspenseQueryResult<AlbumListResponse, Error>;
    artistMbid?: null | string;
    artistName: string;
    order?: number;
    /** Navidrome's own tag, for the override picker; `artistMbid` is the effective one. */
    tagMbid?: null | string;
}

/**
 * The discography (F7): every release, owned or missing, by kind, with the page's own filters, the
 * Rescan control and the MusicBrainz menu at the bar's right end.
 */
const ArtistAlbums = ({
    albumsQuery,
    artistMbid,
    artistName,
    order,
    tagMbid,
}: ArtistAlbumsProps) => {
    const { albumArtistId, artistId } = useParams() as {
        albumArtistId?: string;
        artistId?: string;
    };
    const routeId = (artistId || albumArtistId) as string;
    // Read here only for the menu; the discography reads the same artist itself (one cache entry).
    const discographyQuery = useLbBotDiscography(routeId, artistMbid);

    return (
        <div className={artistColumns.item} style={columnOrder(order)}>
            <Discography
                artistMbid={artistMbid}
                artistName={artistName}
                menu={
                    <LbBotIndexButton
                        artistMbid={artistMbid}
                        artistName={artistName}
                        discography={discographyQuery.data}
                        ndId={routeId}
                        tagMbid={tagMbid}
                    />
                }
                ndId={routeId}
                owned={albumsQuery.data?.items ?? NO_ALBUMS}
            />
        </div>
    );
};
