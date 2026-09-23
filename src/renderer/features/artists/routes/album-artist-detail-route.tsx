import { useQuery, useSuspenseQueries } from '@tanstack/react-query';
import { Suspense, useRef } from 'react';
import { useParams } from 'react-router';

import { useItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { NativeScrollArea } from '/@/renderer/components/native-scroll-area/native-scroll-area';
import { useNativeScrollPersist } from '/@/renderer/components/native-scroll-area/use-native-scroll-persist';
import { albumQueries } from '/@/renderer/features/albums/api/album-api';
import { artistsQueries } from '/@/renderer/features/artists/api/artists-api';
import { AlbumArtistDetailContent } from '/@/renderer/features/artists/components/album-artist-detail-content';
import { AlbumArtistDetailHeader } from '/@/renderer/features/artists/components/album-artist-detail-header';
import {
    useIndexMirrorReady,
    useLbBotDiscography,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import {
    LibraryBackgroundImage,
    LibraryBackgroundOverlay,
} from '/@/renderer/features/shared/components/library-background-overlay';
import { LibraryContainer } from '/@/renderer/features/shared/components/library-container';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { useFastAverageColor } from '/@/renderer/hooks';
import { useArtistBackground, useCurrentServer, useCurrentServerId } from '/@/renderer/store';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { AlbumListSort, LibraryItem, SortOrder } from '/@/shared/types/domain-types';

const AlbumArtistDetailRouteContent = () => {
    const scrollAreaRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLDivElement>(null);
    const server = useCurrentServer();
    const serverId = useCurrentServerId();
    const { artistBackground, artistBackgroundBlur } = useArtistBackground();

    useNativeScrollPersist({ enabled: true, scrollRef: scrollAreaRef });

    const { albumArtistId, artistId } = useParams() as {
        albumArtistId?: string;
        artistId?: string;
    };

    const routeId = (artistId || albumArtistId) as string;

    const [detailQuery, albumsQuery] = useSuspenseQueries({
        queries: [
            artistsQueries.albumArtistDetail({ query: { id: routeId }, serverId: server?.id }),
            albumQueries.list({
                query: {
                    artistIds: [routeId],
                    limit: -1,
                    sortBy: AlbumListSort.RELEASE_DATE,
                    sortOrder: SortOrder.DESC,
                    startIndex: 0,
                },
                serverId,
            }),
        ],
    });
    // navi-connect: and for lb-bot's index mirror to have been read from disk,
    // which it almost always already has. Waiting for it here, beside the
    // Navidrome queries this page suspends on anyway, is what lets the album
    // grid below paint its owned and missing tiles in one pass: a lookup
    // against a mirror not yet loaded would miss, and the missing tiles would
    // then splice in a moment later and shift everything under them.
    useIndexMirrorReady();

    const imageUrl = useItemImageUrl({
        id: detailQuery.data?.imageId || undefined,
        imageUrl: detailQuery.data?.imageUrl,
        itemType: LibraryItem.ALBUM_ARTIST,
        type: 'header',
    });

    const libraryBackgroundImageUrl = useItemImageUrl({
        id: detailQuery.data?.imageId || undefined,
        imageUrl: detailQuery.data?.imageUrl,
        itemType: LibraryItem.ALBUM_ARTIST,
        type: 'itemCard',
    });

    const selectedImageUrl = imageUrl || detailQuery.data?.imageUrl;

    const { background: backgroundColor } = useFastAverageColor({
        id: artistId,
        src: selectedImageUrl,
        srcLoaded: true,
    });

    const background = backgroundColor;

    const showBlurredImage = artistBackground;

    // if (isColorLoading) {
    //     return <Spinner container />;
    // }

    return (
        <AnimatedPage key={`album-artist-detail-${routeId}`}>
            <NativeScrollArea
                pageHeaderProps={{
                    backgroundColor: backgroundColor || undefined,
                    children: (
                        <LibraryHeaderBar>
                            <LibraryHeaderBar.PlayButton
                                ids={[routeId]}
                                itemType={LibraryItem.ALBUM_ARTIST}
                                variant="default"
                            />
                            <LibraryHeaderBar.Title>
                                {detailQuery.data?.name}
                            </LibraryHeaderBar.Title>
                        </LibraryHeaderBar>
                    ),
                    offset: 200,
                    target: headerRef,
                }}
                ref={scrollAreaRef}
            >
                {showBlurredImage ? (
                    <LibraryBackgroundImage
                        blur={artistBackgroundBlur}
                        headerRef={headerRef}
                        imageUrl={libraryBackgroundImageUrl || ''}
                    />
                ) : (
                    <LibraryBackgroundOverlay backgroundColor={background} headerRef={headerRef} />
                )}
                <LibraryContainer>
                    <AlbumArtistDetailHeader
                        albumsQuery={albumsQuery}
                        ref={headerRef as React.Ref<HTMLDivElement>}
                    />
                    <AlbumArtistDetailContent albumsQuery={albumsQuery} detailQuery={detailQuery} />
                </LibraryContainer>
            </NativeScrollArea>
        </AnimatedPage>
    );
};

/**
 * navi-connect: start lb-bot's discography read for this artist OUTSIDE the
 * Suspense boundary below.
 *
 * Inside it, the read could not begin until both Navidrome queries had answered
 * — the album list is `limit: -1`, so for a large artist that is the slow one —
 * because a component that suspends never commits, and react-query starts a
 * plain query's fetch on commit. For an artist in the local index mirror none
 * of this matters (the read is synchronous and never touches the network); this
 * is the fallback, for an artist the mirror does not hold.
 *
 * It waits for the artist's MBID before asking, because lb-bot looks an artist
 * up by MBID first and the query key does not carry it: a read without it can
 * answer `{indexed: false}` for an artist indexed under its MBID alone, and the
 * page would then serve that answer from the cache. The artist detail it reads
 * the MBID from is the same query the page suspends on, so it costs no request.
 * Renders nothing.
 */
const LbBotDiscographyPrefetch = ({ routeId }: { routeId: string }) => {
    const server = useCurrentServer();
    const mbid = useQuery({
        ...artistsQueries.albumArtistDetail({ query: { id: routeId }, serverId: server?.id }),
        select: (detail) => detail?.mbz ?? null,
        // The page's own boundary reports a failure; this is only a trigger.
        throwOnError: false,
    }).data;
    useLbBotDiscography(mbid === undefined ? '' : routeId, mbid);
    return null;
};

const AlbumArtistDetailRoute = () => {
    const { albumArtistId, artistId } = useParams() as {
        albumArtistId?: string;
        artistId?: string;
    };
    const routeId = (artistId || albumArtistId) as string;

    return (
        <>
            <LbBotDiscographyPrefetch routeId={routeId} />
            <Suspense
                fallback={<Spinner container />}
                key={`album-artist-detail-suspense-${routeId}`}
            >
                <AlbumArtistDetailRouteContent />
            </Suspense>
        </>
    );
};

const AlbumArtistDetailRouteWithBoundary = () => {
    return (
        <PageErrorBoundary>
            <AlbumArtistDetailRoute />
        </PageErrorBoundary>
    );
};

export default AlbumArtistDetailRouteWithBoundary;
