import { Suspense, useEffect, useState } from 'react';
import { generatePath, useNavigate } from 'react-router';

import styles from './lbbot-downloads-route.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { ResolveLinkBox } from '/@/renderer/features/lbbot/components/resolve-link-box';
import { WishlistList } from '/@/renderer/features/lbbot/components/wishlist-list';
import { describeFill, FillButton } from '/@/renderer/features/lbbot/fill-vocabulary';
import {
    allowMp3AndRetry,
    caaCoverUrl,
    cancelFill,
    retryFill,
    useLbBotWishlist,
    useWishlistActions,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    LedgerRow,
    useActiveFillsActions,
    useFillLedger,
} from '/@/renderer/features/lbbot/stores/active-fills.store';
import { ForkListPage } from '/@/renderer/features/shared/components/fork-list-page';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { AppRoute } from '/@/renderer/router/routes';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Progress } from '/@/shared/components/progress/progress';
import { Spinner } from '/@/shared/components/spinner/spinner';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';
import { LibraryItem } from '/@/shared/types/domain-types';

/**
 * navi-connect: everything lb-bot has been asked to fetch from Soulseek, in flight
 * and finished.
 *
 * A fill takes minutes — search, transfer, tagging, placement, then Navidrome's own
 * scan — and until now it was visible *only* from the artist page that started it.
 * Navigate away and there was no way to see it, no way to know it had failed, and no
 * way to ask again.
 *
 * Nothing here polls. The ledger watcher mounted at the app root reads every
 * unsettled row in one request whether or not this page is open — this view used
 * to watch only the rows that passed its filter, so choosing "Didn't land" stopped
 * the fills in flight from being polled at all. Every word and every button comes
 * from `describeFill` (PROTOCOL §15.2), the table Navic renders from too.
 */

/** A one-second clock for the countdowns and "last checked Ns ago". */
const useNow = (): number => {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);
    return now;
};

const BUTTON_LABEL: Record<FillButton, string> = {
    allowMp3: 'Allow MP3 and retry',
    cancel: 'Cancel',
    dismiss: 'Dismiss',
    openAlbum: 'Open album',
    retry: 'Retry',
    tryAnother: 'Try another source',
    wishlist: 'Add to wishlist',
};

const FillRow = ({ now, row }: { now: number; row: LedgerRow }) => {
    const { dismiss } = useActiveFillsActions();
    const { add: addToWishlist } = useWishlistActions();
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);
    const view = describeFill(row, now);
    const failed = row.settled && row.outcome !== 'done';

    const run = async (action: () => Promise<boolean>) => {
        setBusy(true);
        const ok = await action();
        setBusy(false);
        if (!ok) toast.error({ message: 'lb-bot would not take that request.' });
    };

    const openAlbum = () => {
        if (row.rgid) navigate(generatePath(AppRoute.EXTERNAL_ALBUM_DETAIL, { rgid: row.rgid }));
    };

    const actions: Record<FillButton, () => void> = {
        allowMp3: () =>
            run(() => allowMp3AndRetry({ groupId: row.groupId, isGap: row.isGap, key: row.key })),
        cancel: () => run(() => cancelFill(row)),
        dismiss: () => dismiss(row.key),
        openAlbum,
        retry: () => run(() => retryFill({ isGap: row.isGap, key: row.key })),
        tryAnother: () => run(() => retryFill(row, { anotherSource: true })),
        // The row is dismissed once it is on the list: the wishlist page is
        // where it lives from here, and a live button under it was a second
        // way to add the same thing.
        wishlist: () =>
            run(async () => {
                const ok = await addToWishlist({
                    artist: row.artist,
                    rgid: row.rgid,
                    title: row.album,
                });
                if (ok) dismiss(row.key);
                return ok;
            }),
    };

    return (
        <div className={styles.row}>
            {/* Cover art straight from the Archive: lb-bot's own cover route serves
                Navidrome art keyed by a Navidrome album id, which a release the library
                lacks does not have. The app's image, so a release with no Archive cover
                shows the album placeholder (it showed a broken-image icon), and a row with
                no release id keeps the same slot. */}
            <ItemImage
                className={styles.image}
                containerClassName={styles.cover}
                itemType={LibraryItem.ALBUM}
                src={row.rgid ? caaCoverUrl(row.rgid) : null}
                type="table"
            />
            <Stack className={styles.body} gap="0.15rem">
                <Text isNoSelect lineClamp={1}>
                    {row.album || row.artist || row.key}
                </Text>
                <Text isMuted={!failed} size="sm">
                    {row.artist && row.album ? `${row.artist} — ` : ''}
                    {view.headline}
                </Text>
                {view.progress === 'determinate' && <Progress size="xs" value={view.percent} />}
                {view.progress === 'indeterminate' && (
                    <Progress animated size="xs" striped value={100} />
                )}
                {/* lb-bot's own sentence, verbatim, is among these: it is the
                    only thing that separates "no peer had it" from "every
                    source was rejected for format". */}
                {view.sublines.map((line, index) => (
                    <Text isMuted key={index} lineClamp={3} size="sm">
                        {line}
                    </Text>
                ))}
                {view.explain && (
                    <Text isMuted size="sm">
                        {view.explain}
                    </Text>
                )}
            </Stack>
            <Group gap="xs">
                {view.buttons.map((button) => (
                    <Button
                        disabled={busy && button !== 'dismiss'}
                        key={button}
                        onClick={actions[button]}
                        variant="subtle"
                    >
                        {BUTTON_LABEL[button]}
                    </Button>
                ))}
            </Group>
        </div>
    );
};

