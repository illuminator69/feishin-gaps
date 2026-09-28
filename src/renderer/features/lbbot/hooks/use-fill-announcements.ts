import isElectron from 'is-electron';
import { useEffect, useRef } from 'react';

import { announcementKindFor } from '/@/renderer/features/lbbot/hooks/fill-announce-logic';
import { useLbBotWebUrl } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import {
    FillOutcome,
    useActiveFillsStore,
} from '/@/renderer/features/lbbot/stores/active-fills.store';
import { toast } from '/@/shared/components/toast/toast';

const lbBot = isElectron() ? window.api.lbBot : null;

/**
 * navi-connect: say something when a fill finishes, wherever the user happens to be.
 *
 * Mounted once, at the app root, and driven off the ledger rather than off a poll —
 * which is what makes it fire exactly once. A fill is watched by the artist page and
 * possibly by an open modal at the same time, so announcing from either of those
 * would double up; the *transition to settled* happens in one place, in the store.
 *
 * Only the two outcomes worth interrupting for. `needsPick` is the gap picker waiting
 * on the user and `cancelled` is something they just did — both announce themselves —
 * and `gaveUp` means we stopped tracking, not that anything happened.
 */
export const useFillAnnouncements = () => {
    // What each row's outcome was last time we looked. Seeded from the first
    // snapshot rather than empty, so rehydrating a week of finished rows at startup
    // does not announce all of them.
    const seen = useRef<Map<string, FillOutcome> | null>(null);
    // lb-bot's own web UI, for the "needs sorting out" link — read through a ref
    // so the effect below (mounted once, `[]` deps) always sees the latest value
    // rather than whatever it was at mount.
    const webUrl = useLbBotWebUrl();
    const webUrlRef = useRef(webUrl);
    webUrlRef.current = webUrl;

    useEffect(() => {
        const snapshot = (): Map<string, FillOutcome> => {
            const { fills, gaps } = useActiveFillsStore.getState();
            const map = new Map<string, FillOutcome>();
            for (const fill of Object.values(fills)) {
                map.set(fill.rgid, fill.outcome ?? (fill.settled ? 'gaveUp' : 'running'));
            }
            for (const gap of Object.values(gaps)) {
                map.set(gap.groupId, gap.outcome ?? (gap.settled ? 'gaveUp' : 'running'));
            }
            return map;
        };

        seen.current = snapshot();

        return useActiveFillsStore.subscribe((state) => {
            const previous = seen.current ?? new Map();
            const rows = [
                ...Object.values(state.fills).map((f) => ({ ...f, key: f.rgid })),
                ...Object.values(state.gaps).map((g) => ({ ...g, key: g.groupId })),
            ];
            const next = new Map<string, FillOutcome>();

            for (const row of rows) {
                const outcome = row.outcome ?? (row.settled ? 'gaveUp' : 'running');
                next.set(row.key, outcome);
                if (previous.get(row.key) === outcome) continue;

                const name = row.album || row.artist;
                if (!name) continue;
                // B-026: a stalled gap placement and an album fill lb-bot reports
                // `needs_match` both settle as `outcome === 'failed'` (see
                // `outcomeFor` / `applyGapSummary` in `use-lbbot.ts`) but the files
                // are already sitting in lb-bot, waiting to be filed — not lost.
                // `announcementKindFor` is the one place that tells the two apart.
                const stalledPlacement =
                    'stalledPlacement' in row ? row.stalledPlacement === true : false;
                const kind = announcementKindFor({ outcome, stalledPlacement, state: row.state });

                if (kind === 'done') {
                    toast.success({ message: `${name} is in your library.` });
                    void lbBot?.notify('Download finished', `${name} is in your library.`);
                } else if (kind === 'needsSorting') {
                    // The files downloaded but need a human in lb-bot's own workspace
                    // (a rename/move it can't do on its own) — this is not a failure,
                    // and must not read like one or send the user hunting for a retry
                    // that would only refetch what's already on disk.
                    const groupId = 'groupId' in row ? row.groupId : undefined;
                    const link =
                        groupId && webUrlRef.current
                            ? `${webUrlRef.current}/#/gaps/${encodeURIComponent(groupId)}`
                            : '';
                    const body = `Downloaded ${name} — needs sorting out in lb-bot.`;
                    // Mantine's `message` is plain text, so the link (when we have
                    // one) is appended as text rather than a real anchor; the main
                    // process `notify` IPC only takes {title, body} (see
                    // `lbbot-notify` in `src/main/features/core/lbbot/index.ts`) and
                    // cannot carry a link at all — clicking it only refocuses the
                    // window, same as any other lb-bot notification.
                    toast.info({ message: link ? `${body} ${link}` : body });
                    void lbBot?.notify('Needs sorting out', body);
                } else if (kind === 'couldntGet') {
                    toast.error({
                        // lb-bot's own sentence names the cause — "103 peers offered
                        // 2,047 files, but none in FLAC…" — and is far more use than
                        // any wording of ours.
                        message: row.reason
                            ? `Couldn't get ${name}: ${row.reason}`
                            : `Couldn't get ${name}.`,
                    });
                    void lbBot?.notify("Download didn't work", `Couldn't get ${name}.`);
                }
            }

            seen.current = next;
        });
    }, []);
};
