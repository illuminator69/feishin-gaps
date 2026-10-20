import { useEffect, useLayoutEffect, useState } from 'react';

import { useItemImageUrl } from '/@/renderer/components/item-image/item-image';
import { useRemoteAwarePlayerSong } from '/@/renderer/features/hub/hooks/use-remote-aware';
import { usePlayerStoreBase } from '/@/renderer/store/player.store';
import { useCoverColours } from '/@/renderer/store/settings.store';
import { applyWashVars, washVars } from '/@/renderer/themes/cover/apply-wash-vars';
import { type CoverSeed, NEUTRAL_SEED, rolesFor } from '/@/renderer/themes/cover/cover-roles';
import { chooseLight } from '/@/renderer/themes/cover/cover-seed';
import { seedKey } from '/@/renderer/themes/cover/cover-seed-cache';
import { readLastSeed, writeLastSeed } from '/@/renderer/themes/cover/cover-seed-store';
import { useCoverWashStore } from '/@/renderer/themes/cover/cover-wash.store';
import { useCoverSeed } from '/@/renderer/themes/cover/use-cover-seed';
import { logger } from '/@/renderer/utils/logger';
import { LibraryItem } from '/@/shared/types/domain-types';

/** What the window shows: `artSrc` is set only for a seed resolved from that cover. */
interface Shown {
    artSrc: null | string;
    light: boolean;
    seed: CoverSeed;
}

/**
 * Nothing playing is neutral; a resolved cover is its own seed; an unresolved (or failed) cover keeps
 * what is shown, so there is no neutral flash between songs. Returns `shown` itself when nothing changes.
 */
const nextShown = (
    shown: Shown,
    playing: boolean,
    cover: { resolved: boolean; seed: CoverSeed; src?: string },
): Shown => {
    if (!playing) {
        return shown.seed === NEUTRAL_SEED && shown.artSrc === null
            ? shown
            : {
                  artSrc: null,
                  light: chooseLight(NEUTRAL_SEED.meanL, shown.light),
                  seed: NEUTRAL_SEED,
              };
    }
    if (!cover.resolved || !cover.src) return shown;
    if (cover.seed === shown.seed && cover.src === shown.artSrc) return shown;
    return {
        artSrc: cover.src,
        light: chooseLight(cover.seed.meanL, shown.light),
        seed: cover.seed,
    };
};

/**
 * Colours the window from the playing cover while `Cover colours` is on: the roles as variables on
 * `<html>` (before paint), `data-cover-wash="true"`, and the wash store. Mounted once, in the
 * renderer's `ThemedApp`, before `useAppTheme`.
 */
export const useCoverWash = (): void => {
    const on = useCoverColours();
    const song = useRemoteAwarePlayerSong();
    // The player bar's own cover URL (left-controls' `ItemImage`, type "table"), so it is one image.
    const src = useItemImageUrl({
        id: song?.imageId,
        imageUrl: song?.imageUrl ?? undefined,
        itemType: LibraryItem.SONG,
        serverId: song?._serverId,
        type: 'table',
    });
    const key =
        on && song?._serverId && song.imageId ? seedKey(song._serverId, song.imageId) : undefined;
    const cover = useCoverSeed({ key, src });

    // The player store hydrates from IndexedDB after the first render: until it has, "no song" means
    // "not known yet", not "nothing playing", so a cold start keeps the last seed instead of neutral.
    const [playerReady, setPlayerReady] = useState(() => usePlayerStoreBase.persist.hasHydrated());
    useEffect(() => {
        if (playerReady) return undefined;
        if (usePlayerStoreBase.persist.hasHydrated()) {
            setPlayerReady(true);
            return undefined;
        }
        return usePlayerStoreBase.persist.onFinishHydration(() => setPlayerReady(true));
    }, [playerReady]);
    const playingKnown = Boolean(song) || playerReady;

    const [shown, setShown] = useState<Shown>(() => {
        const last = readLastSeed();
        const initial = { artSrc: null, light: chooseLight(last.meanL, false), seed: last };
        const first = playingKnown ? nextShown(initial, Boolean(song), { ...cover, src }) : initial;
        // Seeded here, once, so `useAppTheme`'s first render already has the mode and leaves the accent
        // to the wash; afterwards only the layout effect below writes the store.
        if (on) {
            useCoverWashStore.setState({
                ...first,
                on: true,
                roles: rolesFor(first.seed, first.light),
            });
        }
        return first;
    });

    const next = playingKnown ? nextShown(shown, Boolean(song), { ...cover, src }) : shown;
    if (next !== shown) setShown(next);

    useLayoutEffect(() => {
        if (!on) return;
        const roles = rolesFor(shown.seed, shown.light);
        applyWashVars(washVars(roles));
        document.documentElement.setAttribute('data-cover-wash', 'true');
        useCoverWashStore.setState({
            artSrc: shown.artSrc,
            light: shown.light,
            on: true,
            roles,
            seed: shown.seed,
        });
        // The last window seed, for the next cold start: a cover's, or neutral once nothing is known
        // to play (so a launch with an empty queue does not open on the last cover's colours).
        if (shown.artSrc || shown.seed === NEUTRAL_SEED) writeLastSeed(shown.seed);
        logger.debug('cover wash: applied', {
            cover: Boolean(shown.artSrc),
            hue: Math.round(shown.seed.hue),
            k: shown.seed.k,
            light: shown.light,
        });
    }, [on, shown]);

    // The colours ease only from the second frame on: the first frame shows the seed directly, not a
    // fade from the registered properties' initial (neutral) values.
    useEffect(() => {
        if (!on) return undefined;
        let frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() =>
                document.documentElement.setAttribute('data-cover-wash-ease', 'true'),
            );
        });
        return () => {
            cancelAnimationFrame(frame);
            document.documentElement.removeAttribute('data-cover-wash-ease');
        };
    }, [on]);

    useLayoutEffect(() => {
        if (!on) return undefined;
        return () => {
            applyWashVars(null);
            document.documentElement.removeAttribute('data-cover-wash');
            useCoverWashStore.setState({ artSrc: null, on: false });
            logger.debug('cover wash: off');
        };
    }, [on]);
};
