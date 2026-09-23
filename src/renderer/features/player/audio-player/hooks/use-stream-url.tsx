import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { api } from '/@/renderer/api';
import { isPreviewId } from '/@/renderer/features/preview/preview-track';
import { TranscodingConfig } from '/@/renderer/store';
import { QueueSong } from '/@/shared/types/domain-types';

/**
 * navi-connect: a preview track brings its own URL.
 *
 * `ext:<provider>:<id>` names a record the library does not have, played from
 * the preview sidecar — so there is nothing for `getStreamUrl` to resolve and
 * asking would be a guaranteed 404 against Navidrome. The signed URL was minted
 * by the hub when the track was resolved and rides on the queue item itself; see
 * `features/preview/preview-track.ts` for why every other consumer is left
 * unaware.
 */
const previewUrl = (song: QueueSong | undefined): string | undefined =>
    song && isPreviewId(song.id) ? (song._previewStreamUrl ?? undefined) : undefined;

export function useSongUrl(
    song: QueueSong | undefined,
    current: boolean,
    transcode: Partial<TranscodingConfig>,
): string | undefined {
    const prior = useRef(['', '']);
    const preview = previewUrl(song);
    const shouldReusePrior = Boolean(
        song?._serverId && current && prior.current[0] === song._uniqueId && prior.current[1],
    );

    const { data: queryStreamUrl } = useQuery({
        enabled: Boolean(song?._serverId) && !preview && !shouldReusePrior,
        queryFn: () =>
            api.controller.getStreamUrl({
                apiClientProps: { serverId: song!._serverId },
                query: {
                    bitrate: transcode.bitrate,
                    format: transcode.format,
                    id: song!.id,
                    maxSampleRate: transcode.maxSampleRate,
                    transcode: transcode.enabled ?? false,
                },
            }),
        queryKey: [
            song?._serverId,
            'stream-url',
            song?.id,
            shouldReusePrior ? 'reuse-prior' : transcode.bitrate,
            shouldReusePrior ? 'reuse-prior' : transcode.format,
            shouldReusePrior ? 'reuse-prior' : transcode.maxSampleRate,
            shouldReusePrior ? 'reuse-prior' : transcode.enabled,
        ] as const,
        staleTime: 60 * 1000,
    });

    useEffect(() => {
        if (!song?._serverId) {
            prior.current = ['', ''];
            return;
        }

        if (!queryStreamUrl) {
            return;
        }

        // Save resolved URL to avoid restarting current track on transcode setting changes.
        prior.current = [song._uniqueId, queryStreamUrl];
    }, [song?._serverId, song?._uniqueId, queryStreamUrl]);

    useEffect(() => {
        if (!song?._serverId) {
            prior.current = ['', ''];
        }
    }, [song?._serverId]);

    if (preview) return preview;
    return shouldReusePrior ? prior.current[1] : queryStreamUrl;
}

export const getSongUrl = async (
    song: QueueSong,
    transcode: Partial<TranscodingConfig>,
    skipAutoTranscode?: boolean,
    forRenderer?: boolean,
    startTime?: number,
) => {
    // The imperative twin of the hook above, used by the MPV/DLNA paths. Same
    // rule: a preview has no Navidrome id to resolve. `startTime` is ignored for
    // one — the sidecar seeks with HTTP Range, not with a URL parameter.
    const preview = previewUrl(song);
    if (preview) return preview;

    const url = await api.controller.getStreamUrl({
        apiClientProps: { serverId: song._serverId },
        query: {
            bitrate: transcode.bitrate,
            container: song.container,
            format: transcode.format,
            forRenderer,
            id: song.id,
            maxSampleRate: transcode.maxSampleRate,
            sampleRate: song.sampleRate,
            skipAutoTranscode,
            startTime,
            transcode: transcode.enabled ?? false,
        },
    });

    return url;
};
