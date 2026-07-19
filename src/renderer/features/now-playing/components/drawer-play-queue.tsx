import { useRef, useState } from 'react';

import { ItemListHandle } from '/@/renderer/components/item-list/types';
import { DockedSimilarSongs } from '/@/renderer/features/now-playing/components/docked-similar-songs';
import { PlayQueue } from '/@/renderer/features/now-playing/components/play-queue';
import { PlayQueueListControls } from '/@/renderer/features/now-playing/components/play-queue-list-controls';
import {
    QueueSheetTab,
    QueueSheetTabs,
} from '/@/renderer/features/now-playing/components/queue-sheet-tabs';
import { Flex } from '/@/shared/components/flex/flex';
import { ItemListKey } from '/@/shared/types/types';

export const DrawerPlayQueue = () => {
    const queueRef = useRef<ItemListHandle | null>(null);
    const [search, setSearch] = useState<string | undefined>(undefined);
    const [activeTab, setActiveTab] = useState<QueueSheetTab>('queue');

    return (
        <Flex direction="column" h="100%">
            <div
                style={{
                    backgroundColor: 'var(--theme-colors-background)',
                    borderRadius: '10px',
                }}
            >
                <QueueSheetTabs activeTab={activeTab} onChange={setActiveTab} />
                {activeTab === 'queue' ? (
                    <PlayQueueListControls
                        handleSearch={setSearch}
                        searchTerm={search}
                        tableRef={queueRef}
                        type={ItemListKey.SIDE_QUEUE}
                    />
                ) : null}
            </div>
            <Flex bg="var(--theme-colors-background)" h="100%" mb="0.6rem">
                {activeTab === 'queue' ? (
                    <PlayQueue listKey={ItemListKey.SIDE_QUEUE} ref={queueRef} searchTerm={search} />
                ) : (
                    <DockedSimilarSongs />
                )}
            </Flex>
        </Flex>
    );
};
