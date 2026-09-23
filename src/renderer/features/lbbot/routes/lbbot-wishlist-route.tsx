import { Suspense } from 'react';
import { useNavigate } from 'react-router';

import styles from './lbbot-downloads-route.module.css';

import { NativeScrollArea } from '/@/renderer/components/native-scroll-area/native-scroll-area';
import {
    caaCoverUrl,
    useLbBotWishlist,
    useWishlistActions,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { externalAlbumPathFor } from '/@/renderer/features/lbbot/utils/external-paths';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { LibraryContainer } from '/@/renderer/features/shared/components/library-container';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { AppRoute } from '/@/renderer/router/routes';
import { useWindowSettings } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { Platform } from '/@/shared/types/types';

/**
 * navi-connect: the wishlist — albums nobody was sharing when you asked.
 *
 * This page exists because of one specific dead end. lb-bot reports `no_source`
 * only after walking its **entire** ranked source list, and it deliberately
 * never auto-retries that failure: re-running the identical search against the
 * identical peers under the identical format policy produces the identical
 * failure, so an automatic retry would be a busy loop that looks like progress.
 * `retryable: false` is the honest verdict on that request.
 *
 * What it is *not* a verdict on is the album. The Soulseek swarm changes over
 * hours — someone comes online, someone shares a folder — so the same search
 * tomorrow is a genuinely different search. The wishlist is where that slow
 * re-search lives, and it is the one place in this client where
 * `retryable: false` turns into an action rather than a shrug.
 *
 * Which is also why there is no "retry now" button here: pressing it would run
 * exactly the search that already failed. The waiting is the mechanism.
 */
const LbBotWishlistRoute = () => {
    const navigate = useNavigate();
    const { data, isLoading } = useLbBotWishlist();
    const { remove } = useWishlistActions();
    const { windowBarStyle } = useWindowSettings();
    const entries = data?.entries ?? [];
    // lb-bot's own cadence, rather than a number written here. The whole
    // mechanism is waiting, so "how long" is the first question this page has to
    // answer — and hard-coding it would be a sentence that quietly goes wrong
    // the day the sweep interval changes.
    const everyHours = data?.intervalSeconds
        ? Math.max(1, Math.round(data.intervalSeconds / 3600))
        : 0;

    return (
        <AnimatedPage>
            <NativeScrollArea
                pageHeaderProps={{
                    backgroundColor: 'var(--theme-colors-background)',
                    children: (
                        <LibraryHeaderBar>
                            <LibraryHeaderBar.Title>Wishlist</LibraryHeaderBar.Title>
                        </LibraryHeaderBar>
                    ),
                    offset: 200,
                }}
            >
                <LibraryContainer>
                    <Stack
                        gap="lg"
                        mb="5rem"
                        pt={windowBarStyle === Platform.WEB ? '5rem' : '3rem'}
                        px="2rem"
                    >
                        <Group justify="space-between">
                            <Text size="xl" weight={700}>
                                Wishlist
                            </Text>
                            <Button onClick={() => navigate(AppRoute.DOWNLOADS)} variant="subtle">
                                Downloads
                            </Button>
                        </Group>
                        {isLoading ? (
                            <Spinner container />
                        ) : entries.length === 0 ? (
                            <Text isMuted>
                                Nothing on the wishlist. When a download fails because nobody is
                                sharing an album, you can put it here and lb-bot will keep looking
                                {everyHours ? ` every ${everyHours} hours.` : ' periodically.'}
                            </Text>
                        ) : (
                            <Stack gap="sm">
                                {entries.map((entry) => (
                                    <div className={styles.row} key={entry.rgid}>
                                        <img
                                            alt=""
                                            className={styles.cover}
                                            src={caaCoverUrl(entry.rgid)}
                                        />
                                        <Stack className={styles.body} gap="0.15rem">
                                            <Text isNoSelect lineClamp={1}>
                                                {entry.title || entry.rgid}
                                            </Text>
                                            <Text isMuted size="sm">
                                                {entry.artist}
                                            </Text>
                                            {/* How often it has looked, which is
                                                the only evidence the user has
                                                that waiting is doing anything.
                                                There is deliberately no "found
                                                it" state: a landing DELETES the
                                                row and fires /lb/notify, so an
                                                album that arrives simply leaves
                                                this list. */}
                                            <Text isMuted size="sm">
                                                {entry.attempts > 0
                                                    ? `Still looking — ${entry.attempts} ${entry.attempts === 1 ? 'search' : 'searches'} so far`
                                                    : 'Waiting for the first re-search'}
                                            </Text>
                                            {/* lb-bot's own sentence about the
                                                last attempt, verbatim — the same
                                                rule the downloads ledger
                                                follows, and for the same reason:
                                                it carries evidence no label
                                                can. */}
                                            {entry.lastReason && (
                                                <Text isMuted lineClamp={2} size="sm">
                                                    {entry.lastReason}
                                                </Text>
                                            )}
                                        </Stack>
                                        <Group gap="xs">
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
                                            <Button
                                                onClick={() => void remove(entry.rgid)}
                                                variant="subtle"
                                            >
                                                Remove
                                            </Button>
                                        </Group>
                                    </div>
                                ))}
                            </Stack>
                        )}
                    </Stack>
                </LibraryContainer>
            </NativeScrollArea>
        </AnimatedPage>
    );
};

const LbBotWishlistRouteWithBoundary = () => (
    <PageErrorBoundary>
        <Suspense fallback={<Spinner container />}>
            <LbBotWishlistRoute />
        </Suspense>
    </PageErrorBoundary>
);

export default LbBotWishlistRouteWithBoundary;
