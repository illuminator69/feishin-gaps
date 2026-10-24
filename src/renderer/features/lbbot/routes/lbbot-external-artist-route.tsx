import { Suspense } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { Discography } from '/@/renderer/features/discography/components/discography';
import { LbBotIndexButton } from '/@/renderer/features/lbbot/components/lbbot-index-button';
import { MetaAbout } from '/@/renderer/features/lbbot/components/meta-about';
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
import { Text } from '/@/shared/components/text/text';
import { LibraryItem } from '/@/shared/types/domain-types';

/**
 * navi-connect: an artist page for someone the library has nothing by.
 *
 * Keyed on the MusicBrainz artist id in the `mb:` form lb-bot's own scan already
 * understands — `api_artist_discography` treats an `mb:`-prefixed `nd_id` as
 * external, skips the library match, and classifies everything `missing`.
 *
 * The discography is the **same** component the owned artist page renders (F7),
 * over the same model, so the two pages' kinds cannot drift apart.
 */

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

    return (
        <ForkDetailPage
            headerChildren={
                <Stack gap="sm">
                    <Text isMuted>
                        Not in your library. This discography comes from MusicBrainz via lb-bot.
                    </Text>
                    <Group gap="sm">
                        <Badge>Not in your library</Badge>
                    </Group>
                </Stack>
            }
            itemType={LibraryItem.ALBUM_ARTIST}
            route={AppRoute.LIBRARY_ALBUM_ARTISTS}
            title={artistName || 'Artist'}
        >
            {meta && <MetaAbout meta={meta} />}

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

            {available || discography.data ? (
                <Discography
                    artistMbid={artistMbid}
                    artistName={artistName}
                    menu={
                        <LbBotIndexButton
                            artistMbid={artistMbid}
                            artistName={artistName}
                            discography={discography.data}
                            ndId={ndId}
                        />
                    }
                    ndId={ndId}
                    owned={null}
                />
            ) : null}
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
