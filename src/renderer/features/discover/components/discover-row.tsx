import { ReactNode } from 'react';
import { Link } from 'react-router';

import styles from './discover-row.module.css';

import { GridCarousel } from '/@/renderer/components/grid-carousel/grid-carousel-v2';
import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';

/**
 * The shell every Discover row renders inside.
 *
 * Two rules live here rather than in each row, because they are the two things
 * that went wrong everywhere else:
 *
 * 1. **A row with nothing to show renders nothing** — not a heading with an
 *    empty shelf under it, not a spinner that never resolves. Fresh, the
 *    similar-albums shelf and the CLAP entry each invented their own version of
 *    this and they do not agree.
 * 2. **`because` is not optional.** The attribution rule this stack follows is
 *    that a recommendation names the thing that justifies it; an unattributed
 *    shelf is indistinguishable from a popularity chart. Making it a required
 *    prop is what stops a row shipping without one.
 *
 * The rows page through `GridCarousel`, the same component the home carousels
 * use, so they get this app's own arrows, its keyboard and wheel paging and its
 * card sizing rather than a hand-rolled scroller. It takes an opaque
 * `{content, id}[]`, which is why an lb-bot row can use it directly while the
 * typed wrappers (`album-infinite-carousel` and friends) cannot — those are
 * bound to Navidrome queries. Paging is local: these lists arrive whole and
 * already ranked, so there is no next page to fetch and the handlers are
 * deliberately empty, exactly as `AlbumArtistGridCarousel` does it.
 */
interface DiscoverRowProps {
    /** The "why am I seeing this" line. Required, deliberately. */
    because: string;
    /** Cards to page through. Rows that are not cards pass `children`. */
    cards?: { content: ReactNode; id: string }[];
    children?: ReactNode;
    /** Render nothing at all when there is nothing to show. */
    isEmpty: boolean;
    /** Optional "see all" target, e.g. the full Fresh feed. */
    seeAll?: { label: string; to: string };
    title: string;
}

const noop = () => {};

export const DiscoverRow = ({
    because,
    cards,
    children,
    isEmpty,
    seeAll,
    title,
}: DiscoverRowProps) => {
    if (isEmpty) return null;

    const header = (
        <div className={styles.header}>
            <div className={styles.headerTitle}>
                <TextTitle fw={700} isNoSelect order={3}>
                    {title}
                </TextTitle>
                {seeAll && (
                    <Text isMuted size="sm">
                        <Link to={seeAll.to}>{seeAll.label}</Link>
                    </Text>
                )}
            </div>
            <Text isMuted size="sm">
                {because}
            </Text>
        </div>
    );

    if (!cards) {
        return (
            <Stack gap="md">
                {header}
                <div className={styles.chips}>{children}</div>
            </Stack>
        );
    }

    return <GridCarousel cards={cards} onNextPage={noop} onPrevPage={noop} title={header} />;
};
