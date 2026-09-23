import clsx from 'clsx';
import { ReactNode } from 'react';

import styles from './discover-row.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { Text } from '/@/shared/components/text/text';
import { LibraryItem } from '/@/shared/types/domain-types';

/**
 * One card in a Discover row, shaped like the poster cards the rest of the app
 * uses rather than like Navic's tiles.
 *
 * It is not `ItemCard`, and the reason is routing rather than looks: `ItemCard`
 * derives its link from `getTitlePath(itemType, data.id)`, so every card it can
 * render is a library item. Half of what Discover shows is deliberately *not*
 * in the library — an unowned artist has no Navidrome id and belongs on the
 * virtual `mb:` page. So the destination is passed in, and everything else
 * (the image pipeline, its blurhash placeholder, its per-type unloader icon,
 * the surface, the radius) comes from the same components `ItemCard` uses.
 *
 * `ItemImage` is what makes the artwork appear at all: an owned artist is drawn
 * from Navidrome by id, an external release from the Cover Art Archive URL
 * lb-bot sends, and anything with neither falls back to the type's own empty
 * icon instead of a text-only tile.
 */
interface DiscoverTileProps {
    /**
     * A control laid over the cover — today the one-tap acquire on an unowned
     * release. Rendered as a sibling of the card's own button rather than inside
     * it, because a button within a button is markup browsers resolve by
     * dropping the inner one.
     */
    action?: ReactNode;
    /**
     * Artwork drawn instead of `ItemImage`, for a card whose picture is not a
     * library item's — today a mix, whose cover is either its seed's art or a
     * glyph naming the kind of recipe it is.
     */
    cover?: ReactNode;
    /** Navidrome id, for anything the library holds. */
    imageId?: null | string;
    /** A ready-made URL, for release art that lives outside the library. */
    imageUrl?: null | string;
    /**
     * A tap on this tile started a request that has not answered yet.
     *
     * Only the unmarked Deezer rows use it: their release-group id is looked up
     * on tap rather than on render, which is a MusicBrainz second. A card that
     * looks inert for a second gets tapped again, and a second tap is a second
     * search for the same row.
     */
    isBusy?: boolean;
    /** Artists are circles here, exactly as they are on the artist carousels. */
    isRound?: boolean;
    /** Faded and dashed, the same grammar the missing-album tiles use. */
    isUnowned?: boolean;
    itemType: LibraryItem;
    onClick: () => void;
    subtitle?: string;
    title: string;
}

export const DiscoverTile = ({
    action,
    cover,
    imageId,
    imageUrl,
    isBusy,
    isRound,
    isUnowned,
    itemType,
    onClick,
    subtitle,
    title,
}: DiscoverTileProps) => (
    <div className={styles.wrapper}>
        <button
            aria-busy={isBusy || undefined}
            className={styles.tile}
            disabled={isBusy}
            onClick={onClick}
            type="button"
        >
            {cover ?? (
                <ItemImage
                    className={styles.image}
                    containerClassName={clsx(styles.cover, {
                        [styles.round]: isRound,
                        [styles.unowned]: isUnowned,
                    })}
                    id={imageId}
                    itemType={itemType}
                    src={imageUrl}
                    type="itemCard"
                />
            )}
            <Text className={styles.name} size="sm">
                {title}
            </Text>
            {subtitle && (
                <Text className={styles.name} isMuted size="sm">
                    {subtitle}
                </Text>
            )}
        </button>
        {action}
    </div>
);
