import { closeAllModals } from '@mantine/modals';

import styles from './saved-queue-preview-modal.module.css';

import {
    SAVED_QUEUE_KIND_LABEL,
    savedQueueDuration,
    savedQueueTitle,
} from '/@/renderer/features/saved-queues/utils/saved-queue-format';
import { SavedQueue } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

// navi-connect: look inside a saved queue before committing to it. Restoring replaces whatever
// you're playing, so "what is actually in this thing" needs an answer that isn't "try it".

const trackTime = (durationMs: null | number | undefined): string => {
    const total = Math.round((durationMs ?? 0) / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

interface Props {
    entry: SavedQueue;
    isRestoring: boolean;
    onResume: () => void;
}

export const SavedQueuePreviewModal = ({ entry, isRestoring, onResume }: Props) => (
    <Stack gap="md">
        <div className={styles.summary}>
            <Text isMuted size="sm">
                {SAVED_QUEUE_KIND_LABEL[entry.sourceKind] ?? 'Queue'} · {entry.songCount} track
                {entry.songCount === 1 ? '' : 's'} · {savedQueueDuration(entry)}
            </Text>
        </div>
        <div className={styles.list}>
            {entry.songs.map((song, n) => (
                <div
                    className={`${styles.track} ${n === entry.currentIndex ? styles.current : ''}`}
                    key={`${song.id}-${n}`}
                >
                    <Text className={styles.index} isMuted size="xs">
                        {n + 1}
                    </Text>
                    <div className={styles.title}>
                        <Text lineClamp={1} size="sm">
                            {song.name}
                            {n === entry.currentIndex ? ' — resumes here' : ''}
                        </Text>
                        <Text isMuted lineClamp={1} size="xs">
                            {[song.artistName, song.album].filter(Boolean).join(' · ')}
                        </Text>
                    </div>
                    <Text className={styles.duration} isMuted size="xs">
                        {trackTime(song.duration)}
                    </Text>
                </div>
            ))}
        </div>
        <Group justify="flex-end">
            <Button onClick={() => closeAllModals()} variant="subtle">
                Close
            </Button>
            <Button
                disabled={isRestoring}
                onClick={() => {
                    onResume();
                    closeAllModals();
                }}
                variant="filled"
            >
                Resume
            </Button>
        </Group>
    </Stack>
);

/** Open the preview for [entry]. `title` mirrors the card's own title. */
export const savedQueuePreviewModalProps = (
    entry: SavedQueue,
    isRestoring: boolean,
    onResume: () => void,
) => ({
    children: (
        <SavedQueuePreviewModal entry={entry} isRestoring={isRestoring} onResume={onResume} />
    ),
    size: 'lg',
    title: savedQueueTitle(entry),
});
