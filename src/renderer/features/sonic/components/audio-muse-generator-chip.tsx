import {
    AUDIOMUSE_PALETTE,
    describeGenerator,
    GeneratorSource,
} from '/@/renderer/features/sonic/audio-muse-palette';
import { useMoodCentroid } from '/@/renderer/store/mood-centroid.store';
import { useSettingsStore } from '/@/renderer/store';
import { Badge } from '/@/shared/components/badge/badge';

/**
 * Scoped indicator naming the active autoplay "generator" (Auto DJ / Sonic
 * Fingerprint / Mood Flow) in the AudioMuse logo palette. Mood Flow morphs to the
 * live mood centroid. Shows only while Auto DJ is enabled; nothing otherwise.
 */
export const AudioMuseGeneratorChip = () => {
    const enabled = useSettingsStore((state) => state.autoDJ.enabled);
    const source = useSettingsStore((state) => state.autoDJ.autoplaySource) as GeneratorSource;
    const centroid = useMoodCentroid();

    if (!enabled) return null;

    const { color, label } = describeGenerator(source, centroid);

    return (
        <Badge
            style={{ backgroundColor: color, color: AUDIOMUSE_PALETTE.navy, flexShrink: 0 }}
            variant="filled"
        >
            {label}
        </Badge>
    );
};
