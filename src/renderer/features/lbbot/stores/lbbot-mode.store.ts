import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { useSettingsStore } from '/@/renderer/store/settings.store';
import { LbDownloads, LbMode, modeFromFrame, rememberMode } from '/@/shared/utils/lbbot-mode';

/**
 * Worbus P1: lb-bot's downloads mode for this connection, and the last known one per hub.
 *
 * `session` is what this connection has learned (null until the first `welcome`, and again
 * after the hub is switched); until then the mode is the one remembered for the configured hub
 * URL, so a server known to be "off" does not flash its download buttons at every start. The
 * rules themselves are pure (`lbbot-mode.ts`). Its own storage key: nothing else migrates.
 */
interface LbBotModeState {
    actions: {
        /**
         * Adopt a mode worked out by the pure rules: a welcome's (`stateAfterWelcome`) or a
         * refusal's (`stateAfterRefusal`, via `applyLbBotRefusal`).
         */
        adopt: (mode: LbMode) => void;
        /** An `lb` frame or a `/lb/status` read: only a valid `downloads` moves the mode. */
        applyFrame: (frame: unknown) => void;
        /** The hub was switched off or pointed elsewhere: back to the remembered mode. */
        forgetSession: () => void;
    };
    /** The last `on` / `off` each hub said, keyed by its configured URL (at most four). */
    byHub: Record<string, LbDownloads>;
    /** `byHub`'s keys, oldest first. */
    order: string[];
    session: LbMode | null;
}

const hubUrl = (): string => useSettingsStore.getState().hub?.url ?? '';

export const useLbBotModeStore = create<LbBotModeState>()(
    persist(
        (set, get) => {
            const setMode = (mode: LbMode) => {
                const { byHub, order } = get();
                const remembered = rememberMode(byHub, order, hubUrl(), mode);
                set({ byHub: remembered.map, order: remembered.order, session: mode });
            };
            return {
                actions: {
                    adopt: setMode,
                    applyFrame: (frame) => setMode(modeFromFrame(getLbBotMode(), frame)),
                    forgetSession: () => set({ session: null }),
                },
                byHub: {},
                order: [],
                session: null,
            };
        },
        {
            name: 'store_lbbot_mode',
            partialize: (state) => ({ byHub: state.byHub, order: state.order }),
            version: 1,
        },
    ),
);

const modeOf = (state: LbBotModeState, url: string): LbMode =>
    state.session ?? state.byHub[url] ?? 'unknown';

/** The mode now, outside React. */
export const getLbBotMode = (): LbMode => modeOf(useLbBotModeStore.getState(), hubUrl());

/** The mode, re-rendering when it (or the configured hub) changes. */
export const useLbBotModeValue = (): LbMode => {
    const url = useSettingsStore((state) => state.hub?.url ?? '');
    return useLbBotModeStore((state) => modeOf(state, url));
};

export const lbBotModeActions = () => useLbBotModeStore.getState().actions;
