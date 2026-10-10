import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
    requestListeningSync,
    useListeningStatus,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    getIndexMirrorSnapshot,
    getMirrorSyncState,
    onLbBotAvailable,
    subscribeIndexMirror,
    subscribeMirrorSyncState,
} from '/@/renderer/features/lbbot/index-mirror/index-mirror';
import {
    listeningReport,
    listeningSyncFailure,
    mirrorReport,
    SyncSnapshot,
} from '/@/renderer/features/lbbot/utils/lbbot-data';
import { LbBotListeningStatus } from '/@/shared/types/lbbot-types';

/**
 * The two buttons that used to be one "Sync now" (P3). Each does its own half and
 * reports only that half, judged by what changes rather than by the click: a
 * baseline is taken when the button is pressed and compared with the source's state
 * as it is now. The report is frozen when the watch ends, so it never re-evaluates
 * against later pulls that have nothing to do with this tap.
 */

const SYNC_WATCH_MS = 30_000;

/** A clock that only ticks while `active`, so a finished watch costs nothing. */
const useTick = (active: boolean, onTick?: () => void): number => {
    const [now, setNow] = useState(() => Date.now());
    const tick = useRef(onTick);
    tick.current = onTick;
    useEffect(() => {
        if (!active) return undefined;
        const timer = window.setInterval(() => {
            setNow(Date.now());
            tick.current?.();
        }, 1500);
        return () => window.clearInterval(timer);
    }, [active]);
    return now;
};

/**
 * "Refresh" on Library Matches: pulls the index mirror now. Ends the mirror's
 * back-off first (a plain trigger is dropped while a retry is pending, which would
 * make the button do nothing).
 */
export const useMirrorRefresh = () => {
    const mirror = useSyncExternalStore(subscribeIndexMirror, getIndexMirrorSnapshot);
    const mirrorSync = useSyncExternalStore(subscribeMirrorSyncState, getMirrorSyncState);
    const [run, setRun] = useState<null | { before: SyncSnapshot; startedAt: number }>(null);
    const [final, setFinal] = useState<null | string>(null);

    const snapshotNow: SyncSnapshot = {
        cursor: mirror.meta.cursor,
        epoch: mirror.meta.epoch,
        listening: null,
        sync: mirrorSync,
    };
    const [clock, setClock] = useState(() => Date.now());
    const elapsed = run ? clock - run.startedAt : 0;
    const report = run ? mirrorReport(run.before, snapshotNow, elapsed) : null;
    const watching = !!run && !!report && !report.done && elapsed < SYNC_WATCH_MS;
    const now = useTick(watching);
    useEffect(() => setClock(now), [now]);

    useEffect(() => {
        if (run && report && !watching) setFinal((previous) => previous ?? report.text);
    }, [report, run, watching]);

    const refresh = () => {
        const meta = getIndexMirrorSnapshot().meta;
        const startedAt = Date.now();
        setFinal(null);
        setRun({
            before: {
                cursor: meta.cursor,
                epoch: meta.epoch,
                listening: null,
                sync: getMirrorSyncState(),
            },
            startedAt,
        });
        setClock(startedAt);
        onLbBotAvailable();
    };

    return { refresh, text: final ?? report?.text ?? '', watching };
};

/**
 * "Sync now" on My Listening: asks lb-bot to pull the listens. The baseline is a
 * fresh status read right before the POST (a cached read could already include a
 * sync that finished earlier and be mistaken for this tap's result; a failed read
 * is no baseline at all).
 */
export const useListeningSync = () => {
    const status = useListeningStatus();
    const statusRef = useRef(status);
    statusRef.current = status;
    const [run, setRun] = useState<null | {
        before: LbBotListeningStatus | null;
        startedAt: number;
    }>(null);
    const [starting, setStarting] = useState(false);
    const [final, setFinal] = useState<null | string>(null);
    const [error, setError] = useState<null | { message: string; older: boolean }>(null);
    const [clock, setClock] = useState(() => Date.now());

    // A failed re-read leaves react-query's last data in place, which would read as
    // a current answer, so an errored read is no status.
    const statusNow = status.isError ? null : (status.data ?? null);
    const elapsed = run ? clock - run.startedAt : 0;
    const report = run ? listeningReport(run.before, statusNow, elapsed) : null;
    const watching = !!run && !!report && !report.done && elapsed < SYNC_WATCH_MS;
    const now = useTick(watching, () => void statusRef.current.refetch());
    useEffect(() => setClock(now), [now]);

    useEffect(() => {
        if (run && report && !watching) setFinal((previous) => previous ?? report.text);
    }, [report, run, watching]);

    const sync = async () => {
        // The button is disabled while `starting` or `watching`, so a tap is never
        // ignored while it looks enabled.
        setStarting(true);
        setError(null);
        setRun(null);
        setFinal(null);
        const fresh = await statusRef.current.refetch();
        const before = fresh.isError ? null : (fresh.data ?? null);
        const startedAt = Date.now();
        setRun({ before, startedAt });
        setClock(startedAt);
        setStarting(false);
        const result = await requestListeningSync();
        if (!result.ok) {
            setError(listeningSyncFailure(result));
            setRun(null);
        }
    };

    return { error, starting, sync, text: final ?? report?.text ?? '', watching };
};
