import { Suspense, useState } from 'react';

import styles from './lbbot-downloads-route.module.css';

import { NativeScrollArea } from '/@/renderer/components/native-scroll-area/native-scroll-area';
import {
    allowMp3AndRetry,
    caaCoverUrl,
    cancelFill,
    retryFill,
    useWatchedFill,
    useWatchedGap,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    LedgerRow,
    useActiveFillsActions,
    useFillLedger,
} from '/@/renderer/features/lbbot/stores/active-fills.store';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { LibraryContainer } from '/@/renderer/features/shared/components/library-container';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { useWindowSettings } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { Platform } from '/@/shared/types/types';

/**
 * navi-connect: everything lb-bot has been asked to fetch from Soulseek, in flight
 * and finished.
 *
 * A fill takes minutes — search, transfer, tagging, placement, then Navidrome's own
 * scan — and until now it was visible *only* from the artist page that started it.
 * Navigate away and there was no way to see it, no way to know it had failed, and no
 * way to ask again.
 *
 * Rows still in flight are watched from here too. This view used to only read the
 * ledger, trusting the artist pages to poll — so a fill cancelled or failed while no
 * artist page was open read "Downloading" forever, and a row that never settles never
 * offers Retry. Settled rows are never polled.
 */

/** What a row is doing, in the user's terms rather than lb-bot's.
 *
 *  The outcome is checked before the state because a settled row's last state is not
 *  the whole story: a fill given up on still reads `unknown`, and a cancelled one
 *  keeps whatever it was doing when it was cancelled. */
/** The failure in a few words, before the row is even read closely.
 *
 *  "No peer had it" and "every source was rejected for format" are different
 *  problems with different buttons, and telling them apart used to mean reading
 *  lb-bot's sentence. These come from `failureKind`; the sentence stays below,
 *  verbatim, because it carries the evidence ("103 peers offered 2,047 files,
 *  but none in FLAC, OPUS") that no label can. */
const FAILURE_LABEL: Record<string, string> = {
    cancelled: 'Cancelled',
    format_rejected: 'No copy in an allowed format',
    mb_unavailable: "Downloaded — MusicBrainz wouldn't answer, so it couldn't be tagged",
    no_source: 'Nobody is sharing this one',
    placement_failed: "Downloaded, but couldn't be filed into the library",
    transfer_failed: 'The download itself failed',
};

const stateLabel = (row: LedgerRow): string => {
    if (row.settled) {
        switch (row.outcome) {
            case 'cancelled':
                return 'Cancelled';
            case 'done':
                return 'In your library';
            case 'gaveUp':
                // Ran out of clock, not a failure — the distinction is deliberate.
                return 'Stopped tracking this one';
            case 'needsPick':
                return 'Waiting for you to pick a source';
            default:
                if (row.state === 'needs_match') {
                    return 'Downloaded, but needs sorting out in lb-bot';
                }
                return (
                    (row.failureKind && FAILURE_LABEL[row.failureKind]) || "Couldn't get this one"
                );
        }
    }
    switch (row.state) {
        // `downloading`, `searching`, and the ambiguous `unknown` — which on a live row
        // means lb-bot's worker has not written its first ledger row yet.
        case 'downloading':
            return 'Downloading';
        case 'placed':
            return 'Added — waiting for the library scan';
        case 'placing':
            return 'Adding to the library';
        case 'queued':
            return 'Waiting for the peer';
        default:
            return 'Looking for a source';
    }
};

/** Keeps an unsettled row's state live. Both hooks are no-ops for a key that names
 *  nothing, which is how one of them sits idle for each row. */
const RowWatcher = ({ row }: { row: LedgerRow }) => {
    useWatchedFill(row.isGap ? '' : row.key, '');
    useWatchedGap(row.isGap ? row.key : '', '');
    return null;
};

