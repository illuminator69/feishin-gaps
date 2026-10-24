import { useEffect, useState } from 'react';

import {
    clearScanStarted,
    useStartedScan,
} from '/@/renderer/features/discography/hooks/scan-session';
import {
    scanLine,
    type ScanPhase,
    scanPhase,
    scanPollMs,
} from '/@/renderer/features/discography/scan-phase';
import {
    type LbBotDiscographyRead,
    useIndexArtist,
    useLbBotAvailable,
    useLbBotScanRead,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { toast } from '/@/shared/components/toast/toast';

export interface ArtistScan {
    available: boolean;
    busy: boolean;
    line: string;
    phase: ScanPhase;
    scannable: boolean;
    start: () => void;
}

/**
 * The artist's discography scan (Task 4): the start and its poll from `useIndexArtist`, lb-bot's scan
 * record from the network read, and the scan this session started; every decision is `scanPhase`.
 */
export const useArtistScan = (args: {
    artistMbid?: null | string;
    artistName: string;
    discography: LbBotDiscographyRead;
    ndId: string;
}): ArtistScan => {
    const { artistMbid, artistName, discography, ndId } = args;
    const available = useLbBotAvailable();
    // `useIndexArtist`'s own `pending` lasts its whole poll; the phase needs only the start request.
    const { error, indexArtist, note } = useIndexArtist(ndId);
    const [starting, setStarting] = useState(false);
    const started = useStartedScan(ndId);
    const scannable = Boolean(artistMbid && artistName);
    const [now, setNow] = useState(() => Date.now());
    const [polling, setPolling] = useState(false);
    const { data: network, readAtMs } = useLbBotScanRead(ndId, artistMbid, polling ? 5000 : null);

    const data = discography.data;
    const scan = network?.scan ?? null;
    const phase = scanPhase({
        available,
        indexed: (data?.indexed ?? network?.indexed) === true,
        nowMs: now,
        pending: starting,
        readAtMs,
        releaseCount: data?.indexed ? data.releases.length : 0,
        scan,
        scannable,
        started,
    });
    const pollMs = scanPollMs(phase);

    useEffect(() => {
        setPolling(pollMs !== null);
        if (pollMs === null) return undefined;
        const tick = window.setInterval(() => setNow(Date.now()), pollMs);
        return () => window.clearInterval(tick);
    }, [pollMs]);

    // A scan this session started stops counting once its phase has moved on.
    useEffect(() => {
        if (started && phase !== 'running') clearScanStarted(ndId);
    }, [ndId, phase, started]);

    // A start that failed, or one lb-bot declined, is said once; a scan that failed has its line.
    useEffect(() => {
        if (error && phase !== 'failed') toast.error({ message: error });
    }, [error]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (note) toast.info({ message: note });
    }, [note]);

    return {
        available,
        busy: phase === 'running',
        line: scanLine(phase, {
            error: scan?.error ?? '',
            nowMs: now,
            scannable,
            scannedAtMs: data?.indexed && data.scannedAt > 0 ? data.scannedAt * 1000 : null,
            stale: data?.stale ?? false,
        }),
        phase,
        scannable,
        start: () => {
            if (!scannable || phase === 'running') return;
            setNow(Date.now());
            setStarting(true);
            void indexArtist(artistMbid!, artistName).finally(() => setStarting(false));
        },
    };
};
