import { Suspense, useMemo } from 'react';
import { generatePath, Link, useNavigate } from 'react-router';

import styles from './lbbot-fresh-route.module.css';

import {
    useLbBotAvailable,
    useLbBotFreshReleases,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    FreshScope,
    FreshSort,
    FreshType,
    useFreshDays,
    useFreshFiltersActions,
    useFreshScope,
    useFreshSort,
    useFreshType,
} from '/@/renderer/features/lbbot/stores/fresh-filters.store';
import { artistLinkPath, externalAlbumPath } from '/@/renderer/features/lbbot/utils/external-paths';
import {
    applyFreshScope,
    hasArtistPlays,
    scopeInEffect,
} from '/@/renderer/features/lbbot/utils/fresh-scope';
import { ForkListPage } from '/@/renderer/features/shared/components/fork-list-page';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { AppRoute } from '/@/renderer/router/routes';
import { Badge } from '/@/shared/components/badge/badge';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Select } from '/@/shared/components/select/select';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';
import { LbBotFreshRelease } from '/@/shared/types/lbbot-types';

/**
 * navi-connect: new and upcoming releases, site-wide.
 *
 * Nothing to do with the home page's carousels, which query the user's own library
 * — this is ListenBrainz's fresh-releases feed, which is mostly music the library
 * does *not* have. That is the point: it is the front door to lb-bot's acquisition
 * side, and every artist and album on it is explorable whether or not the library
 * owns them.
 *
 * Shaped like lb-bot's own Fresh panel so the two read alike.
 */

const SCOPE_DATA: { label: string; value: FreshScope }[] = [
    { label: 'Your artists', value: 'mine' },
    { label: 'All', value: 'all' },
];

const DAYS_DATA = [
    { label: '7 days', value: '7' },
    { label: '30 days', value: '30' },
    { label: '90 days', value: '90' },
];

const TYPE_DATA: { label: string; value: FreshType }[] = [
    { label: 'All', value: 'all' },
    { label: 'Albums', value: 'album' },
    { label: 'EPs', value: 'ep' },
    { label: 'Singles', value: 'single' },
    { label: 'Other', value: 'other' },
];

const SORT_DATA: { label: string; value: FreshSort }[] = [
    { label: 'Newest', value: 'newest' },
    { label: 'Artist A–Z', value: 'artist' },
];

/**
 * Which type bucket a row belongs in.
 *
 * **Everything unrecognised — including the very common empty `type` — lands in
 * `other`.** MusicBrainz leaves the primary type blank often enough that a
 * bucket-per-known-type rule would drop those rows out of every filter at once,
 * which reads as the feed being empty rather than as a filter doing its job.
 */
const typeBucket = (release: LbBotFreshRelease): FreshType => {
    const type = (release.type || '').toLowerCase();
    if (type === 'album') return 'album';
    if (type === 'ep') return 'ep';
    if (type === 'single') return 'single';
    return 'other';
};

const DAY_MS = 86_400_000;

/** Week buckets, newest first. An undated row sinks to `Earlier` rather than
 *  claiming a week it has no evidence for. */
const WEEK_BUCKETS = [
    'Upcoming',
    'This week',
    'Last week',
    '2 weeks ago',
    '3 weeks ago',
    'Earlier',
] as const;

const weekBucketFor = (releaseDate: string, now: number): string => {
    const parsed = releaseDate ? Date.parse(releaseDate) : NaN;
    if (!Number.isFinite(parsed)) return 'Earlier';
    if (parsed > now) return 'Upcoming';
    const weeks = Math.floor((now - parsed) / (7 * DAY_MS));
    if (weeks <= 0) return 'This week';
    if (weeks === 1) return 'Last week';
    if (weeks === 2) return '2 weeks ago';
    if (weeks === 3) return '3 weeks ago';
    return 'Earlier';
};

