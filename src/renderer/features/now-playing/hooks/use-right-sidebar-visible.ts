import { useSidebarPanels } from '/@/renderer/features/now-playing/components/sidebar-play-queue';
import { useAppStore, useSideQueueLayout, useSideQueueType } from '/@/renderer/store';

/** Whether the queue panel is on screen: open, in side-queue mode, with at least one panel to show. */
export const useRightSidebarVisible = (): boolean => {
    const rightExpanded = useAppStore((state) => state.sidebar.rightExpanded);
    const sideQueueType = useSideQueueType();
    const panels = useSidebarPanels();
    return rightExpanded && sideQueueType === 'sideQueue' && panels.length > 0;
};

/** Whether the collapsed queue rail stands where the panel was: the panel is hidden but could be shown. */
export const useQueueRailVisible = (): boolean => {
    const rightSidebarVisible = useRightSidebarVisible();
    const sideQueueType = useSideQueueType();
    const sideQueueLayout = useSideQueueLayout();
    const panels = useSidebarPanels();
    return (
        !rightSidebarVisible &&
        sideQueueType === 'sideQueue' &&
        sideQueueLayout !== 'vertical' &&
        panels.length > 0
    );
};
