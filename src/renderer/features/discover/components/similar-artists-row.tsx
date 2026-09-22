import { useNavigate } from 'react-router';

import { useDiscoverSeedArtist } from '../use-discover-seed';
import { DiscoverRow, discoverRowStyles as styles } from './discover-row';

import { useLbBotSimilarArtists } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { artistLinkPath } from '/@/renderer/features/lbbot/utils/external-paths';
import { Text } from '/@/shared/components/text/text';

/**
 * "Fans also like" — and unlike every similar-artist surface this stack already
 * has, the artists you do *not* own are the point.
 *
 * Navidrome's own similar artists are library residents by construction, and
 * lb-bot's similar-albums shelf filters unowned candidates out on purpose
 * ("more of what you already have"). The merge behind both has always produced
 * unowned artists with real MusicBrainz ids and nothing has ever been able to
 * see them. `/lb/artist/similar` marks ownership instead of filtering, so this
 * row is the first surface in the app that can answer "who am I missing".
 *
 * Unowned rows route to the virtual `mb:<mbid>` artist page, which renders their
 * discography from lb-bot and is where a fill is started. Owned ones go to the
 * real page. `artistLinkPath` already encodes that choice and is shared with the
 * Fresh tile so the two cannot drift.
 */
export const SimilarArtistsRow = ({ title }: { title: string }) => {
    const navigate = useNavigate();
    const seed = useDiscoverSeedArtist();
    const { data } = useLbBotSimilarArtists({
        mbid: seed?.mbid,
        name: seed?.name,
    });

    // Someone with neither an id nor an MBID has nowhere to go, so they are not
    // a row — they are a name with no page behind it.
    const artists = (data?.artists ?? [])
        .filter((a) => artistLinkPath(a.artistId, a.mbid))
        .slice(0, 20);

    return (
        <DiscoverRow
            because={
                data?.because
                    ? `Because you listen to ${data.because}`
                    : 'Artists close to what you already play'
            }
            isEmpty={artists.length === 0}
            title={title}
        >
            {artists.map((artist) => {
                const to = artistLinkPath(artist.artistId, artist.mbid);
                return (
                    <button
                        className={`${styles.tile} ${artist.owned ? '' : styles.unowned}`}
                        key={artist.mbid || artist.name}
                        onClick={() => to && navigate(to)}
                        type="button"
                    >
                        <Text className={styles.name} size="sm">
                            {artist.name}
                        </Text>
                        <Text className={styles.name} isMuted size="sm">
                            {artist.owned ? 'In your library' : 'Not in your library'}
                        </Text>
                    </button>
                );
            })}
        </DiscoverRow>
    );
};
