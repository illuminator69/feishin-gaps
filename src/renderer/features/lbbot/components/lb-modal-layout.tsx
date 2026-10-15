import type { ModalSettings } from '@mantine/modals';
import type { ReactNode } from 'react';

import styles from './lb-modal-layout.module.css';

import { Divider } from '/@/shared/components/divider/divider';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Stack } from '/@/shared/components/stack/stack';

/**
 * The frame the fork's dialogs share, after upstream's lyrics search: one body of a fixed
 * height that scrolls inside the app's own ScrollArea (no native bar, nothing sideways), a
 * divider, and the actions under it, always on screen. The height belongs to the dialog, not to
 * what is in it, so the dialog does not grow and shrink as lb-bot's answers land or as it moves
 * from one step to the next. A `header` (a search box, say) stays above the scroll, as the lyrics
 * search keeps its fields. Inside a page (`inPage`) the same parts sit in the page's own flow.
 */
export const LbModalLayout = ({
    children,
    footer,
    header,
    inPage = false,
}: {
    children: ReactNode;
    footer?: ReactNode;
    header?: ReactNode;
    inPage?: boolean;
}) => {
    if (inPage) {
        return (
            <Stack gap="md">
                {header}
                {children}
                {footer && (
                    <>
                        <Divider />
                        {footer}
                    </>
                )}
            </Stack>
        );
    }

    return (
        <Stack className={styles.root} gap="sm">
            {header && (
                <>
                    {header}
                    <Divider />
                </>
            )}
            <ScrollArea className={styles.body}>{children}</ScrollArea>
            {footer && (
                <>
                    <Divider />
                    {footer}
                </>
            )}
        </Stack>
    );
};

/** The fixed body height: upstream's 600px, or less on a window too short to hold it. */
const BODY_HEIGHT = 'min(600px, calc(100dvh - 12rem))';

/** `openModal` settings for a dialog laid out with `LbModalLayout`. */
export const lbModalSettings = (
    title: string,
    children: ReactNode,
    size: 'lg' | 'xl' = 'xl',
): ModalSettings => ({
    children,
    size,
    styles: { body: { display: 'flex', flexDirection: 'column', height: BODY_HEIGHT } },
    title,
});
