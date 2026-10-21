import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';

import styles from './sidebar-groups.module.css';

import { useDiscoverCapabilities } from '/@/renderer/features/discover/use-discover-capabilities';
import {
    useLbBotAvailable,
    useListeningSupported,
    useOverridesSupported,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { useFillLedger } from '/@/renderer/features/lbbot/stores/active-fills.store';
import { SidebarIcon } from '/@/renderer/features/sidebar/components/sidebar-icon';
import { SidebarItem } from '/@/renderer/features/sidebar/components/sidebar-item';
import {
    attentionCount,
    type SidebarEntry,
    type SidebarGroup,
    sidebarGroups,
    type SidebarRoutes,
} from '/@/renderer/features/sidebar/utils/sidebar-groups';
import { AppRoute } from '/@/renderer/router/routes';
import { useHubConnected } from '/@/renderer/store/hub.store';
import { useSidebarItems } from '/@/renderer/store/settings.store';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Icon } from '/@/shared/components/icon/icon';
import { useMediaQuery } from '/@/shared/hooks/use-media-query';

const ROUTES: SidebarRoutes = {
    activity: AppRoute.DOWNLOADS,
    discover: AppRoute.EXPLORE,
    fresh: AppRoute.FRESH,
    home: AppRoute.HOME,
    libraryMatches: AppRoute.LIBRARY_MATCHES,
    listening: AppRoute.LISTENING,
    mixes: AppRoute.MIXES,
    savedQueues: AppRoute.SAVED_QUEUES,
    settings: AppRoute.SETTINGS,
};

// Entry and group ids to their keys. Discover and Mixed for You keep the model's label (they never had a key).
const LABEL_KEYS: Record<string, string> = {
    activity: 'page.sidebar.activity',
    Albums: 'page.sidebar.albums',
    app: 'page.sidebar.app',
    Artists: 'page.sidebar.albumArtists',
    'Artists-all': 'page.sidebar.artists',
    Favorites: 'page.sidebar.favorites',
    Folders: 'page.sidebar.folders',
    fresh: 'page.sidebar.fresh',
    Genres: 'page.sidebar.genres',
    home: 'page.sidebar.home',
    library: 'page.sidebar.library',
    libraryMatches: 'page.sidebar.libraryMatches',
    libraryTools: 'page.sidebar.libraryTools',
    listening: 'page.sidebar.listening',
    needsAttention: 'page.sidebar.needsAttention',
    'Now Playing': 'page.sidebar.nowPlaying',
    Radio: 'page.sidebar.radio',
    savedQueues: 'page.sidebar.savedQueues',
    Search: 'page.sidebar.search',
    settings: 'page.sidebar.settings',
    statistics: 'page.sidebar.statistics',
    Tracks: 'page.sidebar.tracks',
    you: 'page.sidebar.you',
};

// Rows whose route is empty or shared get their glyph by name (SidebarIcon's default is Home's).
const ICON_NAMES: Record<string, 'activity' | 'attention' | 'library'> = {
    activity: 'activity',
    library: 'library',
    needsAttention: 'attention',
};

/**
 * The sidebar model for the three sidebar surfaces, translated. The only place their gates are read.
 * `fold` folds the lower groups into More; it defaults to the 1100px query (the expanded sidebar),
 * and the collapsed rail and the mobile drawer pass `{ fold: false }`.
 */
export const useSidebarModel = (options?: {
    fold?: boolean;
}): { groups: SidebarGroup[]; more: SidebarEntry[] } => {
    const { t } = useTranslation();
    const narrowQuery = useMediaQuery('(max-width: 1100px)');
    const narrow = options?.fold ?? narrowQuery;
    const lbBotAvailable = useLbBotAvailable();
    const hubConnected = useHubConnected();
    const listeningSupported = useListeningSupported();
    const overridesSupported = useOverridesSupported();
    const { hasSources } = useDiscoverCapabilities();
    const ledger = useFillLedger();
    const sidebarItems = useSidebarItems();
    const count = useMemo(() => attentionCount(ledger), [ledger]);

    return useMemo(() => {
        const label = (id: string, fallback?: string) =>
            LABEL_KEYS[id] ? t(LABEL_KEYS[id]) : fallback;
        const relabel = (entry: SidebarEntry): SidebarEntry => ({
            ...entry,
            children: entry.children?.map(relabel),
            label: label(entry.id, entry.label) as string,
        });
        const model = sidebarGroups({
            attentionCount: count,
            hasDiscoverSources: hasSources,
            hubConnected,
            lbBotAvailable,
            libraryItems: sidebarItems ?? [],
            listeningSupported,
            narrow,
            overridesSupported,
            routes: ROUTES,
        });
        return {
            groups: model.groups.map((g) => ({
                ...g,
                entries: g.entries.map(relabel),
                label: g.label && label(g.id, g.label),
            })),
            more: model.more.map(relabel),
        };
    }, [
        count,
        hasSources,
        hubConnected,
        lbBotAvailable,
        listeningSupported,
        narrow,
        overridesSupported,
        sidebarItems,
        t,
    ]);
};

