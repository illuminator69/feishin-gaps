import { useEffect, useState } from 'react';

import { openMbidMatchModal } from '/@/renderer/features/lbbot/components/mbid-match-modal';
import {
    refreshArtistMeta,
    useArtistOverrideKind,
    useIndexArtist,
    useLbBotAvailable,
    useOverrideControls,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { isNavidromeArtistId } from '/@/renderer/features/lbbot/utils/artist-override';
import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { DropdownMenu } from '/@/shared/components/dropdown-menu/dropdown-menu';
import { Icon } from '/@/shared/components/icon/icon';
import { toast } from '/@/shared/components/toast/toast';
import { LbBotDiscography } from '/@/shared/types/lbbot-types';

interface LbBotIndexButtonProps {
    artistMbid?: null | string;
    artistName: string;
    discography: LbBotDiscography | null | undefined;
    ndId: string;
    /** Navidrome's own MBID tag, which `artistMbid` (the effective one) may differ from. */
    tagMbid?: null | string;
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
 *
 * I-019: when the hub supports MBID overrides, "no MBID" is no longer a dead end
 * ("Choose MusicBrainz artist"), and an artist that has one can be corrected
 * ("Wrong artist?"). With a hub too old to, today's retag-in-Navidrome tooltip
 * stays and neither control exists.
 */
export const LbBotIndexButton = ({
    artistMbid,
    artistName,
    discography,
    ndId,
    tagMbid,
}: LbBotIndexButtonProps) => {
    const { error, indexArtist, note, pending } = useIndexArtist(ndId);
    const available = useLbBotAvailable();
    // The override controls belong to a NAVIDROME artist: the virtual page's
    // `mb:<uuid>` id is answered 400 by lb-bot. Hidden too once an answer said this
    // lb-bot is older.
    const overridesSupported = useOverrideControls() && isNavidromeArtistId(ndId);
    const kind = useArtistOverrideKind(ndId, tagMbid);
    const [refreshing, setRefreshing] = useState(false);

    // A scan's outcome, said once as it arrives: the menu that started it has closed.
    useEffect(() => {
        if (error) toast.error({ message: error });
    }, [error]);
    useEffect(() => {
        if (note) toast.info({ message: note });
    }, [note]);

    if (!discography) return null;

    const refreshAbout = async () => {
        setRefreshing(true);
        const outcome = await refreshArtistMeta(artistMbid, artistName);
        setRefreshing(false);
        if (outcome.ok) toast.success({ message: outcome.message });
        else toast.warn({ message: outcome.message });
    };

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
    const openPicker = () =>
        openMbidMatchModal({
            currentMbid: artistMbid,
            indexArtist,
            name: artistName,
            ndId,
            tagMbid,
        });

    const status = [
        overridesSupported && (kind === 'override' || kind === 'override-same')
            ? 'MusicBrainz match set by you'
            : '',
        // What makes an always-offered Rescan actionable rather than decorative:
        // without it there is no way to tell an index built this morning from one
        // built in March. `stale` is lb-bot's own verdict on its TTL.
        discography.indexed && discography.scannedAt > 0
            ? `${describeScan(discography.scannedAt)}${discography.stale ? ' · out of date' : ''}`
            : 'Not scanned yet',
    ].filter(Boolean);

    // One icon among the toolbar's own (search, sort, order, grouping), opening a menu,
    // the way upstream offers an item's actions. These were up to three text buttons and
    // as many status lines in a row that would not wrap, wider than the toolbar at narrow
    // widths. The scan's spinner is the icon's; its outcome is a toast (see above).
    return (
        <DropdownMenu position="bottom-end">
            <DropdownMenu.Target>
                <ActionIcon
                    icon="brandMusicBrainz"
                    loading={pending || refreshing}
                    tooltip={{ label: 'Missing albums and MusicBrainz match' }}
                    variant="subtle"
                />
            </DropdownMenu.Target>
            <DropdownMenu.Dropdown>
                <DropdownMenu.Label>{status.join(' · ')}</DropdownMenu.Label>
                <DropdownMenu.Item
                    disabled={pending || !scannable}
                    leftSection={<Icon icon="search" />}
                    onClick={() => scannable && indexArtist(artistMbid!, artistName)}
                >
                    {discography.indexed && !empty ? 'Rescan discography' : 'Find missing albums'}
                </DropdownMenu.Item>
                {overridesSupported && artistName && (
                    <DropdownMenu.Item
                        disabled={pending || !available}
                        leftSection={<Icon icon="edit" />}
                        onClick={openPicker}
                    >
                        {artistMbid ? 'Wrong artist?' : 'Choose MusicBrainz artist'}
                    </DropdownMenu.Item>
                )}
                {(artistMbid || artistName) && available && (
                    <DropdownMenu.Item
                        disabled={refreshing}
                        leftSection={<Icon icon="refresh" />}
                        onClick={refreshAbout}
                    >
                        Refresh About
                    </DropdownMenu.Item>
                )}
                {!scannable && (
                    <DropdownMenu.Label>
                        {!artistMbid
                            ? overridesSupported
                                ? 'No MusicBrainz id in your library: choose the artist to scan with.'
                                : 'No MusicBrainz id in your library: tag the artist in Navidrome first.'
                            : "lb-bot needs the artist's name as well as their MusicBrainz id."}
                    </DropdownMenu.Label>
                )}
            </DropdownMenu.Dropdown>
        </DropdownMenu>
    );
};

const describeScan = (scannedAt: number): string => {
    const days = Math.floor((Date.now() - scannedAt * 1000) / 86_400_000);
    if (days <= 0) return 'Scanned today';
    if (days === 1) return 'Scanned yesterday';
    if (days < 30) return `Scanned ${days} days ago`;
    const months = Math.floor(days / 30);
    return months === 1 ? 'Scanned a month ago' : `Scanned ${months} months ago`;
};
