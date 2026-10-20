import { create } from 'zustand';

import {
    type CoverSeed,
    NEUTRAL_SEED,
    type Roles,
    rolesFor,
} from '/@/renderer/themes/cover/cover-roles';

/**
 * The window wash as applied: written only by `useCoverWash` (the renderer's `ThemedApp`), so it stays
 * `on: false` in the remote SPA. Not persisted.
 */
export interface CoverWashState {
    /** The playing cover's small URL once its seed is resolved; null when nothing plays. */
    artSrc: null | string;
    light: boolean;
    on: boolean;
    roles: Roles;
    seed: CoverSeed;
}

export const useCoverWashStore = create<CoverWashState>()(() => ({
    artSrc: null,
    light: false,
    on: false,
    roles: rolesFor(NEUTRAL_SEED, false),
    seed: NEUTRAL_SEED,
}));

export const useCoverWashOn = (): boolean => useCoverWashStore((state) => state.on);
