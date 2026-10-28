import { CSSProperties, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generatePath, Link } from 'react-router';

import styles from './artist-shelves.module.css';

import { DataRow } from '/@/renderer/components/item-card/item-card';
import { useDefaultItemListControls } from '/@/renderer/components/item-list/helpers/item-list-controls';
import { useGridRows } from '/@/renderer/components/item-list/helpers/use-grid-rows';
import { ItemControls } from '/@/renderer/components/item-list/types';
import { kindLines, popularReleases } from '/@/renderer/features/discography/artist-shelves';
import {
    getItemsPerRow,
    TILE_BREAKPOINTS,
} from '/@/renderer/features/discography/components/discography';
import { ReleaseTile } from '/@/renderer/features/discography/components/release-tile';
import {
    type DiscographyItem,
    kindSettings,
} from '/@/renderer/features/discography/discography-model';
import { DEFAULT_VIEW, writeView } from '/@/renderer/features/discography/discography-view';
import { useArtistScan } from '/@/renderer/features/discography/hooks/use-artist-scan';
import { useDiscographyItems } from '/@/renderer/features/discography/hooks/use-discography-items';
import { type ReleaseKind } from '/@/renderer/features/discography/release-kind';
import { type ArrivalProps, useArrival } from '/@/renderer/features/motion/use-arrival';
import { useContainerQuery } from '/@/renderer/hooks';
import { AppRoute } from '/@/renderer/router/routes';
import { useArtistReleaseTypeItems } from '/@/renderer/store/settings.store';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Album, LibraryItem } from '/@/shared/types/domain-types';
import { ItemListKey } from '/@/shared/types/types';

interface ArtistShelvesProps {
    artistMbid?: null | string;
    artistName: string;
    ndId: string;
    owned: Album[];
}

/**
 * The owned artist page's releases (R2): one line of Popular releases, then one line per release
 * kind in Settings' order (kinds switched off there are left out), each one grid row of tiles with a
 * link to the whole discography, which is its own page. The page mounts a line's worth of tiles per
 * kind instead of every release.
 */
export const ArtistShelves = ({ artistMbid, artistName, ndId, owned }: ArtistShelvesProps) => {
    const { t } = useTranslation();
    const { albumsById, discography, items, known } = useDiscographyItems({
        artistMbid,
        ndId,
        owned,
    });
    const scan = useArtistScan({ artistMbid, artistName, discography, ndId });
    const releaseTypeItems = useArtistReleaseTypeItems();
    const rows = useGridRows(LibraryItem.ALBUM, ItemListKey.ALBUM);
    const controls = useDefaultItemListControls();
    const cq = useContainerQuery(TILE_BREAKPOINTS);
    const itemsPerRow = getItemsPerRow(cq);

    const popular = useMemo(() => popularReleases(items, itemsPerRow), [items, itemsPerRow]);
    const lines = useMemo(() => {
        const { disabled, order } = kindSettings(releaseTypeItems);
        return kindLines(items, order, disabled, itemsPerRow);
    }, [items, itemsPerRow, releaseTypeItems]);
    // Only Popular releases arrives; the kind lines appear with the page.
    const { propsFor } = useArrival(cq.isCalculated && popular.length > 0);

    const discographyPath = generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL_DISCOGRAPHY, {
        albumArtistId: ndId,
    });
    const kindPath = (kind: ReleaseKind) =>
        `${discographyPath}?${writeView({ ...DEFAULT_VIEW, type: kind }, new URLSearchParams())}`;
    // lb-bot's first scan: the lines show what the library has, and the link to the discography
    // (where the scan's bar and line are) says one is running.
    const scanning = scan.phase === 'running' && !known;

    const tileProps = { albumsById, artistMbid, artistName, controls, known, ndId, rows };

    return (
        <div className={styles.root} data-artist-shelves="" ref={cq.ref}>
            {cq.isCalculated && (
                <>
                    <section className={styles.line} data-line="popular">
                        <div className={styles.head}>
                            {popular.length > 0 && (
                                <h2 className={styles.title}>
                                    {t('page.albumArtistDetail.popularReleases')}
                                </h2>
                            )}
                            <Link
                                aria-busy={scanning || undefined}
                                className={styles.link}
                                data-scanning={scanning ? 'true' : undefined}
                                title={scanning ? scan.line : undefined}
                                to={discographyPath}
                            >
                                {scanning && <Spinner size={12} />}
                                {t('page.albumArtistDetail.seeDiscography')}
                            </Link>
                        </div>
                        {popular.length > 0 && (
                            <Row itemsPerRow={itemsPerRow}>
                                {popular.map((item, index) => (
                                    <Slot
                                        {...tileProps}
                                        arrivalFor={propsFor}
                                        index={index}
                                        item={item}
                                        key={item.key}
                                    />
                                ))}
                            </Row>
                        )}
                    </section>
                    {lines.map((line) => (
                        <section className={styles.line} data-line={line.kind} key={line.kind}>
                            <div className={styles.head}>
                                <h2 className={styles.title}>
                                    {t(`naviConnect.discography.kind.${line.kind}`)}{' '}
                                    <small className={styles.count}>{line.total}</small>
                                </h2>
                                {line.more && (
                                    <Link className={styles.link} to={kindPath(line.kind)}>
                                        {t('page.albumArtistDetail.seeAll')}
                                    </Link>
                                )}
                            </div>
                            <Row itemsPerRow={itemsPerRow}>
                                {line.items.map((item) => (
                                    <Tile {...tileProps} item={item} key={item.key} />
                                ))}
                            </Row>
                        </section>
                    ))}
                </>
            )}
        </div>
    );
};

/** The board's `.dg`, one row: a line never holds more tiles than fit across. */
const Row = ({ children, itemsPerRow }: { children: React.ReactNode; itemsPerRow: number }) => (
    <div className={styles.row} style={{ '--items-per-row': itemsPerRow } as CSSProperties}>
        {children}
    </div>
);

interface TileProps {
    albumsById: Map<string, Album>;
    arrival?: ArrivalProps;
    artistMbid?: null | string;
    artistName: string;
    controls: ItemControls;
    item: DiscographyItem;
    known: boolean;
    ndId: string;
    rows: DataRow[] | undefined;
}

const Tile = ({ albumsById, arrival, item, ndId, ...props }: TileProps) => (
    <ReleaseTile
        {...props}
        album={item.albumId ? albumsById.get(item.albumId) : undefined}
        arrival={arrival}
        item={item}
        ndArtistId={ndId}
    />
);

/** Fixes the arrival when the tile mounts, so a tile that stays through a resize does not replay it. */
const Slot = ({
    arrivalFor,
    index,
    ...props
}: Omit<TileProps, 'arrival'> & {
    arrivalFor: (index: number) => ArrivalProps | undefined;
    index: number;
}) => {
    const [arrival] = useState(() => arrivalFor(index));
    return <Tile {...props} arrival={arrival} />;
};