const FillRow = ({ row }: { row: LedgerRow }) => {
    const { dismiss } = useActiveFillsActions();
    const [busy, setBusy] = useState(false);

    const failed = row.settled && row.outcome !== 'done';
    // Offer a plain Retry only when lb-bot says one is worth it. It is
    // deliberately false for a format rejection MP3 would fix — that retry
    // re-runs the identical search against the identical peers under the
    // identical format policy, which is the same failure again, not a retry.
    // A row from before lb-bot carried the field has no `failureKind` at all;
    // absent means unknown, so keep offering Retry rather than hiding it.
    const retryable = !row.failureKind || row.retryable !== false;

    const run = async (action: () => Promise<boolean>) => {
        setBusy(true);
        const ok = await action();
        setBusy(false);
        if (!ok) toast.error({ message: 'lb-bot would not take that request.' });
    };

    return (
        <div className={styles.row}>
            {!row.settled && <RowWatcher row={row} />}
            {row.rgid && (
                <img
                    alt=""
                    className={styles.cover}
                    // Cover art straight from the Archive: lb-bot's own cover route
                    // serves Navidrome art keyed by a Navidrome album id, which a
                    // release the library lacks does not have.
                    src={caaCoverUrl(row.rgid)}
                />
            )}
            <Stack className={styles.body} gap="0.15rem">
                <Text isNoSelect lineClamp={1}>
                    {row.album || row.artist || row.key}
                </Text>
                <Text isMuted={!failed} size="sm">
                    {row.artist && row.album ? `${row.artist} — ` : ''}
                    {stateLabel(row)}
                </Text>
                {/* lb-bot's own sentence, verbatim. It is the only thing that separates
                    "no peer had it" from "every source was rejected for format" — and
                    the second of those is what Allow MP3 is for. */}
                {failed && row.reason && (
                    <Text isMuted lineClamp={3} size="sm">
                        {row.reason}
                    </Text>
                )}
                {/* lb-bot's own count, which includes the automatic re-attempt the
                    transient failure kinds get — so one failure reads differently
                    from four without the user having to remember. */}
                {failed && (row.attempts ?? 0) > 1 && (
                    <Text isMuted size="sm">
                        {`Tried ${row.attempts} times`}
                    </Text>
                )}
                {/* A disabled button explains nothing on its own, and a tooltip on one
                    never fires. Say why in the row instead. */}
                {failed && row.mp3WouldHelp && !row.groupId && (
                    <Text isMuted size="sm">
                        lb-bot has no review group for this album, so the MP3 option has nothing to
                        attach to — plain Retry still works.
                    </Text>
                )}
                {/* No Retry offered, so say why rather than leaving a dead row.
                    A format rejection has Allow MP3 above it; anything else
                    non-retryable is a problem asking again cannot move. */}
                {failed && !retryable && !row.mp3WouldHelp && (
                    <Text isMuted size="sm">
                        Asking again would hit the same problem — this one needs fixing in lb-bot.
                    </Text>
                )}
            </Stack>
            <Group gap="xs">
                {/* Gated on the review group, not merely on `mp3WouldHelp`: the MP3
                    opt-in hangs off lb-bot's review group, and an album fill only
                    learns that id from a status poll. Passing the rgid instead made
                    the button run a retry that widened nothing. */}
                {failed && row.mp3WouldHelp && (
                    <Button
                        disabled={busy || !row.groupId}
                        onClick={() =>
                            run(() =>
                                allowMp3AndRetry({
                                    groupId: row.groupId,
                                    isGap: row.isGap,
                                    key: row.key,
                                }),
                            )
                        }
                        variant="subtle"
                    >
                        Allow MP3 and retry
                    </Button>
                )}
                {failed && retryable && (
                    <Button
                        disabled={busy}
                        onClick={() => run(() => retryFill({ isGap: row.isGap, key: row.key }))}
                        variant="subtle"
                    >
                        Retry
                    </Button>
                )}
                {/* The peer was the problem (it crawled, or it dropped the transfer):
                    ask again with it ruled out rather than re-issuing the same request. */}
                {failed && !row.isGap && row.otherSourceExcludes.length > 0 && (
                    <Button
                        disabled={busy}
                        onClick={() => run(() => retryFill(row, { anotherSource: true }))}
                        variant="subtle"
                    >
                        Try another source
                    </Button>
                )}
                {!row.settled && (
                    <Button
                        disabled={busy}
                        onClick={() => run(() => cancelFill(row))}
                        variant="subtle"
                    >
                        Cancel
                    </Button>
                )}
                {row.settled && (
                    <Button onClick={() => dismiss(row.key)} variant="subtle">
                        Dismiss
                    </Button>
                )}
            </Group>
        </div>
    );
};

