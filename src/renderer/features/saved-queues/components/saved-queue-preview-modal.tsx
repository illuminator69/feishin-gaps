import { closeAllModals } from '@mantine/modals';
import { useTranslation } from 'react-i18next';

import {
    LbModalLayout,
    lbModalSettings,
} from '/@/renderer/features/lbbot/components/lb-modal-layout';
import {
    SAVED_QUEUE_KIND_LABEL,
    savedQueueDuration,
    savedQueueTitle,
} from '/@/renderer/features/saved-queues/utils/saved-queue-format';
import { PreviewSongRow } from '/@/renderer/features/shared/components/preview-song-row';
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

export const SavedQueuePreviewModal = ({ entry, isRestoring, onResume }: Props) => {
    const { t } = useTranslation();
    return (
        <LbModalLayout
            footer={
                <Group justify="flex-end">
                    <Button onClick={() => closeAllModals()} variant="subtle">
                        {t('common.close')}
                    </Button>
                    <Button
                        disabled={isRestoring}
                        onClick={() => {
                            onResume();
                            closeAllModals();
                        }}
                        variant="filled"
                    >
                        {t('naviConnect.savedQueuePreview.resume')}
                    </Button>
                </Group>
            }
            header={
                <Text isMuted size="sm">
                    {SAVED_QUEUE_KIND_LABEL[entry.sourceKind] ?? 'Queue'} · {entry.songCount} track
                    {entry.songCount === 1 ? '' : 's'} · {savedQueueDuration(entry)}
                </Text>
            }
        >
            <Stack gap={2}>
                {entry.songs.map((song, n) => (
                    <PreviewSongRow
                        current={n === entry.currentIndex}
                        imageId={song.imageId}
                        imageUrl={song.imageUrl}
                        index={n + 1}
                        key={`${song.id}-${n}`}
                        serverId={song._serverId}
                        subtitle={[song.artistName, song.album].filter(Boolean).join(' · ')}
                        title={
                            n === entry.currentIndex
                                ? t('naviConnect.savedQueuePreview.resumesHere', {
                                      name: song.name,
                                  })
                                : song.name
                        }
                        trailing={trackTime(song.duration)}
                    />
                ))}
            </Stack>
        </LbModalLayout>
    );
};

/** Open the preview for [entry]. `title` mirrors the card's own title. */
export const savedQueuePreviewModalProps = (
    entry: SavedQueue,
    isRestoring: boolean,
    onResume: () => void,
) =>
    lbModalSettings(
        savedQueueTitle(entry),
        <SavedQueuePreviewModal entry={entry} isRestoring={isRestoring} onResume={onResume} />,
        'lg',
    );
