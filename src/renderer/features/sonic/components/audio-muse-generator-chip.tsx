import { useTranslation } from 'react-i18next';

import { useStationWords } from '/@/renderer/features/player/station/use-station-words';
import { describeQueueSource } from '/@/renderer/features/sonic/audio-muse-palette';
import { Badge } from '/@/shared/components/badge/badge';
import { Tooltip } from '/@/shared/components/tooltip/tooltip';

/**
 * The queue's "what built this" chip (I-040): the radio or Your mix the queue belongs to, or
 * "Auto DJ" when upstream's Auto DJ continues it because the hub's station engine is not there.
 * Read from the station store, so it names what the hub answered, not what a setting asked for.
 * The app's own badge, in the theme's colours, with the source's colour as a dot.
 */
export const AudioMuseGeneratorChip = () => {
    const { t } = useTranslation();
    const words = useStationWords();

    const chip = describeQueueSource({
        autoplay: words.autoplay,
        bound: words.bound,
        characterLabel: words.characterLabel,
        labels: {
            autoDj: t('setting.autoDJ'),
            viaNavidrome: t('naviConnect.station.viaNavidrome'),
        },
        mode: words.mode,
        stationName: words.stationName,
    });

    if (!chip) return null;

    const badge = (
        <Badge
            leftSection={
                <span
                    aria-hidden
                    style={{
                        backgroundColor: chip.exhausted
                            ? 'var(--theme-colors-foreground-muted)'
                            : chip.color,
                        borderRadius: '50%',
                        display: 'inline-block',
                        height: 8,
                        width: 8,
                    }}
                />
            }
            style={{ flexShrink: 0, maxWidth: 260 }}
            variant="default"
        >
            {chip.label}
        </Badge>
    );

    // The badge stops at 260 px, so a long name ("Sunshine Bright On Me radio · Explore") is cut
    // with an ellipsis: the tooltip always carries the whole label.
    return (
        <Tooltip
            label={
                chip.exhausted
                    ? `${chip.label} - ${t('naviConnect.station.exhausted')}`
                    : chip.label
            }
            openDelay={300}
        >
            {badge}
        </Tooltip>
    );
};
