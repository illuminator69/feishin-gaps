import { useIndexArtist } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Text } from '/@/shared/components/text/text';
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
 * Mounted in **every** index state, disabled where an artist genuinely cannot be
 * scanned. It used to return null without an MBID, which is the one state where
 * the user most needs to be told something: lb-bot matches artists by MusicBrainz
 * id and its index POST requires `mbid` *and* `name`, so an untagged artist can't
 * be indexed at all — a real, recorded limitation. Vanishing made that read as the
 * feature being broken or absent. Saying so is the fix.
 *
 * Still nothing at all when `discography` is undefined, which is lb-bot being
 * unconfigured or unreachable — that layer hides completely, as everywhere else.
 */
export const LbBotIndexButton = ({
    artistMbid,
    artistName,
    discography,
    ndId,
}: LbBotIndexButtonProps) => {
    const { error, indexArtist, pending } = useIndexArtist(ndId);

    if (!discography) return null;

    // Always offered once an artist can be scanned at all, never hidden on the
    // strength of `indexed && !stale`. A scan that matched the wrong MusicBrainz
    // artist, or that MusicBrainz answered thinly, writes a perfectly fresh index
    // holding nothing — and hiding the button there left the one page that could
    // fix it with no way to ask. A rescan is idempotent and explicit; the only
    // cost of an unnecessary one is a minute of MusicBrainz's patience.
    const empty = discography.releases.length === 0;
    // lb-bot's index POST requires BOTH: the MBID is what it scans, the name is what
    // it matches the library against, and it 400s without either. A virtual artist
    // page reached by a bookmarked URL has the id and not yet the name.
    const scannable = Boolean(artistMbid && artistName);

    return (
        <Group gap="xs" wrap="nowrap">
            <Button
                disabled={pending || !scannable}
                loading={pending}
                onClick={() => scannable && indexArtist(artistMbid!, artistName)}
                size="compact-md"
                tooltip={{
                    label: !artistMbid
                        ? 'This artist has no MusicBrainz id in your library, and lb-bot matches artists by MBID — there is nothing to ask it with. Tag the artist in Navidrome and rescan the library first.'
                        : !artistName
                          ? "lb-bot needs the artist's name as well as their MusicBrainz id."
                          : empty
                            ? 'lb-bot has no releases indexed for this artist. Scanning walks MusicBrainz at one request a second, so a long discography takes a minute.'
                            : 'Scanning walks MusicBrainz at one request a second, so a long discography takes a minute.',
                }}
                variant="subtle"
            >
                {discography.indexed && !empty ? 'Rescan discography' : 'Find missing albums'}
            </Button>
            {/* What makes an always-visible Rescan actionable rather than decorative:
                without it there is no way to tell an index built this morning from
                one built in March. `stale` is lb-bot's own verdict on its TTL. */}
            {discography.indexed && discography.scannedAt > 0 && !error && (
                <Text isMuted size="xs">
                    {describeScan(discography.scannedAt)}
                    {discography.stale ? ' · out of date' : ''}
                </Text>
            )}
            {/* The scan failed and lb-bot kept what it had: say so, in its words. */}
            {error && !pending && (
                <Text c="red" size="xs">
                    {error}
                </Text>
            )}
        </Group>
    );
};

/** `scannedAt` is epoch SECONDS (lb-bot's `scanned_at`), not milliseconds. */
const describeScan = (scannedAt: number): string => {
    const days = Math.floor((Date.now() - scannedAt * 1000) / 86_400_000);
    if (days <= 0) return 'Scanned today';
    if (days === 1) return 'Scanned yesterday';
    if (days < 30) return `Scanned ${days} days ago`;
    const months = Math.floor(days / 30);
    return months === 1 ? 'Scanned a month ago' : `Scanned ${months} months ago`;
};
