import { useIndexArtist } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { Button } from '/@/shared/components/button/button';
import { LbBotDiscography } from '/@/shared/types/lbbot-types';

interface LbBotIndexButtonProps {
    artistMbid?: null | string;
    artistName: string;
    discography: LbBotDiscography | null | undefined;
    ndId: string;
}

/**
 * The only piece of the lb-bot surface that isn't a tile: scan this artist, or
 * rescan a stale index.
 *
 * It lives in the album toolbar because that is where the thing it affects is —
 * the missing releases are now mixed into the sections below, so a header of
 * their own would be a heading for nothing.
 *
 * Renders nothing without an MBID: lb-bot matches artists by MusicBrainz id, and
 * a name alone is not something it can be asked with.
 */
export const LbBotIndexButton = ({
    artistMbid,
    artistName,
    discography,
    ndId,
}: LbBotIndexButtonProps) => {
    const { indexArtist, pending } = useIndexArtist(ndId);

    if (!discography || !artistMbid) return null;

    // Always offered once an artist can be scanned at all, never hidden on the
    // strength of `indexed && !stale`. A scan that matched the wrong MusicBrainz
    // artist, or that MusicBrainz answered thinly, writes a perfectly fresh index
    // holding nothing — and hiding the button there left the one page that could
    // fix it with no way to ask. A rescan is idempotent and explicit; the only
    // cost of an unnecessary one is a minute of MusicBrainz's patience.
    const empty = discography.releases.length === 0;

    return (
        <Button
            disabled={pending}
            loading={pending}
            onClick={() => indexArtist(artistMbid, artistName)}
            size="compact-md"
            tooltip={{
                label: empty
                    ? 'lb-bot has no releases indexed for this artist. Scanning walks MusicBrainz at one request a second, so a long discography takes a minute.'
                    : 'Scanning walks MusicBrainz at one request a second, so a long discography takes a minute.',
            }}
            variant="subtle"
        >
            {discography.indexed && !empty ? 'Rescan discography' : 'Find missing albums'}
        </Button>
    );
};
