import { AnimatePresence, motion } from 'motion/react';
import { lazy, Suspense, useRef } from 'react';

import styles from './left-sidebar.module.css';

import { ResizeHandle } from '/@/renderer/features/shared/components/resize-handle';
import { DURATION, EASING } from '/@/shared/components/animations/motion-tokens';
import { useExpressiveMotion } from '/@/shared/components/animations/use-expressive-motion';
import { useAppStore } from '/@/renderer/store';

const CollapsedSidebar = lazy(() =>
    import('/@/renderer/features/sidebar/components/collapsed-sidebar').then((module) => ({
        default: module.CollapsedSidebar,
    })),
);

const Sidebar = lazy(() =>
    import('/@/renderer/features/sidebar/components/sidebar').then((module) => ({
        default: module.Sidebar,
    })),
);

interface LeftSidebarProps {
    isResizing: boolean;
    startResizing: (direction: 'left' | 'right', mouseEvent?: MouseEvent) => void;
}

export const LeftSidebar = ({ isResizing, startResizing }: LeftSidebarProps) => {
    const sidebarRef = useRef<HTMLDivElement | null>(null);
    const collapsed = useAppStore((state) => state.sidebar.collapsed);
    const motionEnabled = useExpressiveMotion();

    const content = (
        <Suspense fallback={<></>}>{collapsed ? <CollapsedSidebar /> : <Sidebar />}</Suspense>
    );

    return (
        <aside className={styles.container} id="sidebar">
            {/*
             * Expressive motion: crossfade the full sidebar and the collapsed icon rail when
             * minimizing so the content morph isn't a hard snap (the width itself already tweens
             * via the grid). Both states are stacked (absolute) and fade across each other. Off:
             * the plain instant swap. The resize handle renders last so it stays on top/draggable.
             */}
            {motionEnabled ? (
                <AnimatePresence initial={false}>
                    <motion.div
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        initial={{ opacity: 0 }}
                        key={collapsed ? 'collapsed' : 'expanded'}
                        style={{ inset: 0, position: 'absolute' }}
                        transition={{ duration: DURATION.medium1 / 1000, ease: EASING.emphasized }}
                    >
                        {content}
                    </motion.div>
                </AnimatePresence>
            ) : (
                content
            )}
            <ResizeHandle
                isResizing={isResizing}
                onMouseDown={(e) => {
                    e.preventDefault();
                    startResizing('left');
                }}
                placement="right"
                ref={sidebarRef}
            />
        </aside>
    );
};
