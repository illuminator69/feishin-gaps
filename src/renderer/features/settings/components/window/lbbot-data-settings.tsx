import isElectron from 'is-electron';
import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { generatePath, Link } from 'react-router';

import { openMbidMatchModal } from '/@/renderer/features/lbbot/components/mbid-match-modal';
import {
    requestListeningSync,
    useArtistOverrideActions,
    useIndexArtist,
    useLbBotAvailable,
    useLbBotOverrideList,
    useListeningStatus,
    useListeningSupported,
    useOverridesSupported,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    getIndexMirrorSnapshot,
    getMirrorSyncState,
    onLbBotAvailable,
    subscribeIndexMirror,
    subscribeMirrorSyncState,
    useMirrorShown,
} from '/@/renderer/features/lbbot/index-mirror/index-mirror';
import {
    describeListeningStatus,
    describeToCheck,
    listeningSyncFailure,
    sortOverrides,
    syncReport,
    SyncSnapshot,
} from '/@/renderer/features/lbbot/utils/lbbot-data';
import { SettingsSection } from '/@/renderer/features/settings/components/settings-section';
import { AppRoute } from '/@/renderer/router/routes';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { TextTitle } from '/@/shared/components/text-title/text-title';
import { Text } from '/@/shared/components/text/text';
import { LbBotListeningStatus, LbBotOverride, LbBotToCheck } from '/@/shared/types/lbbot-types';

/**
 * Settings panel "lb-bot data" (I-020, with I-021's list): what lb-bot holds on
 * this app's behalf, and the two ways to correct it.
 *
 * Sections show only what this hub and lb-bot can serve: no override surface on a
 * hub that does not advertise it, no "Matches to check" on an lb-bot that sends no
 * `toCheck` (older — absent is not the same as empty), no listening line without
 * the listening routes. The index-mirror line is local data and always shows once
 * a hub is configured. With lb-bot unreachable the saved lists still render and
 * every action that needs it is disabled.
 */

const artistPage = (ndArtistId: string) =>
    generatePath(AppRoute.LIBRARY_ALBUM_ARTISTS_DETAIL, { albumArtistId: ndArtistId });

const OverrideRow = ({ available, row }: { available: boolean; row: LbBotOverride }) => {
    const { indexArtist } = useIndexArtist(row.ndArtistId);
    const { failure, pending, remove } = useArtistOverrideActions(row.ndArtistId, indexArtist);
    return (
        <Stack gap={2}>
            <Group justify="space-between" wrap="nowrap">
                <Stack gap={0}>
                    <Text size="sm">{row.name || 'Artist no longer in your library'}</Text>
                    <Text isMuted size="xs">
                        <a
                            href={`https://musicbrainz.org/artist/${row.mbid}`}
                            rel="noreferrer"
                            target="_blank"
                        >
                            {row.mbid}
                        </a>
                        {` · Navidrome said: ${row.tagMbid || 'none'}`}
                    </Text>
                </Stack>
                <Button
                    disabled={!available || pending}
                    loading={pending}
                    // The tag (if any) is what the artist falls back to, so it is
                    // what gets re-scanned.
                    onClick={() => void remove(row.tagMbid, row.name)}
                    size="compact-sm"
                    variant="default"
                >
                    Remove
                </Button>
            </Group>
            {failure && (
                <Text c="red" size="xs">
                    {failure.message}
                </Text>
            )}
        </Stack>
    );
};

const ToCheckRow = ({ available, row }: { available: boolean; row: LbBotToCheck }) => {
    const { indexArtist } = useIndexArtist(row.ndArtistId);
    const { failure, pending, set } = useArtistOverrideActions(row.ndArtistId, indexArtist);
    return (
        <Stack gap={2}>
            <Group justify="space-between" wrap="nowrap">
                <Stack gap={0}>
                    <Text component={Link} isLink size="sm" to={artistPage(row.ndArtistId)}>
                        {row.name || 'Unnamed artist'}
                    </Text>
                    <Text isMuted size="xs">
                        {row.kind === 'unmatched'
                            ? describeToCheck(row)
                            : `${describeToCheck(row)} · ${row.albums} ${row.albums === 1 ? 'album' : 'albums'}`}
                    </Text>
                </Stack>
                <Group gap="xs" wrap="nowrap">
                    <Button
                        disabled={!available || pending}
                        onClick={() =>
                            openMbidMatchModal({
                                currentMbid: row.mbid || undefined,
                                indexArtist,
                                name: row.name,
                                ndId: row.ndArtistId,
                                tagMbid: undefined,
                            })
                        }
                        size="compact-sm"
                        variant="default"
                    >
                        Choose…
                    </Button>
                    {row.kind === 'unmatched' && row.mbid && (
                        <Button
                            disabled={!available || pending}
                            loading={pending}
                            // An ordinary override set to lb-bot's own guess: it becomes
                            // "set by you", and the row leaves the list.
                            onClick={() => void set(row.mbid, row.name)}
                            size="compact-sm"
                            variant="default"
                        >
                            Keep this match
                        </Button>
                    )}
                </Group>
            </Group>
            {failure && (
                <Text c="red" size="xs">
                    {failure.message}
                </Text>
            )}
        </Stack>
    );
};

