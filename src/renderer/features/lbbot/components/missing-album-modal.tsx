import { useCallback, useMemo, useState } from 'react';

import styles from './missing-album-modal.module.css';

import { SourceList } from '/@/renderer/features/lbbot/components/source-list';
import {
    allowMp3ForAlbum,
    caaCoverUrl,
    startAlbumDownload,
    useLbBotAlbumReleases,
    useLbBotAlbumSources,
    useLbBotFillStatus,
    useLbBotTracklist,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    useActiveFill,
    useActiveFillsActions,
    usePreferredQuality,
} from '/@/renderer/features/lbbot/stores/active-fills.store';
import { Badge } from '/@/shared/components/badge/badge';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { openModal } from '/@/shared/components/modal/modal';
import { Progress } from '/@/shared/components/progress/progress';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Select } from '/@/shared/components/select/select';
import { Skeleton } from '/@/shared/components/skeleton/skeleton';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import {
    LB_BOT_QUALITY_OPTIONS,
    LbBotFillState,
    LbBotGapSource,
    LbBotRelease,
    LbBotResolvedEdition,
} from '/@/shared/types/lbbot-types';

/**
 * Downloading an album the library doesn't have, in two steps.
 *
 * It used to be one: pick an edition and a quality, press, hope. That fetched
 * the wrong record for a self-titled album and the wrong quality for another,
 * with no way to know until afterwards — and `quality` cannot fix the second,
 * because upstream it is a *ranking* preference (0-600 points inside a
 * ~14000-point folder score), not a filter, so a well-matching hi-res folder
 * still wins. Hence: choose, then review what is actually on offer, then commit.
 */

interface MissingAlbumModalProps {
    artistName: string;
    release: LbBotRelease;
}

/** Human wording for each fill state. `unknown` is "nothing has happened yet". */
const STATE_LABEL: Record<LbBotFillState, string> = {
    downloading: 'Downloading',
    failed: 'Failed',
    needs_match: 'Needs review in lb-bot',
    placed: 'Placed — waiting for Navidrome',
    placing: 'Placing into your library',
    queued: 'Queued on Soulseek',
    searching: 'Searching Soulseek',
    unknown: '',
    verified: 'In your library',
};

/** '' is a real choice, not an absent one: it means "whatever lb-bot's global
 *  Source preference says", which is the right default for anyone who has
 *  already tuned that and doesn't want to think about it per album. */
const QUALITY_DATA = [
    { label: "lb-bot's default", value: '' },
    ...LB_BOT_QUALITY_OPTIONS.map((option) => ({ label: option.label, value: option.value })),
];

const IN_FLIGHT: ReadonlySet<LbBotFillState> = new Set<LbBotFillState>([
    'downloading',
    'placing',
    'queued',
    'searching',
]);

