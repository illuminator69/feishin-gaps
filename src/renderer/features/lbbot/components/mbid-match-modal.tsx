import { useState } from 'react';

import styles from './mbid-match-modal.module.css';

import {
    useArtistOverrideActions,
    useArtistOverrideKind,
    useLbBotArtistLookup,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { parseMbidInput } from '/@/renderer/features/lbbot/utils/artist-override';
import { Badge } from '/@/shared/components/badge/badge';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { closeAllModals, openModal } from '/@/shared/components/modal/modal';
import { Stack } from '/@/shared/components/stack/stack';
import { TextInput } from '/@/shared/components/text-input/text-input';
import { Text } from '/@/shared/components/text/text';
import { useDebouncedValue } from '/@/shared/hooks/use-debounced-value';
import { LbBotArtistCandidate } from '/@/shared/types/lbbot-types';

/**
 * Pick the right MusicBrainz artist for a library artist whose Navidrome tag is
 * missing or wrong (I-019).
 *
 * Candidates are lb-bot's own MusicBrainz artist search, shown as they come — a
 * row is NEVER dropped because its name matches (or does not match) the library
 * artist: "Pink" and "Pink Floyd" are different people and the whole point of
 * this dialog is that the user, not a string compare, decides. A pasted MBID or
 * `musicbrainz.org/artist/<uuid>` URL is the escape hatch for an artist the
 * search ranks badly. The write is lb-bot's: it validates the id against
 * MusicBrainz, stores it, and starts the scan; a refusal is shown here in place.
 */

interface MbidMatchModalProps {
    /** The MBID in force now — the override if there is one, else the tag. */
    currentMbid: null | string | undefined;
    indexArtist: (mbid: string, name: string) => Promise<boolean>;
    name: string;
    ndId: string;
    tagMbid: null | string | undefined;
}

const MbidMatchModal = ({ currentMbid, indexArtist, name, ndId, tagMbid }: MbidMatchModalProps) => {
    const [term, setTerm] = useState(name);
    const [debounced] = useDebouncedValue(term, 500);
    const [pasted, setPasted] = useState('');
    const lookup = useLbBotArtistLookup(debounced ?? '');
    const kind = useArtistOverrideKind(ndId, tagMbid);
    const { failure, pending, remove, set } = useArtistOverrideActions(ndId, indexArtist);

    const parsed = parseMbidInput(pasted);
    const overridden = kind === 'override' || kind === 'override-same';

    const choose = async (mbid: string) => {
        const result = await set(mbid, name);
        if (result.ok) closeAllModals();
    };

    const handleRemove = async () => {
        const result = await remove(tagMbid, name);
        if (result.ok) closeAllModals();
    };

    const candidates: LbBotArtistCandidate[] = lookup.data ?? [];
    const searched = (debounced ?? '').trim().length >= 3;

    return (
        <div className={styles.root}>
            <Stack gap="sm">
                <Text isMuted size="sm">
                    {tagMbid
                        ? 'Navidrome has a MusicBrainz id for this artist. Choose another if it is the wrong one.'
                        : 'Navidrome has no MusicBrainz id for this artist. Choose who they are on MusicBrainz.'}
                </Text>
                <TextInput
                    autoFocus
                    label="Search MusicBrainz"
                    onChange={(event) => setTerm(event.currentTarget.value)}
                    value={term}
                />
            </Stack>
            <div className={styles.body}>
                {searched && lookup.isFetching && candidates.length === 0 && (
                    <Text isMuted py="md" size="sm">
                        Searching…
                    </Text>
                )}
                {searched && !lookup.isFetching && candidates.length === 0 && (
                    <Text isMuted py="md" size="sm">
                        No MusicBrainz artists found for that search.
                    </Text>
                )}
                {candidates.map((candidate) => {
                    const current = candidate.mbid === currentMbid;
                    const detail = [candidate.type, candidate.country].filter(Boolean).join(' · ');
                    return (
                        <div className={styles.candidate} key={candidate.mbid}>
                            <Stack gap={0}>
                                <Group gap="xs" wrap="nowrap">
                                    <Text className={styles.name} fw={600} size="sm">
                                        {candidate.name}
                                    </Text>
                                    {current && (
                                        <Badge size="xs" variant="filled">
                                            Current
                                        </Badge>
                                    )}
                                </Group>
                                <Text isMuted size="xs">
                                    {[candidate.disambiguation, detail]
                                        .filter(Boolean)
                                        .join(' — ') || 'No further detail'}
                                    {candidate.score > 0 ? ` · match ${candidate.score}` : ''}
                                </Text>
                            </Stack>
                            <Button
                                disabled={pending || current}
                                onClick={() => choose(candidate.mbid)}
                                size="compact-sm"
                                variant="default"
                            >
                                Use this artist
                            </Button>
                        </div>
                    );
                })}
            </div>
            <Stack className={styles.footer} gap="xs">
                <Group align="flex-end" gap="xs" wrap="nowrap">
                    <TextInput
                        error={
                            pasted.trim() && !parsed ? 'Not a MusicBrainz artist id or URL' : null
                        }
                        label="Or paste an MBID or musicbrainz.org artist URL"
                        onChange={(event) => setPasted(event.currentTarget.value)}
                        style={{ flex: 1 }}
                        value={pasted}
                    />
                    <Button
                        disabled={pending || !parsed || parsed === currentMbid}
                        loading={pending}
                        onClick={() => parsed && choose(parsed)}
                        variant="filled"
                    >
                        Use this id
                    </Button>
                </Group>
                {failure && (
                    <Text c="red" size="sm">
                        {failure.message}
                    </Text>
                )}
                {overridden && (
                    <Group justify="space-between">
                        <Text isMuted size="xs">
                            {tagMbid
                                ? 'Removing the override goes back to the id in Navidrome.'
                                : 'Removing the override leaves this artist with no MusicBrainz id.'}
                        </Text>
                        <Button
                            disabled={pending}
                            onClick={handleRemove}
                            size="compact-sm"
                            variant="subtle"
                        >
                            Remove override
                        </Button>
                    </Group>
                )}
            </Stack>
        </div>
    );
};

export const openMbidMatchModal = (props: MbidMatchModalProps) => {
    openModal({
        children: <MbidMatchModal {...props} />,
        size: 'lg',
        title: `MusicBrainz match for ${props.name}`,
    });
};