const FreshTile = ({ release }: { release: LbBotFreshRelease }) => {
    const navigate = useNavigate();

    // Owned artist → the real artist page. Unowned but MusicBrainz-identified →
    // the virtual one, which renders their discography from lb-bot. Neither →
    // plain text, never a link to nowhere.
    const artistTo = artistLinkPath(
        release.artistOwned ? release.artistId : '',
        release.artistMbids[0] ?? '',
        release.artist,
    );

    // An album the library holds opens the library album, full stop. This used
    // to send *every* row to the virtual page and rely on its redirect — which
    // needs a Navidrome album id from lb-bot's index, and an album lb-bot filled
    // itself has none (placement cannot write them). So a tile badged "In
    // library" opened a download page. The virtual page stays the fallback it
    // was designed to be.
    const albumTo = release.releaseAlbumId
        ? generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: release.releaseAlbumId })
        : release.releaseGroupMbid
          ? externalAlbumPath(release)
          : undefined;

    return (
        <div className={styles.tile}>
            <div
                className={release.releaseOwned ? styles.frame : `${styles.frame} ${styles.absent}`}
                onClick={() => albumTo && navigate(albumTo)}
                role={albumTo ? 'button' : undefined}
            >
                {release.coverUrl && (
                    <img
                        alt=""
                        className={styles.cover}
                        // Straight from the Cover Art Archive, never through anything
                        // that would attach this user's Navidrome or reverse-proxy
                        // headers to a third-party request.
                        loading="lazy"
                        onError={(e) => {
                            // Plenty of release-groups have no front cover; an empty
                            // slot beats a broken-image icon.
                            e.currentTarget.style.visibility = 'hidden';
                        }}
                        src={release.coverUrl}
                    />
                )}
                {release.releaseOwned && (
                    <Badge className={styles.badge} size="xs">
                        In library
                    </Badge>
                )}
            </div>
            <Text className={styles.name} size="sm" title={release.releaseName}>
                {release.releaseName}
            </Text>
            <Text
                className={styles.name}
                component={artistTo ? Link : undefined}
                isLink={Boolean(artistTo)}
                isMuted
                size="xs"
                to={artistTo}
            >
                {release.artist}
            </Text>
            <Text isMuted size="xs">
                {[release.releaseDate, release.secondaryType || release.type]
                    .filter(Boolean)
                    .join(' · ')}
            </Text>
        </div>
    );
};

