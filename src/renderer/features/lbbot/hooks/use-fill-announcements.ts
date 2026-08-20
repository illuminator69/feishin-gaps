import isElectron from 'is-electron';
import { useEffect, useRef } from 'react';

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
                if (outcome === 'done') {
                    toast.success({ message: `${name} is in your library.` });
                    void lbBot?.notify('Download finished', `${name} is in your library.`);
                } else if (outcome === 'failed') {
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
