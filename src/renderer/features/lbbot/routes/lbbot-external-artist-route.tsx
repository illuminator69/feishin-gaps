import { Suspense } from 'react';
import { useParams, useSearchParams } from 'react-router';

import styles from './lbbot-fresh-route.module.css';

import { NativeScrollArea } from '/@/renderer/components/native-scroll-area/native-scroll-area';
import { useArtistAlbumsGrouped } from '/@/renderer/features/artists/hooks/use-artist-albums-grouped';
import { LbBotIndexButton } from '/@/renderer/features/lbbot/components/lbbot-index-button';
import { MissingAlbumTile } from '/@/renderer/features/lbbot/components/missing-album-tile';
import { useLbBotAvailable, useLbBotDiscography } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { LibraryContainer } from '/@/renderer/features/shared/components/library-container';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { useWindowSettings } from '/@/renderer/store';
import { Badge } from '/@/shared/components/badge/badge';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { Album } from '/@/shared/types/domain-types';
import { Platform } from '/@/shared/types/types';

/**
 * navi-connect: an artist page for someone the library has nothing by.
 *
 * Keyed on the MusicBrainz artist id in the `mb:` form lb-bot's own scan already
 * understands — `api_artist_discography` treats an `mb:`-prefixed `nd_id` as
 * external, skips the library match, and classifies everything `missing`.
 *
 * Grouped by release type through the **same** hook the owned artist page uses, so
 * the two groupings cannot drift apart: an unowned artist's Albums section is
 * built by the rule that builds an owned one's.
 */

// Module-level so the grouping memo isn't invalidated by a fresh [] every render.
const NO_ALBUMS: Album[] = [];

const LbBotExternalArtistRoute = () => {
    const { artistMbid } = useParams() as { artistMbid: string };
    const [search] = useSearchParams();
    const { windowBarStyle } = useWindowSettings();

    const ndId = `mb:${artistMbid}`;
    const available = useLbBotAvailable();
    const discography = useLbBotDiscography(artistMbid ? ndId : '', artistMbid);
    // A disabled react-query stays `pending`, so gate the spinner on lb-bot actually
    // being there — otherwise this page spins forever with the feature switched off.
    const loading = available && discography.isLoading;
    // lb-bot's own name for the artist once it has scanned them; the link that got
    // here carries one meanwhile.
    const artistName = discography.data?.artistName || search.get('name') || '';

    const { releaseTypeEntries } = useArtistAlbumsGrouped(
        NO_ALBUMS,
        ndId,
        discography.data?.releases ?? [],
    );

    const indexed = discography.data?.indexed === true;
    const releaseCount = discography.data?.releases.length ?? 0;

    return (
        <AnimatedPage>
            <NativeScrollArea
                pageHeaderProps={{
                    backgroundColor: 'var(--theme-colors-background)',
                    children: (
                        <LibraryHeaderBar>
                            <LibraryHeaderBar.Title>
                                {artistName || 'Artist'}
                            </LibraryHeaderBar.Title>
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
                        <Stack gap="xs">
                            <Text size="xl" weight={700}>
                                {artistName || 'Artist'}
                            </Text>
                            <Text isMuted size="sm">
                                Not in your library — this discography comes from MusicBrainz via
                                lb-bot.
                            </Text>
                        </Stack>

                        <LbBotIndexButton
                            artistMbid={artistMbid}
                            artistName={artistName}
                            discography={discography.data}
                            ndId={ndId}
                        />

                        {!available && (
                            <Text isMuted>
                                lb-bot is not configured on your hub, so there is nothing to read
                                this discography from.
                            </Text>
                        )}

                        {loading && <Spinner container />}

                        {!loading && discography.data && !indexed && (
                            <Text isMuted>
                                lb-bot hasn&apos;t scanned this artist yet. &quot;Find missing
                                albums&quot; walks MusicBrainz at one request a second, so a long
                                discography takes a minute.
                            </Text>
                        )}

                        {!loading && indexed && releaseCount === 0 && (
                            <Text isMuted>
                                lb-bot scanned this artist and found no releases. A rescan is
                                idempotent if that looks wrong.
                            </Text>
                        )}

                        {releaseTypeEntries.map((entry) =>
                            entry.missing.length === 0 ? null : (
                                <Stack gap="md" key={entry.releaseType}>
                                    <div className={styles.bucket}>
                                        <Text isNoSelect weight={600}>
                                            {entry.displayName}
                                        </Text>
                                        <div className={styles.bucketRule} />
                                        <Badge variant="default">{entry.missing.length}</Badge>
                                    </div>
                                    <div className={styles.grid}>
                                        {entry.missing.map((release) => (
                                            <MissingAlbumTile
                                                artistName={artistName}
                                                key={release.rgid}
                                                ndArtistId={ndId}
                                                release={release}
                                            />
                                        ))}
                                    </div>
                                </Stack>
                            ),
                        )}
                    </Stack>
                </LibraryContainer>
            </NativeScrollArea>
        </AnimatedPage>
    );
};

const LbBotExternalArtistRouteWithBoundary = () => (
    <PageErrorBoundary>
        <Suspense fallback={<Spinner container />}>
            <LbBotExternalArtistRoute />
        </Suspense>
    </PageErrorBoundary>
);

export default LbBotExternalArtistRouteWithBoundary;
