import type { LbBotGapSource } from '/@/shared/types/lbbot-types';

/**
 * navi-connect R11 (B-222): what a source card says and which card the box may choose on the user's
 * behalf, shared by the missing album's box and the album page's gaps box. Pure, so
 * `source-cards-model.harness.ts` runs it; Navic's copy is `preselectedSource` (RequestStage.kt) and
 * `coverageText` (SourceCards.kt), written by hand (no shared build).
 */

/** B-019 (ruling R4): a missing `artistVerified` is the server's own `True` default. */
export const isSourceVerified = (source: Pick<LbBotGapSource, 'artistVerified'>): boolean =>
    source.artistVerified !== false;

/**
 * A source the box may select without being asked: lb-bot's recommendation, with the artist found
 * in the folder, the folder read as this album, and every track of the release in it (the same bar
 * the one-tap acquire posts on). Anything less is a choice the user makes: a tap is consent, a
 * default is not.
 */
export const isSafeSource = (
    source: Pick<
        LbBotGapSource,
        'albumMatchOk' | 'artistVerified' | 'coverageFull' | 'recommended'
    >,
): boolean =>
    source.recommended && isSourceVerified(source) && source.albumMatchOk && source.coverageFull;

/**
 * The card selected when the sources arrive: the id of the source lb-bot marks safe, else none,
 * and then there is no Download button until a card is chosen.
 */
export const initialSelection = (
    sources: Pick<
        LbBotGapSource,
        'albumMatchOk' | 'artistVerified' | 'coverageFull' | 'id' | 'recommended'
    >[],
): null | number => sources.find(isSafeSource)?.id ?? null;

/**
 * A gap's source the box may select without being asked: Navic's three terms (`preselectedSource`),
 * no coverage term. lb-bot's gap sources (`_source_view`) carry no `coverageFull`, so the album's
 * rule never fired for a gap (review minor 4); a gap's folder is judged against the missing tracks
 * only, which the card's coverage line shows.
 */
export const isSafeGapSource = (
    source: Pick<LbBotGapSource, 'albumMatchOk' | 'artistVerified' | 'recommended'>,
): boolean => source.recommended && isSourceVerified(source) && source.albumMatchOk;

/** The gap's card selected when its sources arrive: the safe one by `isSafeGapSource`, else none. */
export const initialGapSelection = (
    sources: Pick<LbBotGapSource, 'albumMatchOk' | 'artistVerified' | 'id' | 'recommended'>[],
): null | number => sources.find(isSafeGapSource)?.id ?? null;

/**
 * The selection a box shows: the user's pick while it is still on the list, else the preselected
 * one (the album's rule unless the caller passes the gap's).
 */
export const shownSelection = (
    sources: Pick<
        LbBotGapSource,
        'albumMatchOk' | 'artistVerified' | 'coverageFull' | 'id' | 'recommended'
    >[],
    picked: null | number,
    preselected: null | number = initialSelection(sources),
): null | number =>
    picked !== null && sources.some((source) => source.id === picked) ? picked : preselected;

/** The rank lb-bot gave the folder, 1 first; the list position when it sent none. */
export const sourceRank = (source: Pick<LbBotGapSource, 'id' | 'rank'>): number =>
    source.rank || source.id + 1;

/**
 * "All 12 tracks" / "9 of 12 tracks", paired against the canonical tracklist and never a file
 * count; lb-bot's own coverage word when it sent no counts.
 */
export const coverageLine = (
    source: Pick<LbBotGapSource, 'coverage' | 'coverageDetail'>,
): string => {
    const { haveTracks, totalTracks } = source.coverageDetail;
    if (totalTracks > 0 && haveTracks >= totalTracks) return `All ${totalTracks} tracks`;
    if (totalTracks > 0) return `${haveTracks} of ${totalTracks} tracks`;
    return source.coverage || 'Coverage unknown';
};

/** The album verdict, first on every card: a heuristic over the folder name, so a failure asks. */
export const verdictLine = (source: Pick<LbBotGapSource, 'albumMatchOk'>): string =>
    source.albumMatchOk ? 'Matches album title' : 'Different album?';

/** Format, bitrate and size: the quality actually on offer. */
export const qualityLine = (source: Pick<LbBotGapSource, 'bitrate' | 'format' | 'size'>): string =>
    [source.format, source.bitrate, source.size].filter(Boolean).join(' · ');

/** The peer and its conditions. */
export const peerLine = (
    source: Pick<LbBotGapSource, 'freeSlot' | 'peer' | 'queueLength' | 'speedMbps'>,
): string =>
    [
        source.peer ? `@${source.peer}` : '',
        source.speedMbps ? `${source.speedMbps.toFixed(1)} Mbps` : '',
        source.freeSlot ? 'free slot' : '',
        source.queueLength ? `queue ${source.queueLength}` : '',
    ]
        .filter(Boolean)
        .join(' · ');

/** The folder's own name, the last path segment (Soulseek paths use either slash). */
export const folderName = (source: Pick<LbBotGapSource, 'folder' | 'peer'>): string =>
    source.folder.split(/[\\/]/).filter(Boolean).pop() || source.peer;