const LbBotFreshRoute = () => {
    const days = useFreshDays();
    const storedScope = useFreshScope();
    const sort = useFreshSort();
    const type = useFreshType();
    const { set } = useFreshFiltersActions();

    const available = useLbBotAvailable();
    const query = useLbBotFreshReleases(days);
    // `keepPreviousData` holds the previous window's answer while the new one
    // loads. It is not this window's answer, so nothing below may describe it as
    // one (an empty window, a truncation count) — and with lb-bot unavailable the
    // new window will never load, so it is dropped rather than dimmed forever.
    const switching = query.isPlaceholderData;
    const data = switching && !available ? undefined : query.data;
    // A disabled react-query is `pending` forever, so `isLoading` alone would spin
    // indefinitely on a page reached by URL with lb-bot switched off. Placeholder
    // data leaves `isLoading` false, which is why switching counts separately.
    const loading = available && (query.isLoading || switching);

    // I-006: "Artists you play" exists only while some row carries `artistPlays`
    // (an older lb-bot sends none); a stored `plays` then reads as `mine`.
    const playsAvailable = hasArtistPlays(data?.releases);
    const scope = scopeInEffect(storedScope, playsAvailable);
    const scopeData = playsAvailable
        ? [...SCOPE_DATA, { label: 'Artists you play', value: 'plays' as FreshScope }]
        : SCOPE_DATA;

    const buckets = useMemo(() => {
        const rows = applyFreshScope(data?.releases ?? [], scope).filter(
            (release) => type === 'all' || typeBucket(release) === type,
        );
        if (scope === 'plays') {
            // Most played first, newest breaking ties — already ordered by the scope.
            return [{ label: '', releases: rows }];
        }
        if (sort === 'artist') {
            const sorted = [...rows].sort(
                (a, b) =>
                    a.artist.localeCompare(b.artist) || a.releaseName.localeCompare(b.releaseName),
            );
            // One unlabelled bucket: an A–Z list divided by week would be two
            // orderings fighting each other.
            return [{ label: '', releases: sorted }];
        }
        // "This week" is relative to the wall clock and to nothing else. The memo
        // re-runs only when the rows or the filters change, so this reads the clock
        // about as often as the page changes — and a bucket boundary crossed while
        // the page sits open is worth exactly nothing to re-render for.
        // eslint-disable-next-line react-hooks/purity
        const now = Date.now();
        const byBucket = new Map<string, LbBotFreshRelease[]>();
        for (const release of rows) {
            const key = weekBucketFor(release.releaseDate, now);
            const list = byBucket.get(key);
            if (list) list.push(release);
            else byBucket.set(key, [release]);
        }
        for (const list of byBucket.values()) {
            list.sort(
                (a, b) =>
                    (b.releaseDate || '').localeCompare(a.releaseDate || '') ||
                    a.artist.localeCompare(b.artist),
            );
        }
        return WEEK_BUCKETS.flatMap((label) => {
            const releases = byBucket.get(label);
            return releases?.length ? [{ label, releases }] : [];
        });
    }, [data, scope, sort, type]);

    const total = buckets.reduce((sum, bucket) => sum + bucket.releases.length, 0);

    // Scope and type are which releases: chips, as on the app's other pages. The window is a
    // period: the segmented control. The order is a sort: a Select on the right.
    const filters = (
        <Group justify="space-between">
            <Group gap="lg">
                <Group gap="xs">
                    {scopeData.map((item) => (
                        <Button
                            key={item.value}
                            onClick={() => set({ scope: item.value })}
                            variant={scope === item.value ? 'filled' : 'subtle'}
                        >
                            {item.label}
                        </Button>
                    ))}
                </Group>
                <Group gap="xs">
                    {TYPE_DATA.map((item) => (
                        <Button
                            key={item.value}
                            onClick={() => set({ type: item.value })}
                            variant={type === item.value ? 'filled' : 'subtle'}
                        >
                            {item.label}
                        </Button>
                    ))}
                </Group>
            </Group>
            <Group gap="sm">
                <SegmentedControl
                    data={DAYS_DATA}
                    onChange={(value) => set({ days: Number(value) })}
                    value={String(days)}
                />
                {/* "Artists you play" orders the rows itself (most played
                    first); a sort control there would do nothing. */}
                {scope !== 'plays' && (
                    <Select
                        aria-label="Sort"
                        data={SORT_DATA}
                        onChange={(value) => value && set({ sort: value as FreshSort })}
                        value={sort}
                        width={150}
                    />
                )}
            </Group>
        </Group>
    );

    return (
        <ForkListPage
            count={loading && total === 0 ? null : total}
            countLoading={loading && total === 0}
            filters={filters}
            title="Fresh releases"
        >
            {/* The previous window's rows, dimmed, already say "loading"
                — unless there are none. */}
            {loading && total === 0 && <Spinner container />}

            {/* Fail-soft, like every other lb-bot read: an absent lb-bot and
                an unhappy ListenBrainz are both a sentence, not an error
                page — and they are different sentences. */}
            {/* Not over a feed on screen: a persisted or cached answer is
                shown while lb-bot is unreachable, and this sentence is the
                one thing it would contradict. */}
            {!available && !data && (
                <Text isMuted>
                    lb-bot is not configured on your hub, so there is no fresh-releases feed to
                    read.
                </Text>
            )}

            {available && !loading && !data && (
                <Text isMuted>
                    lb-bot could not reach the fresh-releases feed. It caches the feed for an hour,
                    so try again shortly.
                </Text>
            )}

            {!loading && data && total === 0 && (
                <Text isMuted>
                    {scope === 'mine'
                        ? 'Nothing new from artists in your library in this window. Try All, or a longer window.'
                        : scope === 'plays'
                          ? 'No release in this window matches that type from artists you play.'
                          : 'Nothing in this window.'}
                </Text>
            )}

            {/* The feed is capped before it crosses the hub, which
                cannot carry the whole site-wide window. Every artist
                in your library survives that cut whatever its size,
                so this only ever means "there are more releases by
                artists you don't have". */}
            {!loading && data?.truncated && total > 0 && (
                <Text isMuted size="sm">
                    {`Showing the ${data.releases.length} most-listened of ${data.total} releases, plus everything by artists in your library.`}
                </Text>
            )}

            {buckets.map((bucket) => (
                <Stack
                    gap="md"
                    key={bucket.label || 'all'}
                    // The previous window's rows, held on screen by
                    // `keepPreviousData` while the new window loads:
                    // dimmed, so they do not read as its answer.
                    style={switching ? { opacity: 0.5 } : undefined}
                >
                    {bucket.label && (
                        // The artist page's section heading: a title, its count, a rule.
                        <div className={styles.bucket}>
                            <Group>
                                <TextTitle fw={700} order={3}>
                                    {bucket.label}
                                </TextTitle>
                                <Badge>{bucket.releases.length}</Badge>
                            </Group>
                            <div className={styles.bucketRule} />
                        </div>
                    )}
                    <div className={styles.grid}>
                        {bucket.releases.map((release) => (
                            <FreshTile
                                key={`${release.releaseMbid || release.releaseGroupMbid}-${release.artist}`}
                                release={release}
                            />
                        ))}
                    </div>
                </Stack>
            ))}
        </ForkListPage>
    );
};

const LbBotFreshRouteWithBoundary = () => (
    <PageErrorBoundary>
        <Suspense fallback={<Spinner container />}>
            <LbBotFreshRoute />
        </Suspense>
    </PageErrorBoundary>
);

export default LbBotFreshRouteWithBoundary;
