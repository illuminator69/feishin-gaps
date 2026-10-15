import { useNavigate } from 'react-router';

import styles from '../routes/lbbot-downloads-route.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import {
    caaCoverUrl,
    useLbBotWishlist,
    useWishlistActions,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { externalAlbumPathFor } from '/@/renderer/features/lbbot/utils/external-paths';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Skeleton } from '/@/shared/components/skeleton/skeleton';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { LibraryItem } from '/@/shared/types/domain-types';

/**
 * navi-connect: the wishlist - albums nobody was sharing when you asked.
 *
 * It exists because of one specific dead end. lb-bot reports `no_source`
 * only after walking its **entire** ranked source list, and it deliberately
 * never auto-retries that failure: re-running the identical search against the
 * identical peers under the identical format policy produces the identical
 * failure, so an automatic retry would be a busy loop that looks like progress.
 * `retryable: false` is the honest verdict on that request.
 *
 * What it is *not* a verdict on is the album. The Soulseek swarm changes over
 * hours - someone comes online, someone shares a folder - so the same search
 * tomorrow is a genuinely different search. The wishlist is where that slow
 * re-search lives, and it is the one place in this client where
 * `retryable: false` turns into an action rather than a shrug.
 *
 * Which is also why there is no "retry now" button here: pressing it would run
 * exactly the search that already failed. The waiting is the mechanism.
 *
 * It is a section of the Downloads page (a chip beside the ledger's), as on
 * Navic; it used to be a page of its own reached from a text link there.
 */
export const WishlistList = () => {
    const navigate = useNavigate();
    const { data, isError, isLoading } = useLbBotWishlist();
    const { remove } = useWishlistActions();
    const entries = data?.entries ?? [];
    // lb-bot's own cadence, rather than a number written here. The whole
    // mechanism is waiting, so "how long" is the first question this list has to
    // answer - and hard-coding it would be a sentence that quietly goes wrong
    // the day the sweep interval changes.
    const everyHours = data?.intervalSeconds
        ? Math.max(1, Math.round(data.intervalSeconds / 3600))
        : 0;

    if (isLoading) {
        return (
            <Stack gap="sm">
                <Skeleton height={74} />
                <Skeleton height={74} />
                <Skeleton height={74} />
            </Stack>
        );
    }

    // A failed read is not an empty wishlist: say which it is.
    if (isError && !data) {
        return <Text isMuted>Could not read the wishlist from lb-bot.</Text>;
    }

    if (entries.length === 0) {
        return (
            <Text isMuted>
                Nothing on the wishlist. When a download fails because nobody is sharing an album,
                you can put it here and lb-bot will keep looking
                {everyHours ? ` every ${everyHours} hours.` : ' periodically.'}
            </Text>
        );
    }

    return (
        <Stack gap="sm">
            {entries.map((entry) => (
                <div className={styles.row} key={entry.rgid}>
                    <ItemImage
                        className={styles.image}
                        containerClassName={styles.cover}
                        itemType={LibraryItem.ALBUM}
                        src={caaCoverUrl(entry.rgid)}
                        type="table"
                    />
                    <Stack className={styles.body} gap="0.15rem">
                        <Text isNoSelect lineClamp={1}>
                            {entry.title || entry.rgid}
                        </Text>
                        <Text isMuted size="sm">
                            {entry.artist}
                        </Text>
                        {/* How often it has looked, which is the only evidence
                            the user has that waiting is doing anything. There is
                            deliberately no "found it" state: a landing DELETES
                            the row and fires /lb/notify, so an album that arrives
                            simply leaves this list. */}
                        <Text isMuted size="sm">
                            {entry.attempts > 0
                                ? `Still looking - ${entry.attempts} ${entry.attempts === 1 ? 'search' : 'searches'} so far`
                                : 'Waiting for the first re-search'}
                        </Text>
                        {/* lb-bot's own sentence about the last attempt,
                            verbatim - the same rule the downloads ledger follows,
                            and for the same reason: it carries evidence no label
                            can. */}
                        {entry.lastReason && (
                            <Text isMuted lineClamp={2} size="sm">
                                {entry.lastReason}
                            </Text>
                        )}
                    </Stack>
                    <Group gap="xs" wrap="nowrap">
                        <Button
                            onClick={() =>
                                navigate(
                                    externalAlbumPathFor({
                                        artist: entry.artist,
                                        rgid: entry.rgid,
                                        title: entry.title,
                                    }),
                                )
                            }
                            variant="subtle"
                        >
                            Open
                        </Button>
                        <Button onClick={() => void remove(entry.rgid)} variant="subtle">
                            Remove
                        </Button>
                    </Group>
                </div>
            ))}
        </Stack>
    );
};