/** The page's sections: the ledger's four filters, then the wishlist. */
type DownloadsSection = 'wishlist' | LedgerFilter;

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

export const LbBotDownloadsPage = ({
    initialSection = 'all',
}: {
    initialSection?: DownloadsSection;
}) => {
    const rows = useFillLedger();
    const [section, setSection] = useState<DownloadsSection>(initialSection);
    const wishlist = useLbBotWishlist();
    const wishlistCount = wishlist.data?.entries.length;
    const filter: LedgerFilter = section === 'wishlist' ? 'all' : section;
    const shown = rows.filter(MATCHES[filter]);
    const now = useNow();

    const chips = (
        <Group gap="xs">
            {FILTER_ORDER.map((id) => {
                const count = rows.filter(MATCHES[id]).length;
                return (
                    <Button
                        disabled={count === 0 && id !== 'all'}
                        key={id}
                        onClick={() => setSection(id)}
                        variant={section === id ? 'filled' : 'subtle'}
                    >
                        {`${FILTER_LABEL[id]} (${count})`}
                    </Button>
                );
            })}
            <Button
                onClick={() => setSection('wishlist')}
                variant={section === 'wishlist' ? 'filled' : 'subtle'}
            >
                {wishlistCount === undefined ? 'Wishlist' : `Wishlist (${wishlistCount})`}
            </Button>
        </Group>
    );

    return (
        <ForkListPage
            count={section === 'wishlist' ? (wishlistCount ?? null) : shown.length}
            countLoading={section === 'wishlist' && wishlist.isLoading}
            filters={chips}
            title="Downloads"
        >
            {section === 'wishlist' ? (
                <WishlistList />
            ) : (
                <>
                    {/* The one entry point into this surface that does not start
                        from something the library already knows about. It sits
                        here rather than on Discover because a pasted link is an
                        acquisition, and this is the page acquisitions are
                        tracked on. */}
                    <ResolveLinkBox />
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
                                <FillRow key={row.key} now={now} row={row} />
                            ))}
                        </Stack>
                    )}
                </>
            )}
        </ForkListPage>
    );
};

const LbBotDownloadsRouteWithBoundary = () => (
    <PageErrorBoundary>
        <Suspense fallback={<Spinner container />}>
            <LbBotDownloadsPage />
        </Suspense>
    </PageErrorBoundary>
);

export default LbBotDownloadsRouteWithBoundary;
