import type { MouseEvent } from 'react';

import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import styles from './hero-actions.module.css';

import { useIsMutatingCreateFavorite } from '/@/renderer/features/shared/mutations/create-favorite-mutation';
import { useIsMutatingDeleteFavorite } from '/@/renderer/features/shared/mutations/delete-favorite-mutation';
import { useIsMutatingRating } from '/@/renderer/features/shared/mutations/set-rating-mutation';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { AppIconSelection, Icon } from '/@/shared/components/icon/icon';
import { Rating } from '/@/shared/components/rating/rating';
import { Spinner } from '/@/shared/components/spinner/spinner';

/** One labelled button in the row: a link when it has `to`, a button otherwise. */
export interface HeroAction {
    /** Disabled with a spinner in place of its icon (the player fetching a radio). */
    busy?: boolean;
    icon?: AppIconSelection;
    key: string;
    label: string;
    onClick?: () => void;
    to?: string;
    variant: 'accent-outline' | 'filled' | 'outline';
}

interface HeroActionsProps {
    actions: HeroAction[];
    favorite?: boolean;
    onFavorite?: () => void;
    onMore?: (e: MouseEvent<HTMLButtonElement>) => void;
    onPlay: () => void;
    onRating?: (n: number) => void;
    rating?: number;
}

/**
 * The board's action row under a hero header (`.cta`): the round Play on the accent, the labelled
 * buttons, then rating, favourite and more at the right. It wraps onto a second line in a narrow
 * column rather than overflow.
 */
export const HeroActions = ({
    actions,
    favorite,
    onFavorite,
    onMore,
    onPlay,
    onRating,
    rating,
}: HeroActionsProps) => {
    const { t } = useTranslation();
    const isMutatingRating = useIsMutatingRating();
    const isMutatingCreateFavorite = useIsMutatingCreateFavorite();
    const isMutatingDeleteFavorite = useIsMutatingDeleteFavorite();
    const isMutatingFavorite = isMutatingCreateFavorite || isMutatingDeleteFavorite;

    return (
        <div className={styles.row}>
            <button
                aria-label={t('player.play')}
                className={styles.play}
                onClick={onPlay}
                type="button"
            >
                <Icon icon="mediaPlay" size={22} />
            </button>
            {actions.map((action) => {
                const content = (
                    <>
                        {action.busy ? (
                            <Spinner size={16} />
                        ) : (
                            action.icon && <Icon icon={action.icon} size={16} />
                        )}
                        {action.label}
                    </>
                );
                return action.to ? (
                    <Link
                        className={styles.button}
                        data-variant={action.variant}
                        key={action.key}
                        onClick={action.onClick}
                        to={action.to}
                    >
                        {content}
                    </Link>
                ) : (
                    <button
                        aria-busy={action.busy || undefined}
                        className={styles.button}
                        data-variant={action.variant}
                        disabled={action.busy}
                        key={action.key}
                        onClick={action.onClick}
                        type="button"
                    >
                        {content}
                    </button>
                );
            })}
            {(onRating || onFavorite || onMore) && (
                <div className={styles.end}>
                    {onRating && (
                        <Rating
                            onChange={onRating}
                            readOnly={isMutatingRating}
                            size="md"
                            value={rating || 0}
                        />
                    )}
                    {onFavorite && (
                        <ActionIcon
                            aria-label={t(
                                favorite ? 'action.removeFromFavorites' : 'action.addToFavorites',
                            )}
                            disabled={isMutatingFavorite}
                            icon="favorite"
                            iconProps={{ fill: favorite ? 'primary' : undefined }}
                            onClick={onFavorite}
                            size="lg"
                            variant="transparent"
                        />
                    )}
                    {onMore && (
                        <ActionIcon
                            icon="ellipsisHorizontal"
                            onClick={onMore}
                            size="lg"
                            variant="transparent"
                        />
                    )}
                </div>
            )}
        </div>
    );
};
