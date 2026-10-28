import clsx from 'clsx';
import { useTranslation } from 'react-i18next';

import styles from './source-list.module.css';

import {
    SourceFileListing,
    SourceFilesView,
} from '/@/renderer/features/lbbot/components/source-cards';
import {
    coverageLine,
    isSourceVerified,
    peerLine,
    qualityLine,
    sourceRank,
    verdictLine,
} from '/@/renderer/features/lbbot/components/source-cards-model';
import { extraFilesView } from '/@/renderer/features/lbbot/utils/album-download';
import { Badge } from '/@/shared/components/badge/badge';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { LbBotGapSource } from '/@/shared/types/lbbot-types';

/**
 * lb-bot's ranked Soulseek folders, rendered the same way for a whole-album
 * download and for filling gaps in an album the library partly holds.
 *
 * The order of what a row says is the argument for the screen existing at all:
 *
 * 1. **Is this even the right record** (`albumMatchOk`). This is what catches a
 *    self-titled album, where every candidate folder's name looks plausible and
 *    the blind pick fetched the wrong one.
 * 2. **Coverage** against the canonical MusicBrainz tracklist — never a file
 *    count, which reported a folder holding a different album as complete.
 * 3. **Format, bitrate, size** — the quality actually on offer. The per-album
 *    quality setting is a *ranking* term upstream, not a filter, so this row is
 *    the only thing that really answers "what am I getting".
 * 4. Peer conditions, then the expandable file list.
 */

interface SourceListProps {
    /** The "Download all M files" action is offered only where a caller supplies this -
     *  the whole-album download. The gap-fill picker passes none, so its rows show
     *  nothing new even if a source carried `extraFiles`. */
    downloadDisabled?: boolean;
    /** Null when the row is collapsed. */
    filesFor: (source: LbBotGapSource) => null | SourceFilesView;
    onDownloadAll?: (source: LbBotGapSource) => void;
    onSelect: (source: LbBotGapSource) => void;
    onToggleFiles: (source: LbBotGapSource) => void;
    selectedId: null | number;
    sources: LbBotGapSource[];
}

const FLAG_LABEL: Record<string, string> = {
    compilation: 'Compilation',
    live: 'Live',
    risk: 'Risky',
};

/**
 * Rank 1, but never an unverified one — the shared rule for both the
 * whole-album download picker and the gap-fill picker. `recommended` is
 * already false on an unverified row (server-side, B-019), so it alone
 * would refuse to preselect one; the bug was the FALLBACK, which used to be
 * unconditionally `sources[0]` and could still land on that same unverified
 * rank 1. Falls through to the first verified row instead, and to nothing
 * at all when every row is unverified — the user must choose.
 */
export const defaultSelectedSource = (sources: LbBotGapSource[]): LbBotGapSource | null =>
    sources.find((source) => source.recommended) ?? sources.find(isSourceVerified) ?? null;

export const SourceList = ({
    downloadDisabled,
    filesFor,
    onDownloadAll,
    onSelect,
    onToggleFiles,
    selectedId,
    sources,
}: SourceListProps) => {
    const { t } = useTranslation();

    return (
        <div className={styles.list}>
            {sources.map((source) => {
                const view = filesFor(source);
                const extra = onDownloadAll ? extraFilesView(source) : null;
                return (
                    <div
                        className={clsx(styles.source, {
                            [styles.selected]: selectedId === source.id,
                        })}
                        data-source-row={source.peer}
                        data-source-selected={selectedId === source.id ? 'true' : undefined}
                        key={`${source.peer}-${source.folder}-${source.id}`}
                    >
                        <button
                            aria-pressed={selectedId === source.id}
                            className={styles.head}
                            onClick={() => onSelect(source)}
                            type="button"
                        >
                            <Text fw={600} size="sm">
                                {sourceRank(source)}
                            </Text>
                            <Stack gap="xs">
                                <Group gap="xs">
                                    {/* First, and worded as a question when it fails:
                                    lb-bot's verdict is a heuristic over the
                                    folder name, so it flags a suspicion rather
                                    than stating a fact. */}
                                    <Badge
                                        size="xs"
                                        variant={source.albumMatchOk ? 'default' : 'filled'}
                                    >
                                        {verdictLine(source)}
                                    </Badge>
                                    {/* B-019 (ruling R4): the uploader isn't a
                                    MusicBrainz-credited artist for this release
                                    (or lb-bot's fallback found no evidence
                                    either way) — the picker below refuses to
                                    preselect this row, so the label is what
                                    tells the user a tap here is their own call. */}
                                    {!isSourceVerified(source) && (
                                        <Badge size="xs" variant="filled">
                                            {t('common.artistUnverified', 'Artist unverified')}
                                        </Badge>
                                    )}
                                    <Badge
                                        size="xs"
                                        variant={source.coverageFull ? 'default' : 'outline'}
                                    >
                                        {coverageLine(source)}
                                    </Badge>
                                    {source.recommended && (
                                        <Badge size="xs" variant="outline">
                                            Top ranked
                                        </Badge>
                                    )}
                                    {source.flags.map((flag) => (
                                        <Badge key={flag} size="xs" variant="outline">
                                            {FLAG_LABEL[flag] ?? flag}
                                        </Badge>
                                    ))}
                                </Group>
                                <Text className={styles.folder} size="sm">
                                    {source.folder}
                                </Text>
                                <Text isMuted size="xs">
                                    {qualityLine(source) || 'format unknown'}
                                </Text>
                                <Text isMuted size="xs">
                                    {peerLine(source)}
                                </Text>
                                {source.recommendation && (
                                    <Text isMuted size="xs">
                                        {source.recommendation}
                                    </Text>
                                )}
                            </Stack>
                        </button>

                        <button
                            className={styles.head}
                            onClick={() => onToggleFiles(source)}
                            type="button"
                        >
                            <Text isMuted size="xs">
                                {view ? '▾' : '▸'}
                            </Text>
                            <Text isMuted size="xs">
                                {view ? 'Hide files' : `Show files (${source.fileCount})`}
                            </Text>
                        </button>

                        {/* B-084: only when lb-bot said this folder holds more than a plain
                        download asks for. Quiet line, then a secondary action: the
                        primary one (the footer's Download) still means "the album's
                        tracks". Wraps, so a long folder name or a narrow modal never
                        pushes it off the row. */}
                        {extra && onDownloadAll && (
                            <Group gap="sm" wrap="wrap">
                                <Text isMuted size="xs">
                                    {extra.line}
                                </Text>
                                <Button
                                    disabled={downloadDisabled}
                                    onClick={() => onDownloadAll(source)}
                                    size="compact-xs"
                                    variant="subtle"
                                >
                                    {extra.action}
                                </Button>
                            </Group>
                        )}

                        {view && <SourceFileListing view={view} />}
                    </div>
                );
            })}
        </div>
    );
};
