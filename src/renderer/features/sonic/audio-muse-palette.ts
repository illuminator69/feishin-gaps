import type { StationBinding } from '/@/renderer/features/player/station/station-logic';
import type { StationMode } from '/@/renderer/features/player/station/station-logic';

// AudioMuse-AI logo palette: the queue's "what built this" indicator reuses these so
// AudioMuse-driven playback is recognizable without an always-on bar tint.
export const AUDIOMUSE_PALETTE = {
    navy: '#2E4057',
    orange: '#F5A661',
    periwinkle: '#93A2E8',
    pink: '#EE7B90',
} as const;

/**
 * What the queue chip says, from the station store and never from settings (I-040): the radio
 * or Your mix the queue belongs to, as the hub named it, with its character and, when Navidrome
 * rather than AudioMuse answered, "via Navidrome"; "Auto DJ" while upstream's Auto DJ is what
 * continues the queue; nothing for a queue no generator touches.
 */
export interface QueueSourceChip {
    color: string;
    /** The station has nothing left that fits: autoplay stopped there. */
    exhausted: boolean;
    label: string;
}

export const describeQueueSource = (args: {
    autoplay: boolean;
    bound: null | StationBinding;
    characterLabel: (id: StationBinding['character']) => string;
    labels: { autoDj: string; viaNavidrome: string };
    mode: StationMode;
    stationName: (bound: StationBinding) => string;
}): null | QueueSourceChip => {
    if (args.mode === 'fallback') {
        return args.autoplay
            ? { color: AUDIOMUSE_PALETTE.periwinkle, exhausted: false, label: args.labels.autoDj }
            : null;
    }
    if (!args.bound) return null;
    const parts = [args.stationName(args.bound), args.characterLabel(args.bound.character)];
    if (args.bound.engine === 'tier1') parts.push(args.labels.viaNavidrome);
    return {
        color: args.bound.engine === 'tier1' ? AUDIOMUSE_PALETTE.orange : AUDIOMUSE_PALETTE.pink,
        exhausted: args.bound.exhausted,
        label: parts.join(' · '),
    };
};