const when = (epochSeconds: null | number): string =>
    epochSeconds ? new Date(epochSeconds * 1000).toLocaleString() : 'never';

const SYNC_WATCH_MS = 30_000;

export const LbBotDataSettings = memo(() => {
    const shown = useMirrorShown();
    const available = useLbBotAvailable();
    const overridesSupported = useOverridesSupported();
    const listeningSupported = useListeningSupported();
    const list = useLbBotOverrideList();
    const listening = useListeningStatus();
    const mirror = useSyncExternalStore(subscribeIndexMirror, getIndexMirrorSnapshot);
    const mirrorSync = useSyncExternalStore(subscribeMirrorSyncState, getMirrorSyncState);

    // "Sync now" is judged by what changes, not by the click: the snapshot taken
    // when it was pressed is compared with the mirror's cursor and the listening
    // status as they are now.
    const [sync, setSync] = useState<null | {
        before: SyncSnapshot;
        listeningRequested: boolean;
        startedAt: number;
    }>(null);
    const [now, setNow] = useState(() => Date.now());
    const [syncError, setSyncError] = useState<null | { message: string; older: boolean }>(null);
    const statusRef = useRef(listening);
    statusRef.current = listening;
    // A tap is in flight from the baseline read until the watch ends.
    const [starting, setStarting] = useState(false);
    // The status as it is now. A failed re-read leaves react-query's last data in
    // place, which would read as a current answer, so an errored read is no status.
    const listeningNow = listening.isError ? null : (listening.data ?? null);
    const report = sync
        ? syncReport(
              sync.before,
              {
                  cursor: mirror.meta.cursor,
                  epoch: mirror.meta.epoch,
                  listening: listeningNow,
                  sync: mirrorSync,
              },
              sync.listeningRequested,
              now - sync.startedAt,
          )
        : null;
    // Watching lasts until both halves have an answer or the window runs out. Time
    // is judged from `now`, which only the interval below advances, so `done` has
    // to end it too — otherwise a finished watch would hold the button disabled.
    const watching =
        sync !== null && report !== null && !report.done && now - sync.startedAt < SYNC_WATCH_MS;
    const settled = !watching;

    useEffect(() => {
        if (!sync || settled) return;
        const timer = window.setInterval(() => {
            setNow(Date.now());
            if (listeningSupported) void statusRef.current.refetch();
        }, 1500);
        return () => window.clearInterval(timer);
    }, [listeningSupported, settled, sync]);

    if (!isElectron() || !shown) return null;

    const handleSync = async () => {
        // The button is disabled while `starting` or `watching`, so a tap is never
        // ignored while it looks enabled.
        setStarting(true);
        setSyncError(null);
        setSync(null);
        // A fresh status read right before the POST is the baseline. A cached read
        // could already include a sync that finished earlier and be mistaken for
        // this tap's result; a failed read is no baseline at all (null).
        let baseline: LbBotListeningStatus | null = null;
        if (listeningSupported) {
            const fresh = await statusRef.current.refetch();
            baseline = fresh.isError ? null : (fresh.data ?? null);
        }
        const startedAt = Date.now();
        setSync({
            before: {
                cursor: mirror.meta.cursor,
                epoch: mirror.meta.epoch,
                listening: baseline,
                sync: getMirrorSyncState(),
            },
            listeningRequested: listeningSupported,
            startedAt,
        });
        setNow(startedAt);
        setStarting(false);
        // Ends the mirror's back-off and pulls now (a plain trigger is dropped
        // while a retry is pending, which would make this button do nothing).
        onLbBotAvailable();
        if (listeningSupported) {
            const result = await requestListeningSync();
            if (!result.ok) {
                setSyncError(listeningSyncFailure(result));
                setSync((current) =>
                    current ? { ...current, listeningRequested: false } : current,
                );
            }
        }
    };

    const data = list.data;
    const overrides = data ? sortOverrides(data.byNdId) : [];
    const toCheck = data?.toCheck ?? null;

    return (
        <SettingsSection
            extra={
                <Stack gap="lg">
                    {!available && (
                        <Text isMuted size="sm">
                            lb-bot is not reachable. What is listed below was saved by this app;
                            changes need lb-bot.
                        </Text>
                    )}

                    {overridesSupported && (
                        <Stack gap="xs">
                            <TextTitle fw={600} order={5}>
                                {`MusicBrainz overrides${data ? ` (${overrides.length})` : ''}`}
                            </TextTitle>
                            {!data && (
                                <Text isMuted size="sm">
                                    {!available
                                        ? 'lb-bot is needed for this and is not reachable.'
                                        : list.isError
                                          ? 'Could not load overrides.'
                                          : 'Loading…'}
                                </Text>
                            )}
                            {data && overrides.length === 0 && (
                                <Text isMuted size="sm">
                                    None set. Choose a MusicBrainz artist from an artist page when
                                    the tag is missing or wrong.
                                </Text>
                            )}
                            {overrides.map((row) => (
                                <OverrideRow available={available} key={row.ndArtistId} row={row} />
                            ))}
                        </Stack>
                    )}

                    {overridesSupported && toCheck !== null && (
                        <Stack gap="xs">
                            <TextTitle fw={600} order={5}>
                                {`Matches to check (${toCheck.length})`}
                            </TextTitle>
                            <Text isMuted size="xs">
                                Artists with no MusicBrainz tag in Navidrome where lb-bot either
                                guessed an artist that matches none of your albums, or found none.
                                Worth a look, not necessarily wrong.
                            </Text>
                            {toCheck.length === 0 && (
                                <Text isMuted size="sm">
                                    Nothing to check.
                                </Text>
                            )}
                            {toCheck.map((row) => (
                                <ToCheckRow available={available} key={row.ndArtistId} row={row} />
                            ))}
                        </Stack>
                    )}

                    <Stack gap="xs">
                        <TextTitle fw={600} order={5}>
                            Index mirror
                        </TextTitle>
                        <Text isMuted size="sm">
                            {mirror.loaded
                                ? `${mirror.artistCount} artists · cursor ${mirror.meta.cursor} · epoch ${mirror.meta.epoch || 'none yet'}`
                                : 'Reading the saved mirror…'}
                        </Text>
                    </Stack>

                    {listeningSupported && (
                        <Stack gap="xs">
                            <TextTitle fw={600} order={5}>
                                Listening history
                            </TextTitle>
                            {listening.data ? (
                                <>
                                    <Text isMuted size="sm">
                                        {describeListeningStatus(listening.data)}
                                    </Text>
                                    <Text isMuted size="xs">
                                        {`Range ${when(listening.data.oldest)} to ${when(listening.data.newest)} · last sync ${when(listening.data.lastSyncAt)}`}
                                    </Text>
                                </>
                            ) : (
                                <Text isMuted size="sm">
                                    {!available
                                        ? 'lb-bot is needed for this and is not reachable.'
                                        : listening.isError
                                          ? 'Could not read the listening status.'
                                          : 'Loading…'}
                                </Text>
                            )}
                        </Stack>
                    )}

                    <Stack gap="xs">
                        <Group gap="sm">
                            <Button
                                disabled={!available || watching || starting}
                                loading={watching || starting}
                                onClick={() => void handleSync()}
                                size="compact-md"
                                variant="default"
                            >
                                Sync now
                            </Button>
                            <Text isMuted size="xs">
                                Pulls the index mirror and asks lb-bot to pull your listens.
                            </Text>
                        </Group>
                        {report && (
                            <Stack gap={2}>
                                <Text size="sm">{report.mirror}</Text>
                                {report.listening && <Text size="sm">{report.listening}</Text>}
                            </Stack>
                        )}
                        {syncError && (
                            <Text
                                c={syncError.older ? undefined : 'red'}
                                isMuted={syncError.older}
                                size="sm"
                            >
                                {`Listening: ${syncError.message}`}
                            </Text>
                        )}
                    </Stack>
                </Stack>
            }
            options={[]}
            title="lb-bot data"
        />
    );
});
