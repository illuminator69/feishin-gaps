import { ReactNode } from 'react';
import { Link } from 'react-router';

import styles from './discover-row.module.css';

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
 */
interface DiscoverRowProps {
    /** The "why am I seeing this" line. Required, deliberately. */
    because: string;
    children: ReactNode;
    /** Render nothing at all when there is nothing to show. */
    isEmpty: boolean;
    /** Optional "see all" target, e.g. the full Fresh feed. */
    seeAll?: { label: string; to: string };
    title: string;
}

export const DiscoverRow = ({ because, children, isEmpty, seeAll, title }: DiscoverRowProps) => {
    if (isEmpty) return null;

    return (
        <Stack gap="sm">
            <Stack gap={0}>
                <div className={styles.header}>
                    <TextTitle fw={700} order={3}>
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
            </Stack>
            <div className={styles.shelf}>{children}</div>
        </Stack>
    );
};

export { styles as discoverRowStyles };
