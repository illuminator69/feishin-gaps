import type { ReactNode } from 'react';

import { PageHeader } from '/@/renderer/components/page-header/page-header';
import { AnimatedPage } from '/@/renderer/features/shared/components/animated-page';
import { FilterBar } from '/@/renderer/features/shared/components/filter-bar';
import { LibraryHeaderBar } from '/@/renderer/features/shared/components/library-header-bar';
import { Group } from '/@/shared/components/group/group';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Stack } from '/@/shared/components/stack/stack';

/**
 * A fork page that lists things, built the way upstream builds its list pages (the radio
 * stations, the playlists): the title and its count in the page header with the page's own
 * actions beside them, the filters in a FilterBar under it, and the list in a ScrollArea below.
 * The fork's pages used to put the title in a sticky bar that only shows on scroll AND again as
 * large text at the top of the content, so it read twice; and their filters sat inside the
 * scrolling content.
 */
export const ForkListPage = ({
    actions,
    children,
    count,
    countLoading = false,
    filters,
    title,
}: {
    actions?: ReactNode;
    children: ReactNode;
    count?: null | number;
    countLoading?: boolean;
    filters?: ReactNode;
    title: string;
}) => (
    <AnimatedPage>
        <Stack gap={0}>
            <PageHeader>
                <LibraryHeaderBar ignoreMaxWidth>
                    <LibraryHeaderBar.Title>{title}</LibraryHeaderBar.Title>
                    {(count !== undefined || countLoading) && (
                        <LibraryHeaderBar.Badge isLoading={countLoading || count === null}>
                            {count}
                        </LibraryHeaderBar.Badge>
                    )}
                </LibraryHeaderBar>
                {actions && (
                    <Group gap="sm" wrap="nowrap">
                        {actions}
                    </Group>
                )}
            </PageHeader>
            {filters && <FilterBar>{filters}</FilterBar>}
        </Stack>
        <ScrollArea style={{ flex: 1, minHeight: 0 }}>
            <Stack gap="md" p="md">
                {children}
            </Stack>
        </ScrollArea>
    </AnimatedPage>
);