const MissingAlbumModal = ({ artistName, release }: MissingAlbumModalProps) => {
    const releasesQuery = useLbBotAlbumReleases(release.rgid);
    const [variantIndex, setVariantIndex] = useState(0);
    const [editionIndex, setEditionIndex] = useState(0);
    const [starting, setStarting] = useState(false);
    // The two-step. `review` is entered by pressing Find sources and is what
    // enables the (slow) source search — never on open.
    const [step, setStep] = useState<'choose' | 'review'>('choose');
    const [chosen, setChosen] = useState<LbBotGapSource | null>(null);
    const [pickedManually, setPickedManually] = useState(false);
    const [openFiles, setOpenFiles] = useState<Record<number, boolean>>({});
    // Set once the download has been fired: what the status poll is keyed on, and
    // what tells us a fill exists at all. Until then there is nothing to watch.
    const [watchedMbid, setWatchedMbid] = useState<null | string>(null);
    // Sticky across albums and across restarts: someone who wants CD-standard
    // rips wants them for the next album too, and re-picking it every time is
    // exactly the friction that made the global-only setting useless.
    const preferredQuality = usePreferredQuality();
    const { setQuality } = useActiveFillsActions();

    const variants = releasesQuery.data?.variants ?? [];
    const variant = variants[variantIndex];
    const editions = variant?.editions ?? [];
    const edition = editions[editionIndex] ?? editions[0];

    // The tracklist belongs to a concrete release, so it follows the edition —
    // a variant's default edition is its digital one, the likeliest to be right.
    const releaseMbid = edition?.releaseMbid || variant?.releaseMbid || null;
    const tracklistQuery = useLbBotTracklist(releaseMbid);
    // A fill outlives this modal, so re-opening it must show the one already
    // running rather than a blank sheet that looks like nothing ever happened.
    // The persisted store is what remembers it.
    const activeFill = useActiveFill(release.rgid);
    const fillMbid = watchedMbid ?? activeFill?.releaseMbid ?? null;
    const status = useLbBotFillStatus(fillMbid, !!fillMbid);

    // What we already know about the chosen pressing, handed to lb-bot so it
    // doesn't re-resolve the release-group. That resolve picks "official,
    // earliest" regardless of what was chosen here, and it answers {} for five
    // minutes after any transient MusicBrainz failure — which is what made
    // "Could not resolve album" stick with nothing the user could do about it.
    const resolvedEdition: LbBotResolvedEdition | undefined = releaseMbid
        ? {
              artist: releasesQuery.data?.artist || artistName,
              releaseMbid,
              title: variant?.title || release.title,
              // The exact edition's tracklist when it has loaded — it is what
              // the source search sizes folders against — else the variant's own
              // count.
              totalTracks: tracklistQuery.data?.tracks.length || variant?.trackCount || 0,
          }
        : undefined;

    const sourcesQuery = useLbBotAlbumSources(release.rgid, step === 'review', resolvedEdition);

    const state = (status.data?.state ?? 'unknown') as LbBotFillState;
    const busy = starting || IN_FLIGHT.has(state);

    // Rank 1 is pre-selected so the confident case stays one extra tap rather
    // than becoming research, but an explicit pick always wins over a re-rank.
    const selected =
        pickedManually && chosen
            ? chosen
            : (sourcesQuery.sources?.find((source) => source.recommended) ??
              sourcesQuery.sources?.[0] ??
              null);

    const coverUrl = useMemo(
        () => edition?.coverUrl || variant?.coverUrl || caaCoverUrl(release.rgid),
        [edition?.coverUrl, variant?.coverUrl, release.rgid],
    );

    // `/lb/album/sources` is not stripped by the hub, so each source's files
    // arrive with the search and expanding a row costs nothing — unlike the gap
    // flow, where the same disclosure needs a second call.
    const filesFor = useCallback(
        (source: LbBotGapSource) =>
            openFiles[source.id]
                ? {
                      error: '',
                      loading: false,
                      value: {
                          coverage: source.coverage,
                          coverageDetail: source.coverageDetail,
                          expanded: true,
                          fileCount: source.fileCount,
                          files: source.files,
                          filesTruncated: source.filesTruncated,
                      },
                  }
                : null,
        [openFiles],
    );

    const handleDownload = async () => {
        if (busy) return;
        setStarting(true);
        try {
            const result = await startAlbumDownload(
                release.rgid,
                preferredQuality,
                selected ? { folder: selected.folder, peer: selected.peer } : undefined,
                resolvedEdition,
            );
            if (!result.ok) {
                // lb-bot writes its errors for humans, so this is its own
                // sentence verbatim. A button that fails silently is the bug
                // this replaced.
                toast.error({ message: result.error || 'lb-bot could not start the download' });
                return;
            }
            // The release lb-bot keyed the fill on. It now honours the edition
            // sent above, so the two normally agree — but its answer is still
            // the authority on what to poll.
            setWatchedMbid(result.releaseMbid || releaseMbid);
            if (result.existing) {
                toast.show({ message: 'Already downloading this album' });
            }
        } finally {
            setStarting(false);
        }
    };

    const handleAllowMp3 = async () => {
        const groupId = status.data?.groupId;
        if (!groupId) return;
        const ok = await allowMp3ForAlbum(groupId);
        toast.show({
            message: ok
                ? 'MP3 allowed for this album — try the download again'
                : 'Could not set the MP3 option',
        });
    };

    return (
        <div className={styles.root}>
            <Stack className={styles.body} gap="md">
                <div className={styles.header}>
                    <img
                        alt=""
                        className={styles.cover}
                        onError={(e) => {
                            // No Cover Art Archive entry is the common case for an
                            // obscure release; an empty slot beats a broken icon.
                            e.currentTarget.style.visibility = 'hidden';
                        }}
                        src={coverUrl}
                    />
                    <Stack gap="xs">
                        <Text fw={600}>{release.title}</Text>
                        <Text isMuted size="sm">
                            {[artistName, release.year, release.effectiveType]
                                .filter(Boolean)
                                .join(' · ')}
                        </Text>
                        {variant?.trackCount ? (
                            <Text isMuted size="sm">
                                {variant.trackCount} tracks
                            </Text>
                        ) : null}
                    </Stack>
                </div>

                {step === 'choose' && (
                    <>
                        {releasesQuery.isLoading && <Skeleton height={32} />}

                        {/* The editions read is fail-soft — it answers null for a
                            hub that isn't there, an lb-bot that is busy and a
                            MusicBrainz that is unhappy alike. Saying so, with a
                            way to retry, beats an empty panel that looks like an
                            album with no editions. The download still works
                            without it; lb-bot resolves the release itself. */}
                        {!releasesQuery.isLoading && !releasesQuery.data && (
                            <Stack gap="xs">
                                <Text size="sm">Could not load this album&apos;s editions.</Text>
                                <Group gap="sm">
                                    <Button
                                        onClick={() => void releasesQuery.refetch()}
                                        size="compact-sm"
                                        variant="default"
                                    >
                                        Try again
                                    </Button>
                                </Group>
                                <Text isMuted size="xs">
                                    Downloading still works — lb-bot picks the release itself.
                                </Text>
                            </Stack>
                        )}

                        {/* Both bars scroll sideways. A release-group with a
                            dozen pressings otherwise rendered a control wider
                            than the modal, with the editions past the edge
                            unreachable — you could see that a Deluxe existed and
                            not select it. */}
                        {variants.length > 1 && (
                            <div className={styles['edition-bar']}>
                                <SegmentedControl
                                    data={variants.map((v, i) => ({
                                        label: [v.title, v.disambiguation]
                                            .filter(Boolean)
                                            .join(' · '),
                                        value: String(i),
                                    }))}
                                    onChange={(value) => {
                                        setVariantIndex(Number(value));
                                        setEditionIndex(0);
                                    }}
                                    value={String(variantIndex)}
                                />
                            </div>
                        )}

                        {editions.length > 1 && (
                            <div className={styles['edition-bar']}>
                                <SegmentedControl
                                    data={editions.map((e, i) => ({
                                        label: e.label,
                                        value: String(i),
                                    }))}
                                    onChange={(value) => setEditionIndex(Number(value))}
                                    value={String(editionIndex)}
                                />
                            </div>
                        )}

                        {tracklistQuery.isLoading ? (
                            <Stack gap="xs">
                                <Skeleton height={16} />
                                <Skeleton height={16} />
                                <Skeleton height={16} />
                            </Stack>
                        ) : (
                            <Stack gap="xs">
                                {(tracklistQuery.data?.tracks ?? []).map((track) => (
                                    <div
                                        className={styles.track}
                                        key={`${track.position}-${track.title}`}
                                    >
                                        <Text isMuted size="sm">
                                            {track.position}
                                        </Text>
                                        <Text size="sm">{track.title}</Text>
                                    </div>
                                ))}
                                {tracklistQuery.data?.tracks.length === 0 && (
                                    <Text isMuted size="sm">
                                        No tracklist available for this release.
                                    </Text>
                                )}
                            </Stack>
                        )}
                    </>
                )}

                {step === 'review' && (
                    <Stack gap="sm">
                        {sourcesQuery.isLoading && (
                            <Stack gap="xs">
                                <Text isMuted size="sm">
                                    Asking slskd which peers have this album. This takes up to a
                                    minute — leave it running.
                                </Text>
                                <Skeleton height={64} />
                                <Skeleton height={64} />
                            </Stack>
                        )}

                        {/* An error here is recoverable and must say so. The
                            search and the download fail independently — lb-bot's
                            resolver, slskd and MusicBrainz are three different
                            things that can be having a bad minute — so a failed
                            source list must not take the download with it. */}
                        {sourcesQuery.error && !sourcesQuery.isLoading && (
                            <Stack gap="xs">
                                <Text size="sm">{sourcesQuery.error}</Text>
                                <Group gap="sm">
                                    <Button
                                        onClick={() => void sourcesQuery.refetch()}
                                        size="compact-sm"
                                        variant="default"
                                    >
                                        Try again
                                    </Button>
                                </Group>
                                <Text isMuted size="xs">
                                    You can still download without reviewing sources — lb-bot picks
                                    its own top-ranked folder.
                                </Text>
                            </Stack>
                        )}

                        {sourcesQuery.sources?.length === 0 && !sourcesQuery.isLoading && (
                            <Text isMuted size="sm">
                                No usable source found on Soulseek for this release.
                            </Text>
                        )}

                        {sourcesQuery.sources && sourcesQuery.sources.length > 0 && (
                            <SourceList
                                filesFor={filesFor}
                                onSelect={(source) => {
                                    setChosen(source);
                                    setPickedManually(true);
                                }}
                                onToggleFiles={(source) =>
                                    setOpenFiles((prev) => ({
                                        ...prev,
                                        [source.id]: !prev[source.id],
                                    }))
                                }
                                selectedId={selected?.id ?? null}
                                sources={sourcesQuery.sources}
                            />
                        )}

                        {/* Say what the pick actually is. lb-bot floats the chosen
                        peer to the front of its own ranked list and keeps the
                        rest as failover, so if that peer has gone by transfer
                        time the best ranked folder wins instead. Implying a
                        certainty we don't have is worse than the sentence. */}
                        {selected && (
                            <Text isMuted size="xs">
                                lb-bot tries this source first and falls back to the others if it
                                stalls or disappears.
                            </Text>
                        )}
                    </Stack>
                )}
            </Stack>

            <Stack className={styles.footer} gap="sm">
                {state !== 'unknown' && (
                    <Stack gap="xs">
                        <Group gap="sm">
                            <Badge variant={state === 'failed' ? 'filled' : 'default'}>
                                {STATE_LABEL[state]}
                            </Badge>
                            {status.data?.total ? (
                                <Text isMuted size="sm">
                                    {status.data.done}/{status.data.total} files
                                </Text>
                            ) : null}
                        </Group>
                        {IN_FLIGHT.has(state) && <Progress value={status.data?.percent ?? 0} />}
                        {/* lb-bot's own sentence, verbatim: "103 peers offered 2,047
                            files, but none in FLAC, OPUS" is the useful answer, and
                            paraphrasing it here would only lose the evidence. */}
                        {status.data?.reason ? (
                            <Text isMuted size="sm">
                                {status.data.reason}
                            </Text>
                        ) : null}
                        {status.data?.mp3WouldHelp && status.data?.groupId ? (
                            <Button onClick={handleAllowMp3} size="compact-sm" variant="default">
                                Allow MP3 for this album
                            </Button>
                        ) : null}
                    </Stack>
                )}

                <Group gap="sm" justify="end">
                    {step === 'review' && (
                        <Button
                            disabled={busy}
                            onClick={() => setStep('choose')}
                            size="compact-sm"
                            variant="subtle"
                        >
                            Back
                        </Button>
                    )}
                    <Select
                        aria-label="Preferred quality"
                        data={QUALITY_DATA}
                        disabled={busy}
                        onChange={(value) => setQuality(value ?? '')}
                        value={preferredQuality}
                        width={220}
                    />
                    {step === 'choose' ? (
                        <Button
                            disabled={!release.rgid}
                            onClick={() => setStep('review')}
                            variant="filled"
                        >
                            Find sources
                        </Button>
                    ) : (
                        <Button
                            disabled={busy || !release.rgid}
                            loading={starting}
                            onClick={handleDownload}
                            variant="filled"
                        >
                            {state === 'verified' ? 'Download again' : 'Download'}
                        </Button>
                    )}
                </Group>
            </Stack>
        </div>
    );
};

export const openMissingAlbumModal = (artistName: string, release: LbBotRelease) => {
    openModal({
        children: <MissingAlbumModal artistName={artistName} release={release} />,
        size: 'lg',
        title: release.title,
    });
};
