import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { generatePath, useLocation, useNavigate } from 'react-router';

import styles from './album-match-modal.module.css';

import {
    applyAlbumOverride,
    removeAlbumOverride,
    setAlbumCover,
    useAlbumCovers,
    useAlbumJobPoll,
    useAlbumOverrideControls,
    useAlbumOverrideState,
    useAlbumPreview,
    useAlbumRgidLookup,
    useLbBotAlbumReleases,
    useLbBotAvailable,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    AlbumFailure,
    APPLY_SPEC,
    commitSentence,
    describeAlbumFailure,
    editionRows,
    extractReleaseMbid,
    nextAfterOverride,
    outcomeSentence,
    PollPhase,
    PollSpec,
    REMOVE_SPEC,
    STILL_WORKING,
    summarizePreview,
} from '/@/renderer/features/lbbot/utils/album-override';
import { AppRoute } from '/@/renderer/router/routes';
import { Badge } from '/@/shared/components/badge/badge';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { closeModal, openModal } from '/@/shared/components/modal/modal';
import { Progress } from '/@/shared/components/progress/progress';
import { Skeleton } from '/@/shared/components/skeleton/skeleton';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { LbBotAlbumOverrideRow, LbBotPreview, LbBotPreviewSlot } from '/@/shared/types/lbbot-types';

/**
 * "Fix album match" (I-022): tell lb-bot which MusicBrainz release an owned album
 * is, see how it would renumber and retitle the files, optionally pick a cover,
 * apply, and undo. The album counterpart of the artist "Fix MusicBrainz match".
 *
 * Every sentence states only what lb-bot answered. In particular nothing here says
 * whether a favourite, rating or play count survives - that is not measured. The
 * one fixed sentence before apply is {@link commitSentence}. Navic mirrors the
 * steps and states by hand (`.superpowers/sdd/album-override-2026-10-09/contract.md`).
 */

interface AlbumMatchModalProps {
    albumId: string;
    /** The artist page to land on when the album's new id is not known yet. */
    artistId?: string;
}

const slotText = (slot: LbBotPreviewSlot): string =>
    `${slot.disc > 0 ? `${slot.disc}-` : ''}${String(slot.track).padStart(2, '0')}  ${slot.title}`;

const releaseLine = (release: LbBotPreview['release']): string =>
    [
        release.title,
        release.disambiguation ? `(${release.disambiguation})` : '',
        [
            release.year,
            release.country,
            release.format,
            release.trackCount > 0 ? `${release.trackCount} tracks` : '',
            release.discCount > 1 ? `${release.discCount} discs` : '',
        ]
            .filter(Boolean)
            .join(' · '),
    ]
        .filter(Boolean)
        .join(' — ');

const Failure = ({
    failure,
    onRetry,
}: {
    failure: AlbumFailure | { message: string };
    onRetry?: () => void;
}) => (
    <Group gap="sm">
        <Text c="red" size="sm">
            {failure.message}
        </Text>
        {onRetry && (
            <Button onClick={onRetry} size="compact-sm" variant="default">
                Try again
            </Button>
        )}
    </Group>
);