const useIsSelected = () => {
    const { pathname } = useLocation();
    return (entry: SidebarEntry) => {
        const selected = entry.selectedRoute ?? entry.route;
        return selected !== '' && pathname === selected;
    };
};

const EntryRow = ({ entry, nested }: { entry: SidebarEntry; nested?: boolean }) => {
    const isSelected = useIsSelected();
    const active = isSelected(entry);

    return (
        <SidebarItem
            aria-label={entry.badge ? `${entry.label}, ${entry.badge}` : undefined}
            className={clsx(styles.row, { [styles.nested]: nested, [styles.selected]: active })}
            selectedTo={entry.selectedRoute}
            to={entry.route}
        >
            <span className={styles.rowInner}>
                <SidebarIcon
                    active={active}
                    name={ICON_NAMES[entry.id]}
                    route={entry.route}
                    size="20"
                />
                <span className={styles.rowLabel}>{entry.label}</span>
                {entry.badge ? (
                    <span aria-hidden className={styles.badge}>
                        {entry.badge}
                    </span>
                ) : null}
            </span>
        </SidebarItem>
    );
};

const LibraryRow = ({ entry }: { entry: SidebarEntry }) => {
    const [open, setOpen] = useState(true);
    const children = entry.children ?? [];

    return (
        <>
            <button
                aria-expanded={open}
                className={clsx(styles.row, styles.groupRow)}
                onClick={() => setOpen((o) => !o)}
                type="button"
            >
                <span className={styles.rowInner}>
                    <SidebarIcon active={false} name="library" route="" size="20" />
                    <span className={styles.rowLabel}>{entry.label}</span>
                    <Icon
                        className={clsx(styles.chevron, { [styles.chevronOpen]: open })}
                        icon="arrowDownS"
                        size="md"
                    />
                </span>
            </button>
            {open && children.map((child) => <EntryRow entry={child} key={child.id} nested />)}
        </>
    );
};

/** The rows of the given groups: a small-caps label per labelled group, the Library group's children. */
export const SidebarGroups = ({ groups }: { groups: SidebarGroup[] }) => (
    <>
        {groups.map((group) => (
            <div className={styles.group} key={group.id}>
                {group.label && <div className={styles.groupLabel}>{group.label}</div>}
                {group.entries.map((entry) =>
                    entry.children ? (
                        <LibraryRow entry={entry} key={entry.id} />
                    ) : (
                        <EntryRow entry={entry} key={entry.id} />
                    ),
                )}
            </div>
        ))}
    </>
);

/** The folded lower groups behind one row, at 1100px and under. */
export const SidebarMore = ({ entries }: { entries: SidebarEntry[] }) => {
    const { t } = useTranslation();
    const isSelected = useIsSelected();

    return (
        <DropdownMenu position="right-end">
            <DropdownMenu.Target>
                <button className={styles.row} type="button">
                    <span className={styles.rowInner}>
                        <Icon icon="ellipsisHorizontal" size="lg" />
                        <span className={styles.rowLabel}>{t('page.sidebar.more')}</span>
                        <Icon className={styles.moreChevron} icon="arrowRightS" size="md" />
                    </span>
                </button>
            </DropdownMenu.Target>
            <DropdownMenu.Dropdown>
                {entries.map((entry) => (
                    <DropdownMenu.Item
                        component={Link}
                        key={entry.id}
                        leftSection={
                            <SidebarIcon
                                active={isSelected(entry)}
                                name={ICON_NAMES[entry.id]}
                                route={entry.route}
                                size="18"
                            />
                        }
                        to={entry.route}
                    >
                        {entry.label}
                    </DropdownMenu.Item>
                ))}
            </DropdownMenu.Dropdown>
        </DropdownMenu>
    );
};
