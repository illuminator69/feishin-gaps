import { useState } from 'react';
import { useNavigate } from 'react-router';

import { useResolveLink } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    externalAlbumPathFor,
    externalArtistPath,
} from '/@/renderer/features/lbbot/utils/external-paths';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';

/**
 * Paste a Spotify/Deezer/Apple/Tidal/Qobuz/YouTube-Music link, land on the
 * album.
 *
 * The gap this closes is a specific one: every route into this app's
 * acquisition surface starts from something the *library* already knows about —
 * an artist you own, a release-group from a Fresh row, a MusicBrainz search.
 * "A friend sent me this link" had no entry point at all.
 *
 * **Confidence is shown, not hidden, and the reason is that half the providers
 * cannot be resolved exactly.** A Spotify or Deezer id maps through that
 * service's own API; an Apple Music, Tidal, Qobuz or YouTube Music URL is
 * resolved by searching MusicBrainz for the artist and title scraped out of the
 * URL or its page title, which is a guess with a score. Presenting that as a
 * fact is how somebody ends up downloading the wrong record from a link they
 * never looked at.
 *
 * A `kind: 'unknown'` answer is not a failure — it is lb-bot saying it does not
 * parse that provider — so it gets a sentence rather than an error toast.
 */
export const ResolveLinkBox = () => {
    const navigate = useNavigate();
    const { pending, resolve } = useResolveLink();
    const [url, setUrl] = useState('');

    const submit = async () => {
        const result = await resolve(url);
        if (!result.ok || !result.data) {
            toast.error({ message: result.error || 'lb-bot could not read that link.' });
            return;
        }
        const link = result.data;
        // lb-bot's own sentence wherever it wrote one. "Not a music link we
        // recognise", "Couldn't read the Tidal page" and "No MusicBrainz artist
        // matched" are three different problems with three different answers,
        // and a sentence written here would have to guess which.
        if (link.kind === 'unknown') {
            toast.show({
                message:
                    link.reason ||
                    'That looks like a link lb-bot does not recognise. Try Spotify or Deezer.',
            });
            return;
        }
        // A low-confidence hit still navigates — the album page is where the
        // user can see whether it is the right record, and refusing to move
        // would leave them with a number and nothing to do about it.
        if (link.confidence > 0 && link.confidence < 0.5) {
            toast.show({
                message: `Best guess: "${link.title}" by ${link.artist}. Check it is the right record before fetching.`,
            });
        }
        if (link.kind === 'artist' && link.mbid) {
            navigate(externalArtistPath(link.mbid, link.artist));
            setUrl('');
            return;
        }
        if (link.rgid) {
            // A track link resolves to its release-group too: there is no
            // per-track page in this app and nothing acquires a single track,
            // so the album is the only useful destination.
            navigate(
                externalAlbumPathFor({
                    artist: link.artist,
                    rgid: link.rgid,
                    title: link.title,
                }),
            );
            setUrl('');
            return;
        }
        toast.error({
            message:
                link.reason ||
                `lb-bot read the link as a ${link.kind} but could not match it on MusicBrainz.`,
        });
    };

    return (
        <Stack gap="xs">
            <Group gap="xs" wrap="nowrap">
                <TextInput
                    onChange={(event) => setUrl(event.currentTarget.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && url.trim()) void submit();
                    }}
                    placeholder="Paste a Spotify, Deezer, Apple Music, Tidal or YouTube Music link"
                    style={{ flex: 1 }}
                    value={url}
                />
                <Button
                    disabled={pending || url.trim().length === 0}
                    loading={pending}
                    onClick={() => void submit()}
                    variant="filled"
                >
                    Find it
                </Button>
            </Group>
            <Text isMuted size="sm">
                Resolves the link to a MusicBrainz release and opens its page, where you can fetch
                it.
            </Text>
        </Stack>
    );
};
