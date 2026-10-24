/**
 * navi-connect F7 (Task 4, Call 13): the states an artist's discography scan really has, read from
 * lb-bot's scan record and from the scan this session started.
 *
 * The hub caches `GET /lb/artist/discography` for 60 s and the scan's POST does not drop that cache,
 * so a read right after the press can be the pre-scan answer. A scan this session started is
 * therefore running until a record carrying its own task id says it ended, or five minutes pass.
 */

export type ScanPhase = 'empty' | 'failed' | 'idle' | 'never' | 'running' | 'unavailable';

/** How long a scan this session started counts as running without a record that ends it. */
export const SCAN_WAIT_MS = 5 * 60 * 1000;

/** The hub's cache of the discography read (`PROXY_CACHE_TTL`), and a margin for the clocks. */
export const HUB_CACHE_MS = 60_000 + 5_000;

export interface ScanInput {
    /** lb-bot reachable through the hub. */
    available: boolean;
    indexed: boolean;
    nowMs: number;
    /** The start request is in flight. */
    pending: boolean;
    /** When the network read carrying `scan` answered (ms), or null before one has. */
    readAtMs: null | number;
    releaseCount: number;
    /** From the network read only: the index mirror carries no scan record. */
    scan: null | ScanRecord;
    /** lb-bot needs the artist's MBID and name to scan. */
    scannable: boolean;
    started: null | { atMs: number; taskId: string };
}

export interface ScanRecord {
    error: string;
    state: 'done' | 'failed' | 'running';
    taskId: string;
}

export const scanPhase = (input: ScanInput): ScanPhase => {
    const { scan, started } = input;
    if (input.pending || scan?.state === 'running') return 'running';
    if (started && input.nowMs - started.atMs < SCAN_WAIT_MS) {
        const ours = scan && scan.taskId === started.taskId ? scan : null;
        // No record of our task yet: a read the hub may still be serving from before the press says
        // nothing; one made later than its cache can hold means lb-bot no longer has the scan (a
        // restart keeps scan records in memory only), so the page rests instead of spinning on.
        const lost =
            !ours && input.readAtMs !== null && input.readAtMs - started.atMs > HUB_CACHE_MS;
        if (!ours && !lost) return 'running';
        if (ours?.state === 'failed') return 'failed';
    } else if (scan?.state === 'failed') {
        return 'failed';
    }
    if (!input.indexed) return input.available ? 'never' : 'unavailable';
    return input.releaseCount === 0 ? 'empty' : 'idle';
};

export const scanPollMs = (phase: ScanPhase): null | number => (phase === 'running' ? 5000 : null);

const DAY_MS = 86_400_000;

const describeScan = (scannedAtMs: number, nowMs: number): string => {
    const days = Math.floor((nowMs - scannedAtMs) / DAY_MS);
    if (days <= 0) return 'Scanned today';
    if (days === 1) return 'Scanned yesterday';
    if (days < 30) return `Scanned ${days} days ago`;
    const months = Math.floor(days / 30);
    return months === 1 ? 'Scanned a month ago' : `Scanned ${months} months ago`;
};

/** The one sentence each phase says. A failure is lb-bot's own sentence, verbatim. */
export const scanLine = (
    phase: ScanPhase,
    input: {
        error: string;
        nowMs: number;
        scannable?: boolean;
        scannedAtMs: null | number;
        stale: boolean;
    },
): string => {
    switch (phase) {
        case 'empty':
            return 'lb-bot scanned this artist and found no releases. A rescan is idempotent if that looks wrong.';
        case 'failed':
            return input.error || 'The discography scan failed.';
        case 'idle':
            if (!input.scannedAtMs) return '';
            return `${describeScan(input.scannedAtMs, input.nowMs)}${input.stale ? ' · out of date' : ''}`;
        case 'never':
            return input.scannable === false
                ? "lb-bot needs this artist's MusicBrainz id and name to look up its releases."
                : 'Not scanned yet. Find missing albums looks up every release on MusicBrainz.';
        case 'running':
            return 'Looking up every release on MusicBrainz. This can take a minute and the count is unknown until it ends. You can leave this page; the scan keeps going.';
        default:
            return '';
    }
};
