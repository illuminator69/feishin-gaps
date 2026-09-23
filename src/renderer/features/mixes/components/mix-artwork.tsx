import clsx from 'clsx';

import styles from './mix-artwork.module.css';

import { ItemImage } from '/@/renderer/components/item-image/item-image';
import { isKnownMixKind, Mix, MixKind } from '/@/renderer/store';
import { Icon } from '/@/shared/components/icon/icon';
import { LibraryItem } from '/@/shared/types/domain-types';

/**
 * A mix's artwork, drawn the same way everywhere it appears.
 *
 * **One component on purpose.** The list row and the Discover tile both draw
 * through this, so a change cannot reach one and miss the other — which is how
 * two renderers of the same thing come to disagree about what a mix with no
 * cover looks like.
 *
 * `coverArtId` has been on the model, in `PROTOCOL.md` §17.1 and accepted by the
 * hub's `_sanitize_mix` since mixes existed, and **neither client ever wrote
 * it**, so every mix rendered as bare text. It is stamped from the **seed** now
 * (see `mix-form.tsx`), not from the last regenerated queue: the seed is a fixed
 * part of the recipe and stays true on a second play, whereas the tracklist is
 * the one thing about a mix guaranteed to change.
 *
 * With no cover — a `fingerprint` mix has no seed at all, and a `genre` seed is
 * a name rather than an entity — it draws the **kind's glyph** over a gradient
 * keyed on the mix id. An earlier revision of this feature declined to draw
 * anything, arguing a generated cover "would be a lie about what is inside".
 * That objection is right about invented *album art* and does not reach an icon
 * naming the kind: this tile says "this is a fingerprint mix", never "this is
 * what will play".
 */

const KIND_ICON: Record<MixKind, 'album' | 'artist' | 'audioLines' | 'genre' | 'radio'> = {
    adaptive: 'audioLines',
    artist: 'artist',
    fingerprint: 'radio',
    genre: 'genre',
    similar: 'album',
};

/**
 * A stable hue per mix, so the same recipe is the same colour on every screen
 * and after every restart. Derived from the id rather than stored: it is
 * presentation, and putting it on the wire would be a second thing the two
 * clients could disagree about.
 */
const hueFor = (id: string): number => {
    let hash = 0;
    for (let index = 0; index < id.length; index += 1) {
        hash = (hash * 31 + id.charCodeAt(index)) % 360;
    }
    return hash;
};

interface MixArtworkProps {
    className?: string;
    mix: Mix;
}

export const MixArtwork = ({ className, mix }: MixArtworkProps) => {
    if (mix.coverArtId) {
        return (
            <ItemImage
                className={className}
                containerClassName={clsx(styles.cover, className)}
                id={mix.coverArtId}
                itemType={LibraryItem.ALBUM}
                type="itemCard"
            />
        );
    }

    const hue = hueFor(mix.id);
    return (
        <div
            className={clsx(styles.cover, styles.generated, className)}
            style={{
                background: `linear-gradient(135deg, hsl(${hue} 45% 32%), hsl(${(hue + 48) % 360} 40% 20%))`,
            }}
        >
            <Icon
                // An unknown kind still gets a glyph rather than an empty
                // square: the row is shown and named even though playing it is
                // refused, and a blank tile would read as a broken mix rather
                // than an unsupported one.
                icon={isKnownMixKind(mix.kind) ? KIND_ICON[mix.kind] : 'radio'}
                size="xl"
            />
        </div>
    );
};