/**
 * What a chip asks for. All four are predicates over what the ledger already
 * carries — `outcome` and `settled` — so none of this is new vocabulary and
 * nothing here polls.
 *
 * Deliberately component state rather than a persisted setting: "show me the
 * failures" is a thing you want for the next thirty seconds, and a filter that
 * survives a restart is a downloads page that looks empty for reasons the user
 * has long forgotten choosing.
 */
type LedgerFilter = 'all' | 'done' | 'failed' | 'running';

const MATCHES: Record<LedgerFilter, (row: LedgerRow) => boolean> = {
    all: () => true,
    done: (row) => row.settled && row.outcome === 'done',
    // Everything that ended in something other than success, cancellations and
    // "stopped tracking this one" included: the question the chip answers is
    // "what didn't I get", not "what errored".
    failed: (row) => row.settled && row.outcome !== 'done',
    running: (row) => !row.settled,
};

const FILTER_LABEL: Record<LedgerFilter, string> = {
    all: 'All',
    done: 'In your library',
    failed: "Didn't land",
    running: 'In flight',
};

const FILTER_ORDER: LedgerFilter[] = ['all', 'running', 'failed', 'done'];

const LbBotDownloadsRoute = () => {
    const rows = useFillLedger();
    const [filter, setFilter] = useState<LedgerFilter>('all');
    const { windowBarStyle } = useWindowSettings();
    const shown = rows.filter(MATCHES[filter]);

    return (
        <AnimatedPage>
            <NativeScrollArea
                pageHeaderProps={{
                    backgroundColor: 'var(--theme-colors-background)',
                    children: (
                        <LibraryHeaderBar>
                            <LibraryHeaderBar.Title>Downloads</LibraryHeaderBar.Title>
                        </LibraryHeaderBar>
                    ),
                    offset: 200,
                }}
            >
                <LibraryContainer>
                    <Stack
                        gap="lg"
                        mb="5rem"
                        pt={windowBarStyle === Platform.WEB ? '5rem' : '3rem'}
                        px="2rem"
                    >
                        <Text size="xl" weight={700}>
                            Downloads
                        </Text>
                        {/* Only once there is something to filter. A row of chips
                            over an empty page is four controls that all do the
                            same nothing. */}
                        {rows.length > 0 && (
                            <Group gap="xs">
                                {FILTER_ORDER.map((id) => {
                                    const count = rows.filter(MATCHES[id]).length;
                                    return (
                                        <Button
                                            disabled={count === 0 && id !== 'all'}
                                            key={id}
                                            onClick={() => setFilter(id)}
                                            variant={filter === id ? 'filled' : 'subtle'}
                                        >
                                            {`${FILTER_LABEL[id]} (${count})`}
                                        </Button>
                                    );
                                })}
                            </Group>
                        )}
                        {rows.length === 0 ? (
                            <Text isMuted>
                                Nothing yet. Albums you ask lb-bot to fetch show up here while they
                                download, and stay until you dismiss them.
                            </Text>
                        ) : shown.length === 0 ? (
                            // A filter that hides everything must say it was the
                            // filter, not that there is nothing here.
                            <Text isMuted>{`Nothing matches "${FILTER_LABEL[filter]}".`}</Text>
                        ) : (
                            <Stack gap="sm">
                                {shown.map((row) => (
                                    <FillRow key={row.key} row={row} />
                                ))}
                            </Stack>
                        )}
                    </Stack>
                </LibraryContainer>
            </NativeScrollArea>
        </AnimatedPage>
    );
};

const LbBotDownloadsRouteWithBoundary = () => (
    <PageErrorBoundary>
        <Suspense fallback={<Spinner container />}>
            <LbBotDownloadsRoute />
        </Suspense>
    </PageErrorBoundary>
);

export default LbBotDownloadsRouteWithBoundary;
