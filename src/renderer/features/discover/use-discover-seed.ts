import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { artistsQueries } from '/@/renderer/features/artists/api/artists-api';
import { useCurrentServerId } from '/@/renderer/store';
import { AlbumArtistListSort, SortOrder } from '/@/shared/types/domain-types';

/** How many of your most-played artists are eligible to seed the row. */
const SEED_POOL = 12;

/**
 * One artist to seed the "Fans also like" row with — not several.
 *
 * The obvious build is to fan out a similar-artists call per top artist and
 * merge. Two things say don't:
 *
 * - **The reason line stops being true.** A merged list can only be captioned
 *   with something generic, and a generic caption is exactly the unattributed
 *   shelf the attribution rule exists to prevent. One seed gives the row an
 *   honest "Because you listen to X".
 * - **The hub's proxy cache is bounded by entries across every lb route**, with
 *   eviction by soonest expiry. Five calls per page open churns a cache the
 *   whole lb-bot surface shares.
 *
 * The seed rotates so the row is not the same artist forever: it is picked from
 * the top `SEED_POOL` by play count, keyed on the hour, so it changes over a day
 * without changing under the reader mid-session.
 */
export const useDiscoverSeedArtist = () => {
    const serverId = useCurrentServerId();

    const { data } = useQuery(
        artistsQueries.albumArtistList({
            options: {
                // A cheap top-N read, not the artist list: the library home
                // learned the hard way that pulling full list queries for
                // secondary rows reads the whole library several times over.
                gcTime: 1000 * 60 * 30,
                staleTime: 1000 * 60 * 30,
            },
            query: {
                limit: SEED_POOL,
                sortBy: AlbumArtistListSort.PLAY_COUNT,
                sortOrder: SortOrder.DESC,
                startIndex: 0,
            },
            serverId,
        }),
    );

    // Read the clock in an effect rather than during render: `Date.now()` is
    // impure, and a seed that could differ between two renders of the same
    // frame is exactly the kind of thing that makes a row change under the
    // reader. One extra render, on a surface that is never on the critical
    // path.
    const [hour, setHour] = useState<null | number>(null);
    useEffect(() => {
        setHour(Math.floor(Date.now() / (60 * 60 * 1000)));
    }, []);

    return useMemo(() => {
        if (hour === null) return null;
        const artists = (data?.items ?? []).filter((a) => a.name);
        if (artists.length === 0) return null;
        const picked = artists[hour % artists.length];
        return { mbid: picked.mbz ?? null, name: picked.name };
    }, [data, hour]);
};
