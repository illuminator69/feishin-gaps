import { Fragment, Suspense, useEffect, useMemo } from 'react';
import { generatePath, Link, Navigate, useParams, useSearchParams } from 'react-router';

import { MetaAbout } from '/@/renderer/features/lbbot/components/meta-about';
import { MissingAlbumPanel } from '/@/renderer/features/lbbot/components/missing-album-modal';
import {
    caaCoverUrl,
    useArtistTarget,
    useIndexRelease,
    useLbBotAlbumMeta,
    useLbBotAlbumReleases,
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
import { LbBotRelease } from '/@/shared/types/lbbot-types';

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

    const artist = search.get('artist') ?? '';
    const artistMbid = search.get('artistMbid') ?? '';

    // Editions of this release-group. Read here as well as inside the panel —
    // react-query dedupes on the key, so this costs no extra round trip — because
    // it is the one place this page can learn its artist's MBID when it was
    // opened from a Deezer row, which carries none.
    const releases = useLbBotAlbumReleases(rgid).data;

    // Where the artist credit goes. `artistId` is present when the row we came
    // from knew the library has them; otherwise the hook checks the library by
    // name and falls back to an MBID — the page's own, else the lead credit
    // `/lb/album/releases` answers. Without that last fallback a page reached
    // from a Deezer tile rendered the artist as dead text and there was no route
    // to their page or to the discography scan behind it.
    const artistTo = useArtistTarget({
        artistId: search.get('artistId') ?? '',
        artistMbid: artistMbid || releases?.artistMbid || '',
        name: artist || releases?.artist || '',
    });

    // Purely to answer "does the library already have this?" — from the local
    // index mirror when lb-bot has indexed the artist, which makes the redirect
    // to an owned album happen on the first render instead of after a round
    // trip; otherwise an instant SQLite read on lb-bot's side. Skipped entirely
    // without an artist MBID.
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
    // Only while lb-bot is up. The discography can come from the local mirror
    // with lb-bot down, and `useIndexRelease` fires once per rgid, failures
    // included — so a call made then was never made again on this page. Gated,
    // it waits, and runs when lb-bot comes back.
    const available = useLbBotAvailable();
    useEffect(() => {
        if (!available || !discography.data?.indexed || indexedRow) return;
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
    }, [available, discography.data, indexedRow, indexRelease, rgid, artist, search]);

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

    // `release_mbid` is not sent: it is optional on the route (it only saves
    // lb-bot resolving the canonical release itself), and an lb-bot index row
    // is a release-GROUP and carries no release mbid to send.
    const meta = useLbBotAlbumMeta(rgid).data;

    if (ownedAlbumId) {
        return (
            <Navigate
                replace
                to={generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: ownedAlbumId })}
            />
        );
    }

    const credit = [
        artist ? (
            artistTo ? (
                <Text component={Link} isLink key="artist" to={artistTo}>
                    {artist}
                </Text>
            ) : (
                <Text key="artist">{artist}</Text>
            )
        ) : null,
        release.year ? <Text key="year">{release.year}</Text> : null,
        release.effectiveType ? <Text key="type">{release.effectiveType}</Text> : null,
    ].filter(Boolean);

    return (
        <ForkDetailPage
            headerChildren={
                <Stack gap="sm">
                    <Group gap="xs">
                        {credit.map((part, index) => (
                            <Fragment key={index}>
                                {index > 0 && <Text isMuted>•</Text>}
                                {part}
                            </Fragment>
                        ))}
                    </Group>
                    <Group>
                        <Badge>Not in your library</Badge>
                    </Group>
                </Stack>
            }
            imageUrl={rgid ? caaCoverUrl(rgid) : null}
            itemType={LibraryItem.ALBUM}
            route={AppRoute.LIBRARY_ALBUMS}
            title={release.title || 'Album'}
        >
            {/* lb-bot is the only source that can describe a record nobody owns —
                there is no Navidrome album for an agent to answer about. Nothing
                competes for the slot, so nothing can flash. */}
            {meta && <MetaAbout maxHeight={120} meta={meta} />}
            {rgid ? (
                <MissingAlbumPanel
                    artistName={artist}
                    artistTo={artistTo}
                    inPage
                    release={release}
                />
            ) : (
                <Text isMuted>This link has no release-group id.</Text>
            )}
        </ForkDetailPage>
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
