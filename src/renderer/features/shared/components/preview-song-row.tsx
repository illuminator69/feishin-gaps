import clsx from 'clsx';

import styles from './preview-song-row.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { LibraryItem } from '/@/shared/types/domain-types';

/**
 * One song in a fork preview list (a saved queue, a mix sample, a mood search): the cover the
 * library already has for it, title over artist and album, and a trailing value. Rows in the
 * app's own lists carry their art; these were text-only lines.
 */
export const PreviewSongRow = ({
    current = false,
    imageId,
    imageUrl,
    index,
    serverId,
    subtitle,
    title,
    trailing,
}: {
    current?: boolean;
    imageId?: null | string;
    imageUrl?: null | string;
    index?: number;
    serverId?: null | string;
    subtitle?: string;
    title: string;
    trailing?: string;
}) => (
    <div
        className={clsx(styles.row, {
            [styles.current]: current,
            [styles.withIndex]: index !== undefined,
        })}
    >
        {index !== undefined && (
            <Text className={styles.index} isMuted size="xs">
                {index}
            </Text>
        )}
        <ItemImage
            className={styles.image}
            containerClassName={styles.thumb}
            id={imageId}
            itemType={LibraryItem.SONG}
            serverId={serverId}
            src={imageUrl}
            type="table"
        />
        <Stack className={styles.text} gap={0}>
            <Text lineClamp={1} size="sm">
                {title}
            </Text>
            {subtitle && (
                <Text isMuted lineClamp={1} size="xs">
                    {subtitle}
                </Text>
            )}
        </Stack>
        {trailing ? (
            <Text className={styles.trailing} isMuted size="xs">
                {trailing}
            </Text>
        ) : (
            <span />
        )}
    </div>
);
