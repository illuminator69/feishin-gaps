import { useDiscoverCapabilities } from '/@/renderer/features/discover/use-discover-capabilities';
import { useLbBotAvailable } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { AppRoute } from '/@/renderer/router/routes';
import { useHubConnected } from '/@/renderer/store/hub.store';
import { SidebarItemType } from '/@/renderer/store/settings.store';

/**
 * navi-connect's own nav entries, in one place.
 *
 * They are appended rather than added to `sidebarItems`, which is a persisted,
 * user-reorderable list: an entry there needs a store migration and would still
 * be absent for anyone whose settings predate it. Appearing and disappearing
 * with their backing service is also the rule this whole surface follows.
 *
 * The reason this is a shared hook and not three copies is that it *was* three
 * copies — or rather one, in the expanded sidebar only. `collapsed-sidebar` and
 * `mobile-sidebar` iterate `sidebarItems` alone, so Fresh and Downloads simply
 * did not exist for anyone using a collapsed sidebar or a narrow window. Adding
 * a third entry the same way would have made that three.
 */
export const useNaviConnectSidebarItems = (): SidebarItemType[] => {
    const lbBotAvailable = useLbBotAvailable();
    const hubConnected = useHubConnected();
    const { hasSources } = useDiscoverCapabilities();

    const items: SidebarItemType[] = [];
    // Discover is not lb-bot-gated: it also carries AudioMuse mood search and
    // the rediscovery set, so its gate is "is anything feeding this screen".
    if (hasSources) {
        items.push({ disabled: false, id: 'Discover', label: 'Discover', route: AppRoute.EXPLORE });
    }
    // Mixes are hub state, so the gate is the hub itself rather than any
    // service behind it — and a hub that is down means there are genuinely no
    // mixes to show, not a page that could explain itself.
    if (hubConnected) {
        items.push({
            disabled: false,
            id: 'Mixes',
            label: 'Mixed for You',
            route: AppRoute.MIXES,
        });
    }
    if (lbBotAvailable) {
        items.push(
            { disabled: false, id: 'Fresh', label: 'Fresh', route: AppRoute.FRESH },
            { disabled: false, id: 'Downloads', label: 'Downloads', route: AppRoute.DOWNLOADS },
        );
    }
    return items;
};
