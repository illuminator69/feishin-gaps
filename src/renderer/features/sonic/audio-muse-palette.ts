// AudioMuse-AI logo palette — the scoped "generator" indicator reuses these so
// AudioMuse-driven playback is recognizable without an always-on bar tint.
export const AUDIOMUSE_PALETTE = {
    navy: '#2E4057',
    orange: '#F5A661',
    periwinkle: '#93A2E8',
    pink: '#EE7B90',
} as const;

// Hue (degrees) from a 2D mood centroid (atan2 of the 2 components), or undefined
// when there's no usable centroid. Mirrors Navic's AdaptiveMoodBackground mapping.
export const centroidHue = (centroid: null | number[] | undefined): number | undefined => {
    if (!centroid || centroid.length < 2) return undefined;
    const [x, y] = centroid;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

export type GeneratorSource = 'autoDj' | 'fingerprint' | 'moodFlow';

// Label + accent for the active generator. Mood Flow morphs to the live mood
// centroid hue when available; otherwise each generator keeps a fixed brand color.
export const describeGenerator = (
    source: GeneratorSource,
    centroid: null | number[] | undefined,
): { color: string; label: string } => {
    switch (source) {
        case 'fingerprint':
            return { color: AUDIOMUSE_PALETTE.orange, label: 'Sonic Fingerprint' };
        case 'moodFlow': {
            const hue = centroidHue(centroid);
            return {
                color: hue === undefined ? AUDIOMUSE_PALETTE.pink : `hsl(${hue}, 55%, 68%)`,
                label: 'Mood Flow',
            };
        }
        default:
            return { color: AUDIOMUSE_PALETTE.periwinkle, label: 'Auto DJ' };
    }
};