const PreviewTable = ({ preview }: { preview: LbBotPreview }) => {
    const [showAll, setShowAll] = useState(false);
    const summary = summarizePreview(preview);
    const rows = showAll
        ? preview.files
        : preview.files.filter((file) => file.to === null || file.changed);
    return (
        <Stack gap="xs">
            <Text size="sm">{releaseLine(preview.release)}</Text>
            <Text isMuted size="sm">
                {summary.changing} files change · {summary.noSlot} files have no place on this
                release · {summary.missing} tracks of the release have no file
            </Text>
            {summary.noSlot > 0 && (
                <Text isMuted size="xs">
                    Files with no place on this release are left untouched. Navidrome will then list
                    them as an album of their own.
                </Text>
            )}
            <div className={styles.table}>
                {rows.map((file, index) => {
                    // A file that is already right is dimmed; a change or a file with
                    // no place stays at full strength.
                    const dim = file.to !== null && !file.changed ? styles.dim : undefined;
                    return (
                        <div
                            key={`${file.from.disc}-${file.from.track}-${file.from.title}-${index}`}
                            style={{ display: 'contents' }}
                        >
                            <span className={dim}>{slotText(file.from)}</span>
                            <span className={dim}>→</span>
                            <span className={dim}>
                                {file.to
                                    ? slotText(file.to)
                                    : 'no place on this release — left as is'}
                            </span>
                            <span className={styles.dim}>{file.basis}</span>
                        </div>
                    );
                })}
            </div>
            {summary.unchanged > 0 && (
                <Group gap="xs">
                    <Text isMuted size="xs">
                        {showAll
                            ? `Showing all ${summary.total} files.`
                            : `${summary.unchanged} files already match and are not shown.`}
                    </Text>
                    <Button
                        onClick={() => setShowAll((value) => !value)}
                        size="compact-xs"
                        variant="subtle"
                    >
                        {showAll ? 'Hide unchanged' : 'Show all'}
                    </Button>
                </Group>
            )}
            {preview.missing.length > 0 && (
                <Text isMuted size="xs">
                    No file for: {preview.missing.map((slot) => slotText(slot).trim()).join('; ')}
                </Text>
            )}
        </Stack>
    );
};

