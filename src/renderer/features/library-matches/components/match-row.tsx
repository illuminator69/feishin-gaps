import clsx from 'clsx';
import { ReactNode } from 'react';
import { generatePath, Link } from 'react-router';

import styles from './match-row.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { RowLook } from '/@/renderer/features/lbbot/utils/matches-page';
import { useLibraryContextMenu } from '/@/renderer/features/shared/hooks/use-library-context-menu';
import { AppRoute } from '/@/renderer/router/routes';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { LibraryItem } from '/@/shared/types/domain-types';

/**
 * One row of the Library Matches page: a thumbnail, a title, muted lines, the row's
 * actions on the right - the grammar the Downloads and Discover rows already use.
 *
 * The picture is the app's own `ItemImage` (the component the artist and album
 * lists use): it builds the URL from the Navidrome id the row already has, loads
 * lazily in the viewport, and draws the app's placeholder when there is no id or
 * the image is gone - so a long list asks for nothing per row. The title and the
 * picture link to the artist or album page only while `look.linkId` says that page
 * is alive.
 */
export const MatchRow = ({
    actions,
    children,
    itemType,
    look,
    subtitle,
    title,
}: {
    actions?: ReactNode;
    /** Further lines under the subtitle: statuses, progress, problems. */
    children?: ReactNode;
    itemType: LibraryItem.ALBUM | LibraryItem.ALBUM_ARTIST;
    look: RowLook;
    subtitle?: ReactNode;
    title: string;
}) => {
    const openMenu = useLibraryContextMenu();
    const to = look.linkId
        ? itemType === LibraryItem.ALBUM
            ? generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: look.linkId })
            : generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, { albumArtistId: look.linkId })
        : null;
    const image = (
        <ItemImage
            className={styles.image}
            containerClassName={clsx(styles.thumb, {
                [styles.round]: itemType === LibraryItem.ALBUM_ARTIST,
            })}
            id={look.imageId}
            itemType={itemType}
            src={look.imageUrl}
            type="table"
        />
    );
    return (
        <div
            className={styles.row}
            // The app's own album or artist menu, for a row whose id is live: the same
            // rule that makes it a link.
            onContextMenu={(event) =>
                void openMenu(
                    event,
                    look.linkId
                        ? {
                              id: look.linkId,
                              kind: itemType === LibraryItem.ALBUM ? 'album' : 'artist',
                          }
                        : null,
                )
            }
        >
            {to ? <Link to={to}>{image}</Link> : image}
            <Stack className={styles.body} gap={2}>
                {to ? (
                    <Text className={styles.title} component={Link} isLink size="sm" to={to}>
                        {title}
                    </Text>
                ) : (
                    <Text className={styles.title} size="sm">
                        {title}
                    </Text>
                )}
                {subtitle && (
                    <Text isMuted size="xs">
                        {subtitle}
                    </Text>
                )}
                {children}
            </Stack>
            {actions && (
                <Group className={styles.actions} gap="xs" wrap="nowrap">
                    {actions}
                </Group>
            )}
        </div>
    );
};
