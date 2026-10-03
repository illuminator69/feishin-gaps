import { Suspense, useMemo, useState } from 'react';

import styles from '../components/listening.module.css';

import { NativeScrollArea } from '/@/renderer/components/native-scroll-area/native-scroll-area';
import {
    isListeningUnavailable,
    ListeningReadError,
    useLbBotAvailable,
    useListeningRecent,
    useListeningStatus,
    useListeningSummary,
    useListeningSupported,
    useListeningUnowned,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    Genres,
    Heatmap,
    HoursChart,
    RecentSection,
    StatTiles,
    TopLists,
    UnownedSection,
} from '/@/renderer/features/listening/components/listening-sections';
import {
    DEFAULT_PERIOD,
    PERIOD_OPTIONS,
    statusView,
} from '/@/renderer/features/listening/listening-logic';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { LibraryContainer } from '/@/renderer/features/shared/components/library-container';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { useWindowSettings } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { LbBotListeningPeriod } from '/@/shared/types/lbbot-types';
import { Platform } from '/@/shared/types/types';

/**
 * navi-connect: My Listening — aggregates over the user's ListenBrainz history,
 * mirrored by lb-bot. Everything shown is a field of lb-bot's answer.
 *
 * By `status.state`: `off` → an explanation and nothing else; `importing` →
 * "Importing N of M" above whatever the summary already holds; `error` → the
 * stored numbers plus lb-bot's error text; `ready` → the numbers. Offline, the
 * persisted body for the period is shown with a note. A route that is not there
 * (lb-bot older than the hub, 404) shows one quiet sentence, never an error.
 */
const ListeningRoute = () => {
    const { windowBarStyle } = useWindowSettings();
    const [period, setPeriod] = useState<LbBotListeningPeriod>(DEFAULT_PERIOD);
    const [unownedKind, setUnownedKind] = useState<'album' | 'artist'>('album');

    const available = useLbBotAvailable();
    const supported = useListeningSupported();
    const statusQuery = useListeningStatus();
    const view = statusQuery.data ? statusView(statusQuery.data) : null;
    const summaryQuery = useListeningSummary(period, view?.poll === true);
    const unownedQuery = useListeningUnowned(period, unownedKind);
    const recentQuery = useListeningRecent();

    const summary = summaryQuery.data;
    const recentRows = useMemo(
        () => recentQuery.data?.pages.flatMap((page) => page.rows) ?? [],
        [recentQuery.data],
    );
    const unavailable = [statusQuery.error, summaryQuery.error].some(isListeningUnavailable);
    const off = view?.kind === 'off';
    const loading = supported && !summary && !off && summaryQuery.isPending;

    return (
        <NativeScrollArea
            pageHeaderProps={{
                backgroundColor: 'var(--theme-colors-background)',
                children: (
                    <LibraryHeaderBar>
                        <LibraryHeaderBar.Title>My Listening</LibraryHeaderBar.Title>
                    </LibraryHeaderBar>
                ),
                offset: 200,
            }}
        >
            <LibraryContainer>
                <Stack
                    gap="xl"
                    mb="5rem"
                    pt={windowBarStyle === Platform.WEB ? '5rem' : '3rem'}
                    px="2rem"
                >
                    <Text size="xl" weight={700}>
                        My Listening
                    </Text>
                    <SegmentedControl
                        data={PERIOD_OPTIONS}
                        onChange={(value) => setPeriod(value as LbBotListeningPeriod)}
                        value={period}
                    />

                    {unavailable || (!supported && !summary && available) ? (
                        <Text isMuted>
                            This lb-bot or hub does not provide listening history yet.
                        </Text>
                    ) : null}

                    {!supported && !available && !summary && (
                        <Text isMuted>
                            lb-bot is not reachable, so there is no listening history to read.
                        </Text>
                    )}

                    {!available && summary && (
                        <Text isMuted size="sm">
                            lb-bot is not reachable. Showing the last numbers it gave.
                        </Text>
                    )}

                    {view && view.kind !== 'ready' && (
                        <div className={styles.banner}>
                            <Text weight={600}>{view.headline}</Text>
                            <Text isMuted size="sm">
                                {view.detail}
                            </Text>
                        </div>
                    )}

                    {loading && <Spinner container />}

                    {/* A failure is not "nothing here": no body, not a 404 (that has
                        its own sentence), and the read errored. */}
                    {supported && !summary && !unavailable && !off && summaryQuery.isError && (
                        <Group gap="sm">
                            <Text isMuted>Could not load listening history.</Text>
                            <Button
                                onClick={() => void summaryQuery.refetch()}
                                size="compact-sm"
                                variant="default"
                            >
                                Retry
                            </Button>
                        </Group>
                    )}

                    {summary && !off && (
                        <>
                            {summary.totals.plays === 0 && view?.kind !== 'importing' && (
                                <Text isMuted>No listens in this period.</Text>
                            )}
                            <StatTiles summary={summary} />
                            <Heatmap summary={summary} />
                            <HoursChart summary={summary} />
                            <TopLists summary={summary} />
                            <Genres summary={summary} />
                            <UnownedSection
                                error={
                                    unownedQuery.error
                                        ? {
                                              message: unownedQuery.error.message,
                                              status:
                                                  unownedQuery.error instanceof ListeningReadError
                                                      ? unownedQuery.error.status
                                                      : 0,
                                          }
                                        : null
                                }
                                kind={unownedKind}
                                onKind={setUnownedKind}
                                rows={unownedQuery.data?.rows}
                            />
                            <RecentSection
                                hasMore={recentQuery.hasNextPage}
                                loadingMore={recentQuery.isFetchingNextPage}
                                onMore={() => void recentQuery.fetchNextPage()}
                                rows={recentRows}
                            />
                        </>
                    )}
                </Stack>
            </LibraryContainer>
        </NativeScrollArea>
    );
};

const ListeningRouteWithBoundary = () => (
    <PageErrorBoundary>
        <Suspense fallback={<Spinner container />}>
            <AnimatedPage>
                <ListeningRoute />
            </AnimatedPage>
        </Suspense>
    </PageErrorBoundary>
);

export default ListeningRouteWithBoundary;
