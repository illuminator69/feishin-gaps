import { useQuery } from '@tanstack/react-query';
import isElectron from 'is-electron';
import { useCallback } from 'react';

import { previewSong } from '/@/renderer/features/preview/preview-track';
import { useCurrentServerId } from '/@/renderer/store';
import { Song } from '/@/shared/types/domain-types';
import { PreviewStatus, PreviewTrack } from '/@/shared/types/preview-types';

/**
 * The preview sidecar, for the renderer.
 *
 * Same contract as every other navi-connect surface: not configured, unreachable
 * and "nothing matched" are all the same answer, and the button simply is not
 * there. A preview is a nicety on a page about an album the library does not
 * have — it must never be the reason that page shows an error.
 */

const preview = isElectron() ? window.api.preview : null;

const OFF: PreviewStatus = {
    configured: false,
    cookies: false,
    extractorBlocked: false,
    previewCastable: false,
    upstreamReachable: false,
};

/**
 * Whether previews work at all, and whether they can be cast.
 *
 * One probe per session, like the lb-bot one next door: the hub gaining a
 * `PREVIEW_URL` does not restart this app, so "off" must not be cached forever —
 * but re-probing on every album page would be a request per navigation for an
 * answer that changes about once a month.
 */
export const usePreviewStatus = (): PreviewStatus => {
    const { data } = useQuery<PreviewStatus>({
        enabled: !!preview,
        gcTime: Infinity,
        queryFn: () => preview!.status(),
        queryKey: ['preview', 'status'],
        refetchOnWindowFocus: false,
        staleTime: 10 * 60 * 1000,
    });
    return data ?? OFF;
};

/**
 * The gate every preview control uses.
 *
 * `extractorBlocked` is part of it, and that is the whole reason the sidecar
 * reports it. A blocked extractor answers `{}` to every resolve — which is
 * exactly what an obscure track with no preview looks like — so without this
 * check the button would appear on every row and say "no preview found" every
 * single time, with nothing anywhere saying the feature was dead rather than
 * the catalogue thin. Hiding the control is the same answer this stack gives
 * for lb-bot being unconfigured: the page looks as it did before previews
 * existed.
 */
export const usePreviewAvailable = (): boolean => {
    const status = usePreviewStatus();
    return status.configured && status.upstreamReachable && !status.extractorBlocked;
};

/**
 * Resolve one track to a playable preview.
 *
 * Imperative rather than a query because it is always something the user
 * pressed, and because the answer is consumed once — it goes straight into the
 * queue. Caching it would also be wrong within a session: the `streamUrl` is a
 * capability token with an expiry, so a resolve held for hours and replayed is a
 * 403 rather than a track.
 */
export const useResolvePreview = () => {
    const serverId = useCurrentServerId();

    return useCallback(
        async (args: {
            album?: string;
            artist: string;
            durationMs?: number;
            title: string;
        }): Promise<null | { song: Song; track: PreviewTrack }> => {
            if (!preview || !serverId) return null;
            const track = await preview.resolve(args).catch(() => null);
            if (!track) return null;
            return { song: previewSong(track, serverId), track };
        },
        [serverId],
    );
};