const AlbumMatchModal = ({
    albumId,
    artistId,
    modalId,
}: AlbumMatchModalProps & { modalId: string }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const available = useLbBotAvailable();
    const controls = useAlbumOverrideControls();
    const poll = useAlbumJobPoll();

    const [job, setJob] = useState<null | { kind: 'apply' | 'remove'; spec: PollSpec }>(null);
    const stateQuery = useAlbumOverrideState(albumId, !job);
    const answer = stateQuery.data;
    const state = answer?.ok ? answer.data : null;
    const stateFailure = answer && !answer.ok ? describeAlbumFailure(answer) : null;

    // The release group: lb-bot's own, else one validated lookup (never the first hit).
    const needsLookup = !!state && !state.rgid;
    const lookup = useAlbumRgidLookup(state?.artist ?? '', state?.album ?? '', needsLookup);
    const rgid = state?.rgid || lookup.data?.rgid || '';
    const lookupDeclined = needsLookup && !lookup.isFetching && lookup.data === null;

    const editions = useLbBotAlbumReleases(rgid || null);
    const rows = useMemo(
        () => editionRows(editions.data?.variants ?? [], state?.releaseMbid ?? ''),
        [editions.data, state?.releaseMbid],
    );

    const [picked, setPicked] = useState<null | string>(null);
    const [pasted, setPasted] = useState('');
    const [coverUrl, setCoverUrl] = useState('');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<AlbumFailure | null>(null);
    const [confirm, setConfirm] = useState<null | { matched: number; total: number }>(null);

    const parsed = extractReleaseMbid(pasted);
    const preview = useAlbumPreview(albumId, job ? null : picked);
    const previewData = preview.data?.ok ? preview.data.data : null;
    const previewFailure =
        preview.data && !preview.data.ok ? describeAlbumFailure(preview.data) : null;
    const summary = previewData ? summarizePreview(previewData) : null;

    const coverRelease = picked ?? state?.releaseMbid ?? '';
    const covers = useAlbumCovers(rgid, coverRelease, !!state && !job && (!!picked || !!rgid));
    const coverList = covers.data?.ok ? (covers.data.data ?? []) : null;
    const coverFailure = covers.data && !covers.data.ok ? describeAlbumFailure(covers.data) : null;
    // Changing the release invalidates a cover chosen for the previous one.
    useEffect(() => setCoverUrl(''), [picked]);

    // An override that is still being worked on when the dialog opens is followed,
    // not offered a second apply.
    const resumed = useRef(false);
    useEffect(() => {
        const row = state?.override;
        if (!row || resumed.current || job) return;
        const spec = REMOVE_SPEC.active.includes(row.state)
            ? REMOVE_SPEC
            : APPLY_SPEC.active.includes(row.state)
              ? APPLY_SPEC
              : null;
        if (!spec) return;
        resumed.current = true;
        setJob({ kind: spec === REMOVE_SPEC ? 'remove' : 'apply', spec });
        poll.start(row.id, spec);
    }, [job, poll, state?.override]);

    const row: LbBotAlbumOverrideRow | null = poll.state?.row ?? state?.override ?? null;
    const phase: null | PollPhase = poll.state?.phase ?? null;

    // The album the user was on is dead after a retag: follow it to its new id, or
    // to the artist, but only when that page is the one they are looking at.
    const where = nextAfterOverride(
        job?.kind === 'remove' ? '' : (poll.state?.row?.albumId ?? ''),
        artistId ?? '',
    );
    const open = () => {
        closeModal(modalId);
        if (where.kind === 'album')
            navigate(generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: where.id }));
        if (where.kind === 'artist') {
            navigate(
                generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, { albumArtistId: where.id }),
            );
        }
    };
    const whereId = where.kind === 'none' ? '' : where.id;
    const navigated = useRef(false);
    useEffect(() => {
        if (phase !== 'settled' || navigated.current) return;
        navigated.current = true;
        if (!location.pathname.includes(albumId)) return;
        if (where.kind === 'album') {
            navigate(generatePath(AppRoute.LIBRARY_ALBUMS_DETAIL, { albumId: whereId }), {
                replace: true,
            });
        } else if (where.kind === 'artist') {
            navigate(
                generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, { albumArtistId: whereId }),
                {
                    replace: true,
                },
            );
        }
    }, [albumId, location.pathname, navigate, phase, where.kind, whereId]);

    const begin = (kind: 'apply' | 'remove', id: string) => {
        const spec = kind === 'apply' ? APPLY_SPEC : REMOVE_SPEC;
        setJob({ kind, spec });
        poll.start(id, spec);
    };

    const apply = async (force: boolean) => {
        if (!picked) return;
        setBusy(true);
        setFailure(null);
        const result = await applyAlbumOverride({
            albumId,
            coverUrl: coverUrl || undefined,
            force,
            releaseMbid: picked,
        });
        setBusy(false);
        if (!result.ok || !result.data) {
            const found = describeAlbumFailure(result);
            if (
                found.kind === 'poor_match' &&
                found.matched !== undefined &&
                found.total !== undefined
            ) {
                setConfirm({ matched: found.matched, total: found.total });
            } else {
                setConfirm(null);
                setFailure(found);
            }
            return;
        }
        setConfirm(null);
        begin('apply', result.data.id);
    };

    // The cover alone: the release stays, lb-bot creates or updates the override row.
    const saveCoverOnly = async () => {
        if (!coverUrl) return;
        setBusy(true);
        setFailure(null);
        const result = await setAlbumCover(albumId, coverUrl);
        setBusy(false);
        if (!result.ok || !result.data) {
            setFailure(describeAlbumFailure(result));
            return;
        }
        // Synchronous on lb-bot's side: follow the row it made to see the final state.
        setJob({ kind: 'apply', spec: APPLY_SPEC });
        poll.start(result.data.id, APPLY_SPEC);
    };

    const undo = async (id: string) => {
        setBusy(true);
        setFailure(null);
        const result = await removeAlbumOverride(id);
        setBusy(false);
        if (!result.ok || !result.data) {
            setFailure(describeAlbumFailure(result));
            return;
        }
        begin('remove', result.data.id);
    };

    const when = (epochSeconds: number): string =>
        epochSeconds > 0 ? new Date(epochSeconds * 1000).toLocaleString() : '';

    // ---- rendering --------------------------------------------------------
    if (!controls) {
        return (
            <Text isMuted size="sm">
                {available
                    ? 'This lb-bot is older and cannot fix album matches yet.'
                    : 'lb-bot is not reachable, so nothing can be changed right now.'}
            </Text>
        );
    }

    const inFlight = job && phase === 'polling';
    const showPicker = !job && !!state;
    const currentRow = rows.find((edition) => edition.current);

    return (
        <div className={styles.root}>
            <div className={styles.body}>
                {!state && !stateFailure && (
                    <Stack gap="xs" py="sm">
                        <Skeleton height={16} width="60%" />
                        <Skeleton height={16} width="40%" />
                    </Stack>
                )}
                {stateFailure && stateFailure.kind !== 'older' && (
                    <Failure
                        failure={stateFailure}
                        onRetry={
                            stateFailure.kind === 'retry'
                                ? () => void stateQuery.refetch()
                                : undefined
                        }
                    />
                )}
                {stateFailure?.kind === 'older' && (
                    <Text isMuted size="sm">
                        {stateFailure.message}
                    </Text>
                )}

                {state && (
                    <div className={styles.section}>
                        <Stack gap={2}>
                            <Text fw={600} size="sm">
                                {state.artist} — {state.album}
                            </Text>
                            <Text isMuted size="sm">
                                {state.releaseMbid
                                    ? currentRow
                                        ? `Tagged as ${[
                                              currentRow.title,
                                              currentRow.year,
                                              currentRow.country,
                                              currentRow.format,
                                              currentRow.trackCount > 0
                                                  ? `${currentRow.trackCount} tracks`
                                                  : '',
                                          ]
                                              .filter(Boolean)
                                              .join(' · ')}.`
                                        : 'Tagged with a MusicBrainz release id.'
                                    : 'Not tagged with a MusicBrainz release.'}{' '}
                                {state.tracks.length > 0 ? `${state.tracks.length} files.` : ''}
                            </Text>
                            {state.override && !job && (
                                <Group gap="sm">
                                    <Text isMuted size="sm">
                                        {state.override.state === 'failed'
                                            ? `A change lb-bot made on ${when(state.override.setAt)} did not finish (${state.override.done} of ${state.override.total} files written).`
                                            : `Changed by lb-bot on ${when(state.override.setAt)}.`}
                                    </Text>
                                    <Button
                                        disabled={busy}
                                        onClick={() => void undo(state.override!.id)}
                                        size="compact-sm"
                                        variant="default"
                                    >
                                        Undo
                                    </Button>
                                </Group>
                            )}
                        </Stack>
                    </div>
                )}

                {job && (
                    <div className={styles.section}>
                        <Stack gap="xs">
                            {inFlight && (
                                <>
                                    <Text size="sm">
                                        {job.kind === 'remove'
                                            ? 'lb-bot is putting the previous tags back…'
                                            : 'lb-bot is writing the tags…'}
                                    </Text>
                                    {row && row.total > 0 && (
                                        <>
                                            <Text isMuted size="sm">
                                                {row.done}/{row.total} files
                                            </Text>
                                            <Progress value={(row.done / row.total) * 100} />
                                        </>
                                    )}
                                </>
                            )}
                            {phase === 'settled' && (
                                <Text size="sm">{outcomeSentence(job.kind, row)}</Text>
                            )}
                            {phase === 'failed' && (
                                <Text c="red" size="sm">
                                    {outcomeSentence(job.kind, row)}
                                </Text>
                            )}
                            {phase === 'gone' && (
                                <Text c="red" size="sm">
                                    lb-bot no longer has this change.
                                </Text>
                            )}
                            {phase === 'timeout' && <Text size="sm">{STILL_WORKING}</Text>}
                            {row && row.failures.length > 0 && job.kind === 'apply' && (
                                <Stack gap={2}>
                                    <Text size="sm">
                                        {row.failures.length} files could not be written:
                                    </Text>
                                    {row.failures.slice(0, 10).map((item) => (
                                        <Text isMuted key={item.title} size="xs">
                                            {item.title}
                                            {item.reason ? ` — ${item.reason}` : ''}
                                        </Text>
                                    ))}
                                    {row.failures.length > 10 && (
                                        <Text isMuted size="xs">
                                            and {row.failures.length - 10} more
                                        </Text>
                                    )}
                                </Stack>
                            )}
                            {phase === 'failed' && job.kind === 'apply' && (
                                <Text isMuted size="xs">
                                    Undo restores the tags that were written.
                                </Text>
                            )}
                            {phase !== null && phase !== 'polling' && (
                                <Group gap="sm">
                                    {where.kind !== 'none' && phase === 'settled' && (
                                        <Button onClick={open} size="compact-sm" variant="filled">
                                            {where.kind === 'album'
                                                ? 'Open the album'
                                                : 'Open the artist'}
                                        </Button>
                                    )}
                                    {job.kind === 'apply' &&
                                        row &&
                                        phase !== 'gone' &&
                                        phase !== 'timeout' && (
                                            <Button
                                                disabled={busy}
                                                onClick={() => {
                                                    void undo(row.id);
                                                }}
                                                size="compact-sm"
                                                variant="default"
                                            >
                                                Undo
                                            </Button>
                                        )}
                                    <Button
                                        onClick={() => closeModal(modalId)}
                                        size="compact-sm"
                                        variant="subtle"
                                    >
                                        Close
                                    </Button>
                                </Group>
                            )}
                            {failure && <Failure failure={failure} />}
                        </Stack>
                    </div>
                )}

                {showPicker && (
                    <div className={styles.section}>
                        <Stack gap="xs">
                            <Text fw={600} size="sm">
                                Which release is this album?
                            </Text>
                            {needsLookup && lookup.isFetching && (
                                <Text isMuted size="sm">
                                    Looking up this album on MusicBrainz…
                                </Text>
                            )}
                            {lookupDeclined && (
                                <Text isMuted size="sm">
                                    lb-bot does not know this album’s release group, so it cannot
                                    list its editions. Paste a MusicBrainz release id or a
                                    musicbrainz.org/release/… address below instead.
                                </Text>
                            )}
                            {rgid && editions.isFetching && !editions.data && (
                                <Text isMuted size="sm">
                                    Reading editions from MusicBrainz…
                                </Text>
                            )}
                            {rgid && !editions.isFetching && editions.data === null && (
                                <Failure
                                    failure={{
                                        message:
                                            'lb-bot could not read this album’s editions from MusicBrainz.',
                                    }}
                                    onRetry={() => void editions.refetch()}
                                />
                            )}
                            {rgid && editions.data && rows.length === 0 && (
                                <Text isMuted size="sm">
                                    MusicBrainz lists no editions for this album.
                                </Text>
                            )}
                            {rows.map((edition) => (
                                <div
                                    className={clsx(styles.edition, {
                                        [styles.selected]: picked === edition.releaseMbid,
                                    })}
                                    key={edition.releaseMbid}
                                >
                                    <Stack gap={0}>
                                        <Group gap="xs" wrap="nowrap">
                                            <Text className={styles.name} fw={600} size="sm">
                                                {edition.title}
                                                {edition.disambiguation
                                                    ? ` (${edition.disambiguation})`
                                                    : ''}
                                            </Text>
                                            {edition.current && (
                                                <Badge size="xs" variant="filled">
                                                    Tagged now
                                                </Badge>
                                            )}
                                        </Group>
                                        <Text isMuted size="xs">
                                            {[
                                                edition.label,
                                                edition.year,
                                                edition.country,
                                                edition.format,
                                                edition.trackCount > 0
                                                    ? `${edition.trackCount} tracks`
                                                    : '',
                                            ]
                                                .filter(Boolean)
                                                .join(' · ') || 'No further detail'}
                                        </Text>
                                    </Stack>
                                    <Button
                                        disabled={busy}
                                        onClick={() => setPicked(edition.releaseMbid)}
                                        size="compact-sm"
                                        variant={
                                            picked === edition.releaseMbid ? 'filled' : 'default'
                                        }
                                    >
                                        {picked === edition.releaseMbid ? 'Chosen' : 'Preview'}
                                    </Button>
                                </div>
                            ))}
                            <Group align="flex-end" gap="xs" wrap="nowrap">
                                <TextInput
                                    error={
                                        pasted.trim() && !parsed
                                            ? 'Not a MusicBrainz release id or address'
                                            : null
                                    }
                                    label="Or paste a release MBID or musicbrainz.org/release/… address"
                                    onChange={(event) => setPasted(event.currentTarget.value)}
                                    style={{ flex: 1 }}
                                    value={pasted}
                                />
                                <Button
                                    disabled={busy || !parsed}
                                    onClick={() => parsed && setPicked(parsed)}
                                    variant="default"
                                >
                                    Preview this id
                                </Button>
                            </Group>
                        </Stack>
                    </div>
                )}

                {showPicker && picked && (
                    <div className={styles.section}>
                        {preview.isFetching && (
                            <Text isMuted size="sm">
                                Comparing the files with this release…
                            </Text>
                        )}
                        {!preview.isFetching &&
                            previewFailure &&
                            previewFailure.kind !== 'older' && (
                                <Failure
                                    failure={previewFailure}
                                    onRetry={
                                        previewFailure.kind === 'retry'
                                            ? () => void preview.refetch()
                                            : undefined
                                    }
                                />
                            )}
                        {!preview.isFetching && previewData && (
                            <PreviewTable preview={previewData} />
                        )}
                    </div>
                )}

                {showPicker && (picked ? !!previewData : !!rgid) && (
                    <div className={styles.section}>
                        <Stack gap="xs">
                            <Text fw={600} size="sm">
                                Cover
                            </Text>
                            {covers.isFetching && !covers.data && (
                                <Text isMuted size="sm">
                                    Looking for covers on the Cover Art Archive…
                                </Text>
                            )}
                            {coverFailure && (
                                <Failure
                                    failure={coverFailure}
                                    onRetry={
                                        coverFailure.kind === 'retry'
                                            ? () => void covers.refetch()
                                            : undefined
                                    }
                                />
                            )}
                            {coverList && coverList.length === 0 && (
                                <Text isMuted size="sm">
                                    The Cover Art Archive has no covers for this release. The
                                    current cover stays.
                                </Text>
                            )}
                            {coverList && coverList.length > 0 && (
                                <div className={styles.covers}>
                                    <button
                                        aria-pressed={coverUrl === ''}
                                        className={clsx(styles.cover, styles.keep, {
                                            [styles.chosen]: coverUrl === '',
                                        })}
                                        onClick={() => setCoverUrl('')}
                                        type="button"
                                    >
                                        Keep the current cover
                                    </button>
                                    {coverList.map((cover) => (
                                        <button
                                            aria-pressed={coverUrl === cover.full}
                                            className={clsx(styles.cover, {
                                                [styles.chosen]: coverUrl === cover.full,
                                            })}
                                            key={cover.full}
                                            onClick={() => setCoverUrl(cover.full)}
                                            type="button"
                                        >
                                            <img alt="" loading="lazy" src={cover.thumb} />
                                            {cover.source === 'release'
                                                ? 'This release'
                                                : 'Release group'}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </Stack>
                    </div>
                )}
            </div>

            {showPicker && (
                <Stack className={styles.footer} gap="xs">
                    {summary && picked && !confirm && summary.changing > 0 && (
                        <Text size="sm">{commitSentence(summary.changing)}</Text>
                    )}
                    {summary && picked && summary.changing === 0 && (
                        <Text isMuted size="sm">
                            No file would change.
                        </Text>
                    )}
                    {confirm && (
                        <Text size="sm">
                            Only {confirm.matched} of the {confirm.total} files have a place on this
                            release. Apply anyway?
                        </Text>
                    )}
                    {failure && (
                        <Failure
                            failure={failure}
                            onRetry={
                                failure.kind === 'retry' ? () => void apply(!!confirm) : undefined
                            }
                        />
                    )}
                    <Group gap="sm" justify="end">
                        {picked && confirm && (
                            <Button
                                disabled={busy}
                                loading={busy}
                                onClick={() => void apply(true)}
                                variant="filled"
                            >
                                Apply anyway
                            </Button>
                        )}
                        {picked && !confirm && (
                            <Button
                                disabled={busy || !summary || summary.changing === 0}
                                loading={busy}
                                onClick={() => void apply(false)}
                                variant="filled"
                            >
                                Apply
                            </Button>
                        )}
                        {!picked && coverUrl && (
                            <Button
                                disabled={busy}
                                loading={busy}
                                onClick={() => void saveCoverOnly()}
                                variant="filled"
                            >
                                Save this cover
                            </Button>
                        )}
                        <Button onClick={() => closeModal(modalId)} variant="subtle">
                            Close
                        </Button>
                    </Group>
                </Stack>
            )}
        </div>
    );
};

export const openAlbumMatchModal = (props: AlbumMatchModalProps & { title?: string }) => {
    const modalId = `album-match-${props.albumId}`;
    openModal({
        children: (
            <AlbumMatchModal albumId={props.albumId} artistId={props.artistId} modalId={modalId} />
        ),
        modalId,
        size: 'lg',
        title: props.title ? `Fix album match — ${props.title}` : 'Fix album match',
    });
};
