import { Suspense } from 'react';
import { useParams, useSearchParams } from 'react-router';

import styles from './lbbot-fresh-route.module.css';

import { useArtistAlbumsGrouped } from '/@/renderer/features/artists/hooks/use-artist-albums-grouped';
import { LbBotIndexButton } from '/@/renderer/features/lbbot/components/lbbot-index-button';
import { MetaAbout } from '/@/renderer/features/lbbot/components/meta-about';
import { MissingAlbumTile } from '/@/renderer/features/lbbot/components/missing-album-tile';
import {
    useLbBotArtistMeta,
    useLbBotAvailable,
    useLbBotDiscography,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { ForkDetailPage } from '/@/renderer/features/shared/components/fork-detail-page';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { AppRoute } from '/@/renderer/router/routes';
import { Badge } from '/@/shared/components/badge/badge';
import { Group } from '/@/shared/components/group/group';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';
import { Album, LibraryItem } from '/@/shared/types/domain-types';

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

    const ndId = `mb:${artistMbid}`;
    const available = useLbBotAvailable();
    // From the local index mirror when lb-bot has indexed this artist — looked up
    // by the MBID first, exactly as lb-bot's own read does for an `mb:` id — so
    // an artist scanned once renders at once, offline included. The network
    // read is the fallback for one it has not.
    const discography = useLbBotDiscography(artistMbid ? ndId : '', artistMbid);
    // A disabled react-query stays `pending`, so gate the spinner on lb-bot actually
    // being there — otherwise this page spins forever with the feature switched off.
    const loading = available && discography.isLoading;
    // lb-bot's own name for the artist once it has scanned them; the link that got
    // here carries one meanwhile.
    const artistName = discography.data?.artistName || search.get('name') || '';

    // On an unowned artist lb-bot is the ONLY possible source of an About:
    // there is no Navidrome record to carry a biography, so no metadata agent
    // can ever answer for this page. That is the reason the editorial layer
    // lives in lb-bot rather than in a Navidrome plugin, and until now it was
    // the one page that never showed it.
    //
    // Nothing here can flash: there is no competing text to arrive first.
    const meta = useLbBotArtistMeta(artistMbid, artistName).data;

    const { releaseTypeEntries } = useArtistAlbumsGrouped(
        NO_ALBUMS,
        ndId,
        discography.data?.releases ?? [],
    );

    const indexed = discography.data?.indexed === true;
    const releaseCount = discography.data?.releases.length ?? 0;

    return (
        <ForkDetailPage
            headerChildren={
                <Stack gap="sm">
                    <Text isMuted>
                        Not in your library. This discography comes from MusicBrainz via lb-bot.
                    </Text>
                    <Group>
                        <Badge>Not in your library</Badge>
                    </Group>
                </Stack>
            }
            itemType={LibraryItem.ALBUM_ARTIST}
            route={AppRoute.LIBRARY_ALBUM_ARTISTS}
            title={artistName || 'Artist'}
        >
            {meta && <MetaAbout meta={meta} />}

            <LbBotIndexButton
                artistMbid={artistMbid}
                artistName={artistName}
                discography={discography.data}
                ndId={ndId}
            />

            {/* Not while the mirror is answering: a discography
                already on screen is the one thing this sentence
                would contradict. */}
            {!available && !discography.data && (
                <Text isMuted>
                    lb-bot is not configured on your hub, so there is nothing to read this
                    discography from.
                </Text>
            )}

            {loading && <Spinner container />}

            {!loading && discography.data && !indexed && (
                <Text isMuted>
                    lb-bot hasn&apos;t scanned this artist yet. &quot;Find missing albums&quot;
                    walks MusicBrainz at one request a second, so a long discography takes a minute.
                </Text>
            )}

            {!loading && indexed && releaseCount === 0 && (
                <Text isMuted>
                    lb-bot scanned this artist and found no releases. A rescan is idempotent if that
                    looks wrong.
                </Text>
            )}

            {releaseTypeEntries.map((entry) =>
                entry.missing.length === 0 ? null : (
                    <Stack gap="md" key={entry.releaseType}>
                        {/* The artist page's section heading: a title, its count, a rule. */}
                        <div className={styles.bucket}>
                            <Group>
                                <TextTitle fw={700} order={3}>
                                    {entry.displayName}
                                </TextTitle>
                                <Badge>{entry.missing.length}</Badge>
                            </Group>
                            <div className={styles.bucketRule} />
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
        </ForkDetailPage>
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
