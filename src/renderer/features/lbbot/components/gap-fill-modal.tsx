import clsx from 'clsx';
import { useCallback, useEffect, useState } from 'react';

import styles from './gap-fill-modal.module.css';

import { SourceList } from '/@/renderer/features/lbbot/components/source-list';
import {
    allowMp3ForAlbum,
    autoFillGap,
    cancelGapFill,
    fetchGapSource,
    gapIsBusy,
    gapProgress,
    rescanGapAlbum,
    searchGapSources,
    useGapSourceFiles,
    useLbBotGap,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { useActiveFillsActions } from '/@/renderer/features/lbbot/stores/active-fills.store';
import { Badge } from '/@/shared/components/badge/badge';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { openModal } from '/@/shared/components/modal/modal';
import { Progress } from '/@/shared/components/progress/progress';
import { Skeleton } from '/@/shared/components/skeleton/skeleton';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { LbBotGapSource, LbBotGapTrackState } from '/@/shared/types/lbbot-types';

/**
 * Filling the gaps in an album the library holds part of.
 *
 * Same two-step shape as the missing-album modal, deliberately — these tracks
 * land *inside* a record the user already owns, so a folder from a different
 * pressing contaminates rather than merely disappoints, and the review step
 * matters more here than it does for a whole album.
 *
 * It needs no new plumbing upstream: lb-bot's discography scan doesn't merely
 * label a release `incomplete`, it builds this review group while classifying
 * it, so the `group_id` on the row is already a live handle.
 */

interface GapFillModalProps {
    albumName: string;
    groupId: string;
}

const TRACK_LABEL: Partial<Record<LbBotGapTrackState, string>> = {
    done: 'Added',
    downloaded: 'Downloaded',
    downloading: 'Downloading',
    failed: 'Failed',
    missing: 'Missing',
    picked: 'Picked',
    queued: 'Queued',
    skipped: 'Skipped',
};

const GapFillModal = ({ albumName, groupId }: GapFillModalProps) => {
    const { error, gap, isLoading, refetch } = useLbBotGap(groupId, true);
    const [chosen, setChosen] = useState<LbBotGapSource | null>(null);
    const [pickedManually, setPickedManually] = useState(false);
    const [pending, setPending] = useState('');
    // A fetch has been committed but lb-bot doesn't say so yet. It enqueues on
    // its own thread, so for a tick or two the tracks still read `picked` and
    // the group still reads idle — the same "looks idle before it is busy"
    // window the page-side watch has a grace period for. Without this the user
    // can fire a second fetch into the gap between the POST and the first
    // `queued`.
    const [committed, setCommitted] = useState(false);
    const sourceFiles = useGapSourceFiles(groupId);
    const { startGap } = useActiveFillsActions();

    const busy = gapIsBusy(gap);
    const settling = committed && !busy;
    const searching = gap?.sourceTask?.status === 'queued' || gap?.sourceTask?.status === 'running';
    const sources = gap?.sources ?? [];
    const progress = gapProgress(gap);

    // Rank 1 pre-selected, an explicit pick always winning.
    const selected =
        pickedManually && chosen
            ? chosen
            : (sources.find((source) => source.recommended) ?? sources[0] ?? null);

    // Released as soon as lb-bot admits to being busy, and on a timer if it
    // never does — a fetch that quietly didn't take must give the button back
    // rather than leave it dead, which is the failure this whole modal keeps
    // running into from the other direction.
    useEffect(() => {
        if (!committed) return undefined;
        if (busy) {
            setCommitted(false);
            return undefined;
        }
        const timer = window.setTimeout(() => setCommitted(false), 30_000);
        return () => window.clearTimeout(timer);
    }, [committed, busy]);

    const filesFor = useCallback(
        (source: LbBotGapSource) => {
            if (!sourceFiles.expanded[source.id]) return null;
            const result = sourceFiles.files[source.id];
            return {
                error: result && !result.ok ? result.error : '',
                loading: !!sourceFiles.loading[source.id],
                value: result?.ok ? result.data : null,
            };
        },
        [sourceFiles],
    );

    /** Every write goes through here so a refusal is always shown, never swallowed. */
    const run = async (key: string, action: () => Promise<{ error: string; ok: boolean }>) => {
        setPending(key);
        try {
            const result = await action();
            if (!result.ok) toast.error({ message: result.error || 'lb-bot refused the request' });
            else void refetch();
            return result.ok;
        } finally {
            setPending('');
        }
    };

    const handleSearch = () =>
        run('search', () => searchGapSources(groupId, gap ? gap.sources.length > 0 : false));

    const handleFetch = async () => {
        if (!selected) return;
        const ok = await run('fetch', () => fetchGapSource(groupId, selected.id));
        // Registered on the store, not on this component: the fill takes minutes
        // and the artist page behind the modal is what has to keep watching it.
        if (ok) {
            startGap(groupId);
            setCommitted(true);
        }
    };

    const handleAuto = async () => {
        const ok = await run('auto', () => autoFillGap(groupId));
        if (ok) {
            startGap(groupId);
            setCommitted(true);
        }
    };

    const handleAllowMp3 = async () => {
        const ok = await allowMp3ForAlbum(groupId);
        toast.show({
            message: ok
                ? 'MP3 allowed for this album — search again'
                : 'Could not set the MP3 option',
        });
        if (ok) void refetch();
    };

    if (isLoading && !gap) {
        return (
            <Stack gap="sm">
                <Skeleton height={20} />
                <Skeleton height={120} />
            </Stack>
        );
    }

    if (!gap) {
        return (
            <Text isMuted size="sm">
                {error || 'lb-bot has no gap record for this album.'}
            </Text>
        );
    }

    return (
        <div className={styles.root}>
            <Stack className={styles.body} gap="md">
                <Stack gap="xs">
                    <Group gap="sm">
                        <Text fw={600}>{gap.album || albumName}</Text>
                        <Badge variant="default">
                            {gap.present}/{gap.total}
                        </Badge>
                        {gap.extra > 0 && <Badge variant="outline">{gap.extra} extra files</Badge>}
                    </Group>
                    {/* Naming the edition is not decoration. The gap is measured
                    against your own album's MusicBrainz tag, so a library tagged
                    as a 17-track deluxe reports 17 slots even when every pressing
                    on offer has 12 — which reads as a miscount, and makes the
                    short download read as a bug, unless this is said out loud.
                    A real edition picker isn't possible: lb-bot overwrites
                    canonical_mbid from the Navidrome tag on every refresh. */}
                    <Text isMuted size="xs">
                        Counted against the release your library is tagged as ({gap.total} tracks).
                        If that tag is a deluxe edition, a standard pressing will fill fewer slots
                        than the count suggests.
                    </Text>
                    {error && (
                        <Text isMuted size="xs">
                            {error}
                        </Text>
                    )}
                </Stack>

                <Stack gap="xs">
                    {gap.tracks.map((track) => (
                        <div
                            className={clsx(styles.track, {
                                [styles.present]: track.state === 'present',
                            })}
                            key={`${track.position}-${track.title}`}
                        >
                            <Text isMuted size="sm">
                                {track.position}
                            </Text>
                            <Text className={styles.title} size="sm">
                                {track.title}
                            </Text>
                            <Text isMuted size="xs">
                                {track.state === 'present'
                                    ? ''
                                    : (TRACK_LABEL[track.state] ?? track.state)}
                            </Text>
                        </div>
                    ))}
                </Stack>

                {/* Counted off the tracks, not off a task: a gap fill is per-track
                and there is no single transfer to report. Measured against the
                tracks being filled rather than the album's length — progress
                against 17 when only 12 were queued stalls at 12/17 and reads as
                a hang.
                Shown from the moment anything is in flight, not only once
                `status` says `downloading` or a track has landed: lb-bot flips
                the group's own status well after the first track is queued, and
                the minutes in between were a fill running with nothing on screen
                to say so. */}
                {(busy || committed || progress.done > 0) && progress.wanted > 0 && (
                    <Stack gap="xs">
                        <Group gap="sm">
                            <Text isMuted size="sm">
                                {progress.done}/{progress.wanted} tracks
                            </Text>
                            {progress.failed > 0 && (
                                <Badge variant="filled">{progress.failed} failed</Badge>
                            )}
                        </Group>
                        <Progress value={progress.percent} />
                    </Stack>
                )}

                {searching && (
                    <Text isMuted size="sm">
                        {gap.sourceTask?.current || 'Asking slskd which peers have these tracks…'}
                    </Text>
                )}

                {/* `picking` means two different things and the difference is the
                whole point of having a picker: with sources it is "your move";
                with none it is the real hand-off to lb-bot's own workspace. */}
                {!searching && gap.status === 'picking' && sources.length === 0 && (
                    <Text isMuted size="sm">
                        lb-bot needs a decision in its own match workspace for this album.
                    </Text>
                )}

                {!searching && sources.length === 0 && gap.noSourceReason && (
                    <Text isMuted size="sm">
                        {gap.noSourceReason}
                    </Text>
                )}

                {gap.failReason && (
                    <Text isMuted size="sm">
                        {[gap.failReason, gap.failDetail].filter(Boolean).join(' — ')}
                    </Text>
                )}

                {sources.length > 0 && (
                    <SourceList
                        filesFor={filesFor}
                        onSelect={(source) => {
                            setChosen(source);
                            setPickedManually(true);
                        }}
                        onToggleFiles={(source) => void sourceFiles.toggle(source.id)}
                        selectedId={selected?.id ?? null}
                        sources={sources}
                    />
                )}
            </Stack>

            <Stack className={styles.footer} gap="sm">
                <Group gap="sm">
                    {gap.mp3WouldHelp && !gap.allowMp3 && (
                        <Button onClick={handleAllowMp3} size="compact-sm" variant="default">
                            Allow MP3 for this album
                        </Button>
                    )}
                    <Button
                        disabled={busy || !!pending}
                        loading={pending === 'rescan'}
                        onClick={() => void run('rescan', () => rescanGapAlbum(groupId))}
                        size="compact-sm"
                        variant="subtle"
                    >
                        Re-check album
                    </Button>
                    {sources.length > 0 && (
                        <Button
                            disabled={busy || settling || !!pending}
                            loading={pending === 'auto'}
                            onClick={handleAuto}
                            size="compact-sm"
                            variant="subtle"
                        >
                            Pick the best source for me
                        </Button>
                    )}
                    {gap.status === 'downloading' && (
                        <Button
                            disabled={!!pending}
                            loading={pending === 'cancel'}
                            onClick={() => void run('cancel', () => cancelGapFill(groupId))}
                            size="compact-sm"
                            variant="subtle"
                        >
                            Cancel
                        </Button>
                    )}
                </Group>

                <Group gap="sm" justify="end">
                    {/* Disabled while the search runs, and that is load-bearing: the
                    POST flips the group to `picking` before it has found
                    anything, so a second press reads as "nothing happened" and
                    starts another search that blocks on lb-bot's process-wide
                    lock. Press once and leave it. */}
                    <Button
                        disabled={searching || !!pending}
                        loading={pending === 'search' || searching}
                        onClick={handleSearch}
                        variant={sources.length > 0 ? 'default' : 'filled'}
                    >
                        {sources.length > 0 ? 'Search again' : 'Find sources'}
                    </Button>
                    {sources.length > 0 && (
                        <Button
                            disabled={!selected || busy || settling || !!pending}
                            loading={pending === 'fetch' || settling}
                            onClick={handleFetch}
                            variant="filled"
                        >
                            Fill {progress.wanted || gap.missingCount} tracks from this source
                        </Button>
                    )}
                </Group>
            </Stack>
        </div>
    );
};

export const openGapFillModal = (albumName: string, groupId: string, missingCount: number) => {
    openModal({
        children: <GapFillModal albumName={albumName} groupId={groupId} />,
        size: 'lg',
        title: missingCount ? `Find ${missingCount} missing tracks` : 'Fill missing tracks',
    });
};
