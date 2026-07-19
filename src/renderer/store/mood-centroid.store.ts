import { createWithEqualityFn } from 'zustand/traditional';

/**
 * The 2D mood centroid returned by the last AudioMuse alchemy (Mood Flow) call,
 * used to tint the scoped generator chip. Ephemeral runtime state — not persisted;
 * resets to null on reload (the chip falls back to the brand color until the next mix).
 */
interface MoodCentroidState {
    centroid: null | number[];
    setCentroid: (centroid: null | number[]) => void;
}

export const useMoodCentroidStore = createWithEqualityFn<MoodCentroidState>()((set) => ({
    centroid: null,
    setCentroid: (centroid) => set({ centroid }),
}));

export const setMoodCentroid = (centroid: null | number[]) =>
    useMoodCentroidStore.getState().setCentroid(centroid);

export const useMoodCentroid = (): null | number[] =>
    useMoodCentroidStore((state) => state.centroid);
