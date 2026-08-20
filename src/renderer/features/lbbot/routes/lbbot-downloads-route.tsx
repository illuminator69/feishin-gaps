import { Suspense, useState } from 'react';

import styles from './lbbot-downloads-route.module.css';

import { NativeScrollArea } from '/@/renderer/components/native-scroll-area/native-scroll-area';
import {
    allowMp3AndRetry,
    caaCoverUrl,
    retryFill,
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
 * Reads the ledger and nothing else: no polling of its own. The artist pages already
 * poll whatever they can see, and this view shows the last state each fill reported —
 * which is honest, costs nothing, and keeps a second renderer-lifetime timer off
 * lb-bot's process-wide lock.
 */

/** What a row is doing, in the user's terms rather than lb-bot's.
 *
 *  The outcome is checked before the state because a settled row's last state is not
 *  the whole story: a fill given up on still reads `unknown`, and a cancelled one
 *  keeps whatever it was doing when it was cancelled. */
const stateLabel = (row: LedgerRow): string => {
    if (row.settled) {
        switch (row.outcome) {
            case 'cancelled':
                return 'Cancelled';
            case 'done':
                return 'In your library';
            case 'gaveUp':
                return 'Stopped tracking this one';
            case 'needsPick':
                return 'Waiting for you to pick a source';
            default:
                return row.state === 'needs_match'
                    ? 'Downloaded, but needs sorting out in lb-bot'
                    : "Couldn't get this one";
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

const FillRow = ({ row }: { row: LedgerRow }) => {
    const { dismiss } = useActiveFillsActions();
    const [busy, setBusy] = useState(false);

    const failed = row.settled && row.outcome !== 'done';

    const run = async (action: () => Promise<boolean>) => {
        setBusy(true);
        const ok = await action();
        setBusy(false);
        if (!ok) toast.error({ message: 'lb-bot would not take that request.' });
    };

    return (
        <div className={styles.row}>
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
            </Stack>
            <Group gap="xs">
                {failed && row.mp3WouldHelp && (
                    <Button
                        disabled={busy}
                        onClick={() =>
                            run(() =>
                                allowMp3AndRetry({
                                    groupId: row.key,
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
                {failed && (
                    <Button
                        disabled={busy}
                        onClick={() => run(() => retryFill({ isGap: row.isGap, key: row.key }))}
                        variant="subtle"
                    >
                        Retry
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

const LbBotDownloadsRoute = () => {
    const rows = useFillLedger();
    const { windowBarStyle } = useWindowSettings();

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
                        {rows.length === 0 ? (
                            <Text isMuted>
                                Nothing yet. Albums you ask lb-bot to fetch show up here while they
                                download, and stay until you dismiss them.
                            </Text>
                        ) : (
                            <Stack gap="sm">
                                {rows.map((row) => (
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
