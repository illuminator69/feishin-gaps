import { describeGenerator, GeneratorSource } from '/@/renderer/features/sonic/audio-muse-palette';
import { useSettingsStore } from '/@/renderer/store';
import { useMoodCentroid } from '/@/renderer/store/mood-centroid.store';
import { Badge } from '/@/shared/components/badge/badge';

/**
 * Scoped indicator naming the active autoplay "generator" (Auto DJ / Sonic
 * Fingerprint / Mood Flow). The app's own badge, in the theme's colours, with the
 * generator's colour as a dot: the AudioMuse palette, and for Mood Flow the live mood
 * centroid's hue. It used to be a badge filled with that colour and lettered in a
 * hard-coded navy, whatever the theme. Shows only while Auto DJ is enabled.
 */
export const AudioMuseGeneratorChip = () => {
    const enabled = useSettingsStore((state) => state.autoDJ.enabled);
    const source = useSettingsStore((state) => state.autoDJ.autoplaySource) as GeneratorSource;
    const centroid = useMoodCentroid();

    if (!enabled) return null;

    const { color, label } = describeGenerator(source, centroid);

    return (
        <Badge
            leftSection={
                <span
                    aria-hidden
                    style={{
                        backgroundColor: color,
                        borderRadius: '50%',
                        display: 'inline-block',
                        height: 8,
                        width: 8,
                    }}
                />
            }
            style={{ flexShrink: 0 }}
            variant="default"
        >
            {label}
        </Badge>
    );
};
