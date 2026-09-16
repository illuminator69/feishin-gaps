import { Suspense, useEffect, useMemo } from 'react';
import { generatePath, Navigate, useParams, useSearchParams } from 'react-router';

import { NativeScrollArea } from '/@/renderer/components/native-scroll-area/native-scroll-area';
import { MissingAlbumPanel } from '/@/renderer/features/lbbot/components/missing-album-modal';
import { useIndexRelease, useLbBotDiscography } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { artistLinkPath } from '/@/renderer/features/lbbot/utils/external-paths';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { LibraryContainer } from '/@/renderer/features/shared/components/library-container';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { AppRoute } from '/@/renderer/router/routes';
import { useWindowSettings } from '/@/renderer/store';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { LbBotRelease } from '/@/shared/types/lbbot-types';
import { Platform } from '/@/shared/types/types';

/**
 * navi-connect: an album page for a release the library does not have.
 *
 * Keyed on the MusicBrainz release-group id, because that is the only handle a
 * release nobody owns has. The body is the *same* two-step component the artist
 * page's modal mounts — editions, canonical tracklist, ranked sources, download —
 * rather than a second picker with its own set of the traps that one already pays
 * for.
 *
 * `album/tracklist` answers `presenceKnown: false` with no Navidrome album ids,
 * which is the normal case here. Every track is missing; the panel renders the
 * tracklist plainly and deliberately does not draw a "0/12".
 *
 * When the library turns out to hold the release-group after all, this redirects
 * to the real album page. Only lb-bot's index knows which Navidrome album that is
 * — the fresh feed's `releaseOwned` is a boolean and carries no id — so the
 * redirect needs the artist's discography, and is simply skipped without one.
 */
const LbBotExternalAlbumRoute = () => {
    const { rgid } = useParams() as { rgid: string };
    const [search] = useSearchParams();
    const { windowBarStyle } = useWindowSettings();

    const artist = search.get('artist') ?? '';
    const artistMbid = search.get('artistMbid') ?? '';
    // Present when the row we came from knew the artist is in the library. The
    // artist name was bare text here while being a link on the tile that opened
    // this page; `artistLinkPath` is the one rule both now use.
    const artistTo = artistLinkPath(search.get('artistId') ?? '', artistMbid);

    // Purely to answer "does the library already have this?" — an instant SQLite
    // read on lb-bot's side, and skipped entirely without an artist MBID.
    const discography = useLbBotDiscography(artistMbid ? `mb:${artistMbid}` : '', artistMbid);
    const indexedRow = useMemo(
        () => (discography.data?.releases ?? []).find((row) => row.rgid === rgid),
        [discography.data, rgid],
    );
    const ownedAlbumId = indexedRow?.navidromeAlbumIds[0];

    // The index has never heard of this release-group — the normal case for
    // anything reached from Fresh, since a stored discography is served even when
    // stale. Add the single row rather than offering a rescan of the whole
    // artist, which is a MusicBrainz request per second per release-group.
    //
    // Without it the redirect above can never fire either: only lb-bot's index
    // knows which Navidrome album a release-group resolves to, so an album the
    // library actually holds keeps rendering as a download until the next scan.
    const indexRelease = useIndexRelease(artistMbid ? `mb:${artistMbid}` : '', artistMbid);
    useEffect(() => {
        if (!discography.data?.indexed || indexedRow) return;
        // The link that got here carries the release's own metadata, which is
        // lb-bot's escape hatch when MusicBrainz is inside its five-minute
        // failure cooldown for this release-group.
        void indexRelease(rgid, {
            artist,
            external: true,
            name: artist,
            title: search.get('title') ?? '',
            type: search.get('type') ?? '',
            year: search.get('year') ?? '',
        });
    }, [discography.data, indexedRow, indexRelease, rgid, artist, search]);

    // A synthetic index row: the panel reads only these four fields off it, and
    // everything real about the release comes from lb-bot inside the panel.
    const release: LbBotRelease = useMemo(
        () => ({
            effectiveType: search.get('type') ?? '',
            navidromeAlbumIds: [],
            primaryType: (search.get('type') ?? '').toLowerCase(),
            rgid,
            secondaryTypes: [],
            status: 'missing',
            title: search.get('title') ?? '',
            year: search.get('year') ?? '',
        }),
        [rgid, search],
    );

    if (ownedAlbumId) {
        return (
            <Navigate
                replace
                to={generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: ownedAlbumId })}
            />
        );
    }

    return (
        <AnimatedPage>
            <NativeScrollArea
                pageHeaderProps={{
                    backgroundColor: 'var(--theme-colors-background)',
                    children: (
                        <LibraryHeaderBar>
                            <LibraryHeaderBar.Title>
                                {release.title || 'Album'}
                            </LibraryHeaderBar.Title>
                        </LibraryHeaderBar>
                    ),
                    offset: 200,
                }}
            >
                <LibraryContainer>
                    <Stack
                        gap="md"
                        mb="5rem"
                        pt={windowBarStyle === Platform.WEB ? '5rem' : '3rem'}
                        px="2rem"
                    >
                        <Text isMuted size="sm">
                            Not in your library
                        </Text>
                        {rgid ? (
                            <MissingAlbumPanel
                                artistName={artist}
                                artistTo={artistTo}
                                release={release}
                            />
                        ) : (
                            <Text isMuted>This link has no release-group id.</Text>
                        )}
                    </Stack>
                </LibraryContainer>
            </NativeScrollArea>
        </AnimatedPage>
    );
};

const LbBotExternalAlbumRouteWithBoundary = () => (
    <PageErrorBoundary>
        <Suspense fallback={<Spinner container />}>
            <LbBotExternalAlbumRoute />
        </Suspense>
    </PageErrorBoundary>
);

export default LbBotExternalAlbumRouteWithBoundary;
