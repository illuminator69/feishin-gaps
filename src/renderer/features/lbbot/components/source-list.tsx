import clsx from 'clsx';

import styles from './source-list.module.css';

import { Badge } from '/@/shared/components/badge/badge';
import { Group } from '/@/shared/components/group/group';
import { Skeleton } from '/@/shared/components/skeleton/skeleton';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';
import { LbBotGapSource, LbBotSourceFile, LbBotSourceFiles } from '/@/shared/types/lbbot-types';

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

interface SourceFilesView {
    error: string;
    loading: boolean;
    value: LbBotSourceFiles | null;
}

interface SourceListProps {
    /** Null when the row is collapsed. */
    filesFor: (source: LbBotGapSource) => null | SourceFilesView;
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

const coverageText = (source: LbBotGapSource): string => {
    const { haveTracks, totalTracks } = source.coverageDetail;
    if (totalTracks > 0) return `${haveTracks}/${totalTracks} tracks`;
    return source.coverage || 'coverage unknown';
};

const qualityText = (source: LbBotGapSource): string =>
    [source.format, source.bitrate, source.size].filter(Boolean).join(' · ');

const peerText = (source: LbBotGapSource): string =>
    [
        source.peer,
        source.speedMbps ? `${source.speedMbps.toFixed(1)} Mbps` : '',
        source.freeSlot ? 'free slot' : '',
        source.queueLength ? `queue ${source.queueLength}` : '',
    ]
        .filter(Boolean)
        .join(' · ');

const fileDetail = (file: LbBotSourceFile): string =>
    [
        file.ext?.toUpperCase(),
        file.bitrate ? `${file.bitrate} kbps` : '',
        file.sizeMb ? `${file.sizeMb.toFixed(1)} MB` : '',
    ]
        .filter(Boolean)
        .join(' · ');

const SourceFiles = ({ view }: { view: SourceFilesView }) => {
    if (view.loading) {
        return (
            <Stack gap="xs">
                <Skeleton height={14} />
                <Skeleton height={14} />
                <Skeleton height={14} />
            </Stack>
        );
    }
    if (view.error) {
        return (
            <Text isMuted size="sm">
                {view.error}
            </Text>
        );
    }
    if (!view.value) return null;

    const { expanded, files, filesTruncated } = view.value;

    return (
        <Stack gap="xs">
            {/* Not cosmetic. `expanded: false` means lb-bot could not reach the
                peer, so these rows are the original search hits rather than the
                folder's real contents — which is exactly the case where a file
                you need looks absent when it is only unlisted. */}
            {!expanded && (
                <Text isMuted size="xs">
                    Could not open this peer&apos;s folder — showing the search results only, which
                    may not be everything it has.
                </Text>
            )}
            <div className={styles.files}>
                {files.map((file, index) => (
                    <div
                        className={clsx(styles.file, { [styles.unmatched]: !file.matchedTo })}
                        key={`${file.filename}-${index}`}
                    >
                        <Text className={styles.filename} size="xs">
                            {file.filename}
                        </Text>
                        <Text isMuted size="xs">
                            {file.matchedTo
                                ? `→ ${file.matchedTo.position ? `${file.matchedTo.position}. ` : ''}${file.matchedTo.title}`
                                : 'no matching track'}
                            {file.accepted ? '' : ' · format not accepted'}
                            {fileDetail(file) ? ` · ${fileDetail(file)}` : ''}
                        </Text>
                    </div>
                ))}
                {files.length === 0 && (
                    <Text isMuted size="xs">
                        No files listed.
                    </Text>
                )}
            </div>
            {filesTruncated && (
                <Text isMuted size="xs">
                    Listing truncated.
                </Text>
            )}
            {view.value.coverageDetail.unmatched.length > 0 && (
                <Text isMuted size="xs">
                    Nothing here covers: {view.value.coverageDetail.unmatched.join(', ')}
                </Text>
            )}
        </Stack>
    );
};

export const SourceList = ({
    filesFor,
    onSelect,
    onToggleFiles,
    selectedId,
    sources,
}: SourceListProps) => (
    <div className={styles.list}>
        {sources.map((source) => {
            const view = filesFor(source);
            return (
                <div
                    className={clsx(styles.source, {
                        [styles.selected]: selectedId === source.id,
                    })}
                    key={`${source.peer}-${source.folder}-${source.id}`}
                >
                    <button className={styles.head} onClick={() => onSelect(source)} type="button">
                        <Text fw={600} size="sm">
                            {source.rank || source.id + 1}
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
                                    {source.albumMatchOk
                                        ? 'Matches album title'
                                        : 'Different album?'}
                                </Badge>
                                <Badge
                                    size="xs"
                                    variant={source.coverageFull ? 'default' : 'outline'}
                                >
                                    {coverageText(source)}
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
                                {qualityText(source) || 'format unknown'}
                            </Text>
                            <Text isMuted size="xs">
                                {peerText(source)}
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

                    {view && <SourceFiles view={view} />}
                </div>
            );
        })}
    </div>
);
