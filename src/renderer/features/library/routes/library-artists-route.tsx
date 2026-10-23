import { useCallback, useDeferredValue, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import styles from './library-artists-route.module.css';

import {
    useLbBotAvailable,
    useLbBotRouteSupport,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { useMirrorShown } from '/@/renderer/features/lbbot/index-mirror/index-mirror';
import {
    ArtistRows,
    type ArtistRowsHandle,
    type PageItem,
} from '/@/renderer/features/library/components/artist-rows';
import { LibraryField } from '/@/renderer/features/library/components/library-field';
import { LibraryFrameActions } from '/@/renderer/features/library/components/library-slot';
import { useLibraryArtists } from '/@/renderer/features/library/hooks/use-library-artists';
import { useLibraryPlace } from '/@/renderer/features/library/hooks/use-library-place';
import {
    type ArtistSort,
    libraryPhase,
    rankArtists,
} from '/@/renderer/features/library/library-model';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { PageErrorBoundary } from '/@/renderer/features/shared/components/page-error-boundary';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { buildFuzzyIndex } from '/@/shared/utils/fuzzy-match';

const LOOKUP_ROUTE = 'GET /lb/artist/lookup';

/**
 * F6: the Library's Artists page (design brief 7.2). One field narrows your artists instantly and
 * forgives typos ("kiosc" finds "Kiosk"); the list is your album artists, read once and filtered here.
 */
const LibraryArtistsRoute = () => {
    const { t } = useTranslation();
    const place = useLibraryPlace();
    const { artists, error, loadedAll, loading, refetch } = useLibraryArtists();
    const rowsRef = useRef<ArtistRowsHandle>(null);
    const fieldRef = useRef<HTMLInputElement>(null);
    const focusRows = useCallback(() => rowsRef.current?.focusFirst(), []);
    const focusField = useCallback(() => fieldRef.current?.focus(), []);

    const lbBotAvailable = useLbBotAvailable();
    const supportsRoute = useLbBotRouteSupport();
    const mirrorShown = useMirrorShown();
    const lookupAvailable = mirrorShown && lbBotAvailable && supportsRoute(LOOKUP_ROUTE);

    // A keystroke never waits on the list: the ranking follows the text a moment later.
    const typed = place.text;
    const deferred = useDeferredValue(typed);
    const query = deferred.trim();
    const index = useMemo(
        () => buildFuzzyIndex(artists.map((artist) => ({ text: artist.name, value: artist }))),
        [artists],
    );
    const ranked = useMemo(() => rankArtists(index, query, place.sort), [index, query, place.sort]);

    const items = useMemo((): PageItem[] => {
        const out: PageItem[] = [];
        if (loading) {
            for (let n = 0; n < 5; n++) {
                out.push({
                    key: `ghost-${n}`,
                    kind: 'ghost',
                    label: n === 0 ? t('page.library.loadingArtists') : undefined,
                });
            }
            return out;
        }
        if (artists.length === 0) {
            out.push(
                error
                    ? {
                          key: 'load-failed',
                          kind: 'message',
                          retry: refetch,
                          retryLabel: t('common.retry'),
                          text: t('page.library.loadFailed'),
                      }
                    : { key: 'empty', kind: 'message', text: t('page.library.empty') },
            );
            return out;
        }

        const phase = libraryPhase({
            lookup: { kind: 'idle' },
            lookupAvailable,
            ownedCount: ranked.length,
            query,
        });
        // A partial list is never called complete; after a failed page the error line says so instead.
        const reading = loadedAll || error ? '' : `, ${t('page.library.stillReading')}`;
        // Above the list, where it is seen: what is held stays, and Retry reads the rest.
        if (error) {
            out.push({
                key: 'partial-failed',
                kind: 'message',
                retry: refetch,
                retryLabel: t('common.retry'),
                text: t('page.library.loadPartialFailed'),
            });
        }
        if (ranked.length > 0) {
            out.push({
                key: 'heading-owned',
                kind: 'heading',
                note:
                    t(phase === 'browse' ? 'page.library.artistCount' : 'page.library.matches', {
                        count: ranked.length,
                        n: ranked.length.toLocaleString(),
                    }) + reading,
                section: 'owned',
                title: t('page.library.yourArtists'),
            });
            for (const { artist, tier } of ranked) {
                out.push({ artist, key: `owned-${artist.id}`, kind: 'owned', tier });
            }
        }
        if (phase === 'none') {
            out.push({
                key: 'none',
                kind: 'message',
                text: t('page.library.noneMatch', { text: query }),
            });
        }
        if (query) {
            out.push({ key: 'note', kind: 'note', text: t('page.library.checkedLibrary') });
        }
        return out;
    }, [artists.length, error, loadedAll, loading, lookupAvailable, query, ranked, refetch, t]);

    return (
        <AnimatedPage>
            <LibraryFrameActions>
                <SegmentedControl
                    aria-label={t('page.library.sortLabel')}
                    className={styles.sort}
                    data={[
                        { label: t('page.library.sortAz'), value: 'az' },
                        { label: t('page.library.sortPlays'), value: 'plays' },
                        { label: t('page.library.sortReleases'), value: 'releases' },
                    ]}
                    onChange={(value) => place.setSort(value as ArtistSort)}
                    value={place.sort}
                />
            </LibraryFrameActions>
            <LibraryField
                hint={t(lookupAvailable ? 'page.library.hintAll' : 'page.library.hintOwned')}
                onChange={place.setText}
                onDown={focusRows}
                ref={fieldRef}
                value={typed}
            />
            <ArtistRows
                initialOffset={place.initialOffset}
                items={items}
                onLeaveTop={focusField}
                onScroll={place.onScroll}
                query={query}
                ref={rowsRef}
            />
        </AnimatedPage>
    );
};

const LibraryArtistsRouteWithBoundary = () => (
    <PageErrorBoundary>
        <LibraryArtistsRoute />
    </PageErrorBoundary>
);

export default LibraryArtistsRouteWithBoundary;
