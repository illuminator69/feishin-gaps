import { useState } from 'react';

import { MatchRow } from './match-row';

import { JobFailures } from '/@/renderer/features/lbbot/components/job-failures';
import { openMbidMatchModal } from '/@/renderer/features/lbbot/components/mbid-match-modal';
import {
    removeAlbumOverride,
    undoArtistMerge,
    useAlbumJobPoll,
    useArtistOverrideActions,
    useMergeJobPoll,
} from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    isRunning,
    jobProgress,
    outcomeSentence,
    releaseUnchanged,
    releaseUrl,
    REMOVE_SPEC,
    rowStatusWords,
} from '/@/renderer/features/lbbot/utils/album-override';
import { mergeOutcomeSentence, UNDO_SPEC } from '/@/renderer/features/lbbot/utils/artist-merge';
import { describeToCheck } from '/@/renderer/features/lbbot/utils/lbbot-data';
import { leaveAfterAlbumJob } from '/@/renderer/features/lbbot/utils/leave-album';
import { albumLook, artistLook, mergedLook } from '/@/renderer/features/lbbot/utils/matches-page';
import { Button } from '/@/shared/components/button/button';
import { Text } from '/@/shared/components/text/text';
import { LibraryItem } from '/@/shared/types/domain-types';
import {
    LbBotAlbumOverrideRow,
    LbBotMergeRow,
    LbBotOverride,
    LbBotToCheck,
} from '/@/shared/types/lbbot-types';

/**
 * The four kinds of row on the Library Matches page. The actions are the ones the
 * "lb-bot data" settings panel had - same handlers, same confirmations, same
 * job-following - moved here, not rewritten; only the row around them is new.
 */

const setOn = (epochSeconds: number): string =>
    epochSeconds > 0 ? new Date(epochSeconds * 1000).toLocaleDateString() : '';

// From the page the scan is NOT followed (`null`): lb-bot starts it itself and the
// mirror's index frame brings the result, whereas a follow would poll for a row that
// has just unmounted, under whatever tag was stored when the override was set.
export const ArtistOverrideRow = ({
    available,
    row,
}: {
    available: boolean;
    row: LbBotOverride;
}) => {
    const { failure, pending, remove } = useArtistOverrideActions(row.ndArtistId, null);
    return (
        <MatchRow
            actions={
                <Button
                    disabled={!available || pending}
                    loading={pending}
                    onClick={() => void remove(undefined, row.name)}
                    size="compact-sm"
                    variant="default"
                >
                    Remove
                </Button>
            }
            itemType={LibraryItem.ALBUM_ARTIST}
            look={artistLook({ alive: !!row.name, ndArtistId: row.ndArtistId })}
            subtitle={
                <>
                    <a
                        href={`https://musicbrainz.org/artist/${row.mbid}`}
                        rel="noreferrer"
                        target="_blank"
                    >
                        {row.mbid}
                    </a>
                    {` · Navidrome said: ${row.tagMbid || 'none'}`}
                </>
            }
            title={row.name || 'Artist no longer in your library'}
        >
            {failure && (
                <Text c="red" size="xs">
                    {failure.message}
                </Text>
            )}
        </MatchRow>
    );
};

export const ToCheckRow = ({ available, row }: { available: boolean; row: LbBotToCheck }) => {
    const { failure, pending, set } = useArtistOverrideActions(row.ndArtistId, null);
    return (
        <MatchRow
            actions={
                <>
                    <Button
                        disabled={!available || pending}
                        onClick={() =>
                            openMbidMatchModal({
                                currentMbid: row.mbid || undefined,
                                indexArtist: null,
                                name: row.name,
                                ndId: row.ndArtistId,
                                tagMbid: undefined,
                            })
                        }
                        size="compact-sm"
                        variant="default"
                    >
                        Choose…
                    </Button>
                    {row.kind === 'unmatched' && row.mbid && (
                        <Button
                            disabled={!available || pending}
                            loading={pending}
                            // An ordinary override set to lb-bot's own guess: it becomes
                            // "set by you", and the row leaves the list.
                            onClick={() => void set(row.mbid, row.name)}
                            size="compact-sm"
                            variant="default"
                        >
                            Keep this match
                        </Button>
                    )}
                </>
            }
            itemType={LibraryItem.ALBUM_ARTIST}
            look={artistLook({ alive: !!row.ndArtistId, ndArtistId: row.ndArtistId })}
            subtitle={
                row.kind === 'unmatched'
                    ? describeToCheck(row)
                    : `${describeToCheck(row)} · ${row.albums} ${row.albums === 1 ? 'album' : 'albums'}`
            }
            title={row.name || 'Unnamed artist'}
        >
            {failure && (
                <Text c="red" size="xs">
                    {failure.message}
                </Text>
            )}
        </MatchRow>
    );
};

