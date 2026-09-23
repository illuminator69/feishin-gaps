import clsx from 'clsx';

import styles from './title-column.module.css';

import { ItemDetailListCellProps } from '/@/renderer/components/item-list/item-detail-list/columns/types';
import { useIsCurrentSong } from '/@/renderer/features/player/hooks/use-is-current-song';
import { PreviewIndicator } from '/@/renderer/features/preview/components/preview-indicator';
import { ExplicitIndicator } from '/@/shared/components/explicit-indicator/explicit-indicator';

export const TitleCombinedColumn = ({ song }: ItemDetailListCellProps) => {
    const { isActive } = useIsCurrentSong(song);

    return (
        <span className={clsx({ [styles.active]: isActive })}>
            <ExplicitIndicator explicitStatus={song.explicitStatus} />
            <PreviewIndicator id={song.id} />
            {[song.name, song.artistName].filter(Boolean).join(' — ') ?? <>&nbsp;</>}
        </span>
    );
};
