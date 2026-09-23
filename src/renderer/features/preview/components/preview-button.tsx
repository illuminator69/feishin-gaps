import { useState } from 'react';

import { usePlayer } from '/@/renderer/features/player/context/player-context';
import { beginQueueSession } from '/@/renderer/features/player/utils/saved-queue-source';
import {
    usePreviewAvailable,
    useResolvePreview,
} from '/@/renderer/features/preview/hooks/use-preview';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { toast } from '/@/shared/components/toast/toast';
import { Play } from '/@/shared/types/types';

/**
 * Hear one track of a record the library does not have.
 *
 * The control is absent — not disabled — when the sidecar is not configured or
 * not reachable, which is the rule every navi-connect surface follows: a page
 * about an unowned album has to look exactly as it did before previews existed
 * whenever this layer is missing.
 *
 * A resolve is a live extractor lookup and takes a couple of seconds, so the
 * spinner is not decoration: without it the row looks inert and gets pressed
 * again, and a second press is a second upstream request for the same track.
 *
 * "Not found" is a normal answer, not an error. Plenty of records have no
 * preview anywhere, and saying so plainly is the honest outcome — the button
 * does not go looking for a near-match to play instead.
 */
interface PreviewButtonProps {
    album?: string;
    artist: string;
    /**
     * The release's own cover, preferred over the one the sidecar returns.
     *
     * The sidecar's `imageUrl` is a **video still**, not a sleeve — it says so
     * itself and calls it a fallback. A caller on an album page already holds
     * the Cover Art Archive URL for that release-group, so a preview queued
     * from here shows the record's artwork rather than a thumbnail of whatever
     * upload matched.
     */
    coverUrl?: string;
    /** Queued after the current track rather than replacing the queue: pressing
     *  preview on an album page should not destroy what is playing. */
    playNext?: boolean;
    title: string;
}

export const PreviewButton = ({ album, artist, coverUrl, playNext, title }: PreviewButtonProps) => {
    const available = usePreviewAvailable();
    const resolvePreview = useResolvePreview();
    const player = usePlayer();
    const [busy, setBusy] = useState(false);

    if (!available || !artist || !title) return null;

    return (
        <ActionIcon
            aria-label={`Preview ${title}`}
            disabled={busy}
            icon="mediaPlay"
            loading={busy}
            onClick={async (event) => {
                event.stopPropagation();
                event.preventDefault();
                setBusy(true);
                const resolved = await resolvePreview({ album, artist, title });
                setBusy(false);
                if (!resolved) {
                    toast.show({ message: `No preview of "${title}" was found.` });
                    return;
                }
                const song = coverUrl ? { ...resolved.song, imageUrl: coverUrl } : resolved.song;
                if (playNext) {
                    player.addToQueueByData([song], Play.NEXT);
                    toast.show({ message: `Preview of "${title}" queued next.` });
                    return;
                }
                // A new listening session, so the saved-queue history gets its
                // own card rather than folding a preview into whatever album was
                // playing. `radio` is the existing kind for a generated,
                // non-library session — see `SavedQueueKind`.
                beginQueueSession('radio', `Preview — ${title}`);
                player.addToQueueByData([song], Play.NOW);
            }}
            size="compact-sm"
            stopsPropagation
            tooltip={{ label: 'Preview this track' }}
            variant="subtle"
        />
    );
};
