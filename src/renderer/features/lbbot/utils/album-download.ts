/**
 * B-084: the album source picker's "more files than the album" line and its
 * "Download all" action, the confirmation after it, and the status line's "left out".
 *
 * Pure, so `album-download.harness.ts` can run it. Every sentence is a field of an
 * lb-bot answer (`extraFiles` on a source row, the `allFiles` echo on the download
 * answer, `leftOut` on the fill) and nothing is computed from `files` or `fileCount`
 * except M, the button's label. The wire is `contract-b084.md`.
 */

const files = (n: number): string => `${n} ${n === 1 ? 'file' : 'files'}`;

/**
 * What a source row adds. Nothing when `extraFiles` is absent (the tracklist is
 * unknown, or this is a gap-fill row, which carries none) or 0; otherwise the quiet
 * line and the label of the second action ("Download all M files", M = `fileCount`).
 */
export const extraFilesView = (source: {
    extraFiles?: number;
    fileCount: number;
}): null | { action: string; line: string } => {
    const extra = source.extraFiles;
    if (typeof extra !== 'number' || !Number.isFinite(extra) || extra <= 0) return null;
    return {
        action: `Download all ${files(source.fileCount)}`,
        line: `${extra} more ${extra === 1 ? 'file' : 'files'} in this folder`,
    };
};

export type AllFilesConfirmation =
    | { kind: 'all'; text: string }
    | { kind: 'existing'; text: '' }
    | { kind: 'plain'; text: '' }
    | { kind: 'tracksOnly'; text: string };

/**
 * What to say after a download POST. A fill already running (`existing`) keeps the
 * client's own wording, whatever was asked. Otherwise, if all files were asked for,
 * the ECHO decides: `true` is the confirmation saying all files; false or absent
 * (an older hub drops the key) says plainly that only the album's tracks were
 * asked for, never "all files".
 */
export const allFilesConfirmation = (input: {
    asked: boolean;
    echo: boolean | undefined;
    existing: boolean;
    fileCount: number;
    peer: string;
}): AllFilesConfirmation => {
    if (input.existing) return { kind: 'existing', text: '' };
    if (!input.asked) return { kind: 'plain', text: '' };
    if (input.echo === true) {
        return {
            kind: 'all',
            text: `Asked @${input.peer} for all ${files(input.fileCount)} in the folder`,
        };
    }
    return {
        kind: 'tracksOnly',
        text: "lb-bot is downloading the album's tracks only — it did not take “all files” (the hub may be older)",
    };
};

/** The status line's addition: audio files of the current source's folder that were not asked for. */
export const leftOutText = (leftOut: number | undefined): string =>
    typeof leftOut === 'number' && leftOut > 0
        ? `${leftOut} other ${leftOut === 1 ? 'file' : 'files'} in the folder ${leftOut === 1 ? 'was' : 'were'} left out`
        : '';

/**
 * Which of a fill's `leftOut` / `allFiles` to write onto its ledger row for a status
 * (a poll, a hub `fill` frame, `/lb/fills`). A key the status CARRIES sets the value,
 * 0 and false included. A key it does not carry is not 0 or false - an older hub
 * rebuilds the frame without it - so the stored value stays, with two exceptions
 * where it would be a stale claim: the status is a NEW fill of the release
 * (`sameFill: false`, a reopened row), or it names a different source than the one
 * the stored numbers were read for (a switch: lb-bot recomputes both for the new
 * source). An empty source (not queued yet) says nothing about a switch. An old
 * lb-bot carries neither key ever, so nothing is written and nothing is shown.
 * Returns only the keys to write.
 */
export const nextFillExtras = (
    stored: { allFiles?: boolean; leftOut?: number; source?: string },
    status: { allFiles?: boolean; leftOut?: number; source: string },
    options: { sameFill: boolean },
): { allFiles?: boolean; leftOut?: number } => {
    const switched = !!status.source && !!stored.source && status.source !== stored.source;
    const stale = !options.sameFill || switched;
    const out: { allFiles?: boolean; leftOut?: number } = {};
    if (status.leftOut !== undefined) out.leftOut = status.leftOut;
    else if (stale) out.leftOut = 0;
    if (status.allFiles !== undefined) out.allFiles = status.allFiles;
    else if (stale) out.allFiles = false;
    return out;
};
