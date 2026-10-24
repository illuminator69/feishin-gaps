import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { defaultSelectedSource } from '/@/renderer/features/lbbot/components/source-list';
import {
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
import { allFilesConfirmation } from '/@/renderer/features/lbbot/utils/album-download';
import { toast } from '/@/shared/components/toast/toast';
import { LbBotGapSource, LbBotResolvedEdition } from '/@/shared/types/lbbot-types';

/**
 * A source search asked for on an album page, by release-group: the edition it was asked for and
 * when. Module level, so leaving the page during the 30 to 90 second wait and coming back finds the
 * same search (react-query keeps its answer five minutes) instead of starting a second one.
 */
type SearchSession = {
    edition: LbBotResolvedEdition | undefined;
    label: string;
    startedAt: number;
};
const sessions = new Map<string, SearchSession>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

const FIVE_MINUTES = 5 * 60 * 1000;

export type SourcesState = 'empty' | 'failed' | 'idle' | 'ready' | 'waiting';

/**
 * Everything the not-owned album page does about getting the album (F7 Task 6): the edition picker,
 * the tracklist that follows it, the ranked sources (only on the press: it is a live Soulseek
 * search), the pick and the download. The logic of the old two-step dialog, with no JSX.
 */
export const useAlbumRequest = ({
    artist,
    rgid,
    title,
}: {
    artist: string;
    rgid: string;
    title: string;
}) => {
    const queryClient = useQueryClient();
    const releasesQuery = useLbBotAlbumReleases(rgid || null);
    // The first variant's first edition, as `defaultEdition` in use-lbbot.ts does, so a one-tap
    // acquire that fell through to this page finds its source search already cached.
    const [variantIndex, setVariantIndexState] = useState(0);
    const [editionIndex, setEditionIndex] = useState(0);
    const variants = releasesQuery.data?.variants ?? [];
    const variant = variants[variantIndex];
    const editions = variant?.editions ?? [];
    const edition = editions[editionIndex] ?? editions[0];
    const releaseMbid = edition?.releaseMbid || variant?.releaseMbid || null;
    const tracklistQuery = useLbBotTracklist(releaseMbid);
    const setVariantIndex = useCallback((index: number) => {
        setVariantIndexState(index);
        setEditionIndex(0);
    }, []);

    // What is known about the chosen pressing, handed to lb-bot so it does not re-resolve the group
    // (its resolver picks "official, earliest" and caches a MusicBrainz failure for five minutes).
    const resolvedEdition: LbBotResolvedEdition | undefined = useMemo(
        () =>
            releaseMbid
                ? {
                      artist: releasesQuery.data?.artist || artist,
                      releaseMbid,
                      title: variant?.title || title,
                      totalTracks: tracklistQuery.data?.tracks.length || variant?.trackCount || 0,
                  }
                : undefined,
        [artist, releaseMbid, releasesQuery.data?.artist, title, tracklistQuery.data, variant],
    );
    const editionLabel = [variant?.title, variant?.disambiguation, edition?.label]
        .filter(Boolean)
        .join(' · ');

    // The search: asked for once, by the press, for the edition shown then.
    const session = useSyncExternalStore(subscribe, () => sessions.get(rgid) ?? null);
    const sources = useLbBotAlbumSources(rgid || null, !!session, session?.edition, {
        staleTime: FIVE_MINUTES,
    });
    const sourcesState: SourcesState = !session
        ? 'idle'
        : sources.isLoading
          ? 'waiting'
          : sources.error
            ? 'failed'
            : sources.sources === null
              ? 'waiting'
              : sources.sources.length === 0
                ? 'empty'
                : 'ready';
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (sourcesState !== 'waiting') return undefined;
        const tick = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(tick);
    }, [sourcesState]);
    const startSearch = useCallback(() => {
        const current = sessions.get(rgid);
        if (current && current.edition?.releaseMbid === resolvedEdition?.releaseMbid) {
            // The same edition again: only a failed or empty answer is asked again.
            if (sourcesState === 'failed' || sourcesState === 'empty') void sources.refetch();
            return;
        }
        sessions.set(rgid, {
            edition: resolvedEdition,
            label: editionLabel,
            startedAt: Date.now(),
        });
        setNow(Date.now());
        emit();
    }, [editionLabel, resolvedEdition, rgid, sources, sourcesState]);
    // "Stop waiting": this page stops waiting for the answer; lb-bot's search is not cancellable from
    // here, and its answer stays in the hub's cache for a minute after it ends.
    const stopSearch = useCallback(() => {
        void queryClient.cancelQueries({ queryKey: sources.queryKey });
        sessions.delete(rgid);
        emit();
    }, [queryClient, rgid, sources.queryKey]);
    const searchedOther =
        !!session && session.edition?.releaseMbid !== resolvedEdition?.releaseMbid;

    // The pick: rank 1 pre-selected (never an artist-unverified row, B-019), an explicit pick wins.
    const [chosen, setChosen] = useState<LbBotGapSource | null>(null);
    const rows = useMemo(() => sources.sources ?? [], [sources.sources]);
    const selected =
        chosen && rows.some((row) => row.id === chosen.id) ? chosen : defaultSelectedSource(rows);
    const [openFiles, setOpenFiles] = useState<Record<number, boolean>>({});
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
    const toggleFiles = useCallback(
        (source: LbBotGapSource) =>
            setOpenFiles((prev) => ({ ...prev, [source.id]: !prev[source.id] })),
        [],
    );

    // The fill: the ledger's row (the app-root watcher keeps it live), polled every 5 s here too.
    const activeFill = useActiveFill(rgid);
    useLbBotFillStatus(activeFill?.releaseMbid ?? null, !!activeFill && !activeFill.settled, rgid);
    const preferredQuality = usePreferredQuality();
    const { setQuality } = useActiveFillsActions();
    const [starting, setStarting] = useState(false);
    const busy = starting || (!!activeFill && !activeFill.settled);

    const download = useCallback(
        async (
            options: { allFiles?: boolean; allowMp3?: boolean; source?: LbBotGapSource } = {},
        ) => {
            const source = options.source ?? selected;
            if (busy || !source || !rgid) return;
            setStarting(true);
            try {
                const result = await startAlbumDownload(
                    rgid,
                    preferredQuality,
                    { folder: source.folder, peer: source.peer },
                    session?.edition ?? resolvedEdition,
                    undefined,
                    { album: title, artist },
                    options.allowMp3 === true,
                    options.allFiles === true,
                );
                if (!result.ok) {
                    // lb-bot's own sentence, verbatim.
                    toast.error({ message: result.error || 'lb-bot could not start the download' });
                    return;
                }
                const confirmation = allFilesConfirmation({
                    asked: options.allFiles === true,
                    echo: result.allFiles,
                    existing: result.existing,
                    fileCount: source.fileCount,
                    peer: source.peer,
                });
                if (confirmation.kind === 'existing') {
                    toast.show({ message: 'Already downloading this album' });
                } else if (confirmation.text) {
                    toast.show({ message: confirmation.text });
                }
            } finally {
                setStarting(false);
            }
        },
        [artist, busy, preferredQuality, resolvedEdition, rgid, selected, session, title],
    );

    return {
        activeFill,
        busy,
        download,
        edition,
        editionIndex,
        editionLabel,
        editions,
        preferredQuality,
        releasesQuery,
        resolvedEdition,
        select: setChosen,
        selected,
        setEditionIndex,
        setQuality,
        setVariantIndex,
        sources: {
            elapsedMs: session ? Math.max(0, now - session.startedAt) : 0,
            error: sources.error,
            filesFor,
            rows,
            searchedLabel: session?.label ?? '',
            searchedOther,
            start: startSearch,
            state: sourcesState,
            stop: stopSearch,
            toggleFiles,
        },
        starting,
        tracklistQuery,
        variant,
        variantIndex,
        variants,
    };
};

export type AlbumRequest = ReturnType<typeof useAlbumRequest>;
