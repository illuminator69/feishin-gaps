import type { StationBinding } from '/@/renderer/features/player/station/station-logic';
import type { StationMode } from '/@/renderer/features/player/station/station-logic';

/**
 * What the queue chip says, from the station store and never from settings (I-040): the radio
 * or Your mix the queue belongs to, as the hub named it, with its character and, when Navidrome
 * rather than AudioMuse answered, "via Navidrome"; "Auto DJ" while upstream's Auto DJ is what
 * continues the queue; nothing for a queue no generator touches.
 */
export interface QueueSourceChip {
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
        return args.autoplay ? { label: args.labels.autoDj } : null;
    }
    if (!args.bound) return null;
    const parts = [args.stationName(args.bound), args.characterLabel(args.bound.character)];
    if (args.bound.engine === 'tier1') parts.push(args.labels.viaNavidrome);
    return { label: parts.join(' · ') };
};