// I-022: an album whose tags lb-bot rewrote (or whose cover it changed). Undo restores
// them in the background; the row follows that and leaves the list when lb-bot has
// finished. A dead album page left underneath is left, like the dialog's Undo does.
export const AlbumMatchRow = ({
    available,
    row,
}: {
    available: boolean;
    row: LbBotAlbumOverrideRow;
}) => {
    const poll = useAlbumJobPoll();
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const phase = poll.state?.phase ?? null;
    const shown = poll.state?.row ?? row;
    const status = rowStatusWords('album', shown);
    const undo = async () => {
        setBusy(true);
        setError('');
        const result = await removeAlbumOverride(row.id);
        setBusy(false);
        if (!result.ok || !result.data) {
            setError(result.error || 'lb-bot did not accept that.');
            return;
        }
        poll.start(result.data.id, REMOVE_SPEC, {
            onEnd: (ended) =>
                leaveAfterAlbumJob({
                    artistId: '',
                    deadAlbumId: row.albumId,
                    ended,
                    kind: 'remove',
                    startRow: row,
                }),
            seedState: result.data.state,
        });
    };
    return (
        <MatchRow
            actions={
                <Button
                    disabled={!available || busy || phase === 'polling' || isRunning(shown.state)}
                    loading={busy}
                    onClick={() => void undo()}
                    size="compact-sm"
                    variant="default"
                >
                    Undo
                </Button>
            }
            itemType={LibraryItem.ALBUM}
            look={albumLook({ albumId: row.albumId, coverUrl: row.coverUrl })}
            subtitle={row.artist || 'Unknown artist'}
            title={row.album || 'Unknown album'}
        >
            <Text isMuted size="xs">
                {releaseUnchanged(row) || !row.releaseMbid ? (
                    'Cover changed'
                ) : (
                    <>
                        {'Set to '}
                        <a href={releaseUrl(row.releaseMbid)} rel="noreferrer" target="_blank">
                            {row.releaseMbid}
                        </a>
                    </>
                )}
                {setOn(row.setAt) ? ` · ${setOn(row.setAt)}` : ''}
                {status ? ` · ${status}` : ''}
            </Text>
            {phase === 'polling' && (
                <Text isMuted size="xs">
                    {jobProgress('remove', shown).text}
                </Text>
            )}
            {phase === 'failed' && (
                <Text c="red" size="xs">
                    {outcomeSentence('remove', shown)}
                </Text>
            )}
            {phase === 'timeout' && (
                <Text isMuted size="xs">
                    lb-bot is still working. This list shows the result when it finishes.
                </Text>
            )}
            <JobFailures failures={shown.failures} />
            {error && (
                <Text c="red" size="xs">
                    {error}
                </Text>
            )}
        </MatchRow>
    );
};

// I-023: two spellings of one artist that lb-bot retagged to one name. The picture
// and the link are the KEPT artist's: the rewritten spelling's id is gone.
export const MergedRow = ({ available, row }: { available: boolean; row: LbBotMergeRow }) => {
    const poll = useMergeJobPoll();
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const phase = poll.state?.phase ?? null;
    const shown = poll.state?.row ?? row;
    const status = rowStatusWords('merge', shown);
    const undo = async () => {
        setBusy(true);
        setError('');
        const result = await undoArtistMerge(row.id);
        setBusy(false);
        if (!result.ok || !result.data) {
            setError(result.error || 'lb-bot did not accept that.');
            return;
        }
        poll.start(result.data.id, UNDO_SPEC, { seedState: result.data.state });
    };
    return (
        <MatchRow
            actions={
                <Button
                    disabled={!available || busy || phase === 'polling' || isRunning(shown.state)}
                    loading={busy}
                    onClick={() => void undo()}
                    size="compact-sm"
                    variant="default"
                >
                    Undo
                </Button>
            }
            itemType={LibraryItem.ALBUM_ARTIST}
            look={mergedLook(row)}
            subtitle={
                `${row.total} ${row.total === 1 ? 'file' : 'files'}` +
                (setOn(row.setAt) ? ` · ${setOn(row.setAt)}` : '') +
                (status ? ` · ${status}` : '')
            }
            title={`${row.from.name || 'Unknown'} → ${row.into.name || 'Unknown'}`}
        >
            {phase === 'polling' && (
                <Text isMuted size="xs">
                    {jobProgress('undo', shown).text}
                </Text>
            )}
            {phase === 'failed' && (
                <Text c="red" size="xs">
                    {mergeOutcomeSentence('undo', shown)}
                </Text>
            )}
            {phase === 'timeout' && (
                <Text isMuted size="xs">
                    lb-bot is still working. This list shows the result when it finishes.
                </Text>
            )}
            <JobFailures failures={shown.failures} />
            {error && (
                <Text c="red" size="xs">
                    {error}
                </Text>
            )}
        </MatchRow>
    );
};
