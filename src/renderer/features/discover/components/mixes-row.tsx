import { useMemo } from 'react';

import { DiscoverRow } from './discover-row';
import { DiscoverTile } from './discover-tile';

import { MixArtwork } from '/@/renderer/features/mixes/components/mix-artwork';
import { usePlayMix } from '/@/renderer/features/mixes/hooks/use-mixes';
import { AppRoute } from '/@/renderer/router/routes';
import { isKnownMixKind, useMixes } from '/@/renderer/store';
import { LibraryItem } from '/@/shared/types/domain-types';

/**
 * "Mixed for You" as a Discover row — first, because it is the one row here
 * showing something the user made rather than something a service proposed.
 *
 * A tap plays, and playing **regenerates**: the tile is a recipe, not a
 * tracklist. That is stated in the reason line, because a row of cards that
 * play music is otherwise indistinguishable from the saved queues on the home
 * page, and the difference only becomes visible on the second play.
 *
 * Its capability is `library` — the recipes are hub state, so this row is
 * answerable whenever there is a hub at all, with no lb-bot and no AudioMuse.
 * It renders nothing when there are no mixes, exactly like every other row.
 */
export const MixesRow = ({ title }: { title: string }) => {
    const mixes = useMixes();
    const { play, playingId } = usePlayMix();

    const cards = useMemo(
        () =>
            mixes.slice(0, 20).map((mix) => ({
                content: (
                    <DiscoverTile
                        // The recipe's own cover, stamped from its SEED, drawn
                        // through the one renderer the manage page also uses.
                        // Never the cover of whatever it built last time: the
                        // tracklist is the one thing about a mix guaranteed to
                        // change, so art taken from it would be a picture of a
                        // different mix.
                        cover={<MixArtwork mix={mix} />}
                        isBusy={playingId === mix.id}
                        itemType={LibraryItem.ALBUM}
                        onClick={() => void play(mix)}
                        subtitle={
                            isKnownMixKind(mix.kind) ? `${mix.count} tracks` : 'Needs a newer build'
                        }
                        title={mix.name}
                    />
                ),
                id: mix.id,
            })),
        [mixes, play, playingId],
    );

    return (
        <DiscoverRow
            because="Your own recipes — each one is built again from scratch every time you play it"
            cards={cards}
            isEmpty={cards.length === 0}
            seeAll={{ label: 'Manage', to: AppRoute.MIXES }}
            title={title}
        />
    );
};
