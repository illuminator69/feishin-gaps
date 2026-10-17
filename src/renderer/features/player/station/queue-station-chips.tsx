import { useTranslation } from 'react-i18next';

import styles from './queue-station-chips.module.css';

import { ChipId, chipsFor, selectedChip } from '/@/renderer/features/player/station/station-chips';
import { tapStationChip } from '/@/renderer/features/player/station/use-station-autoplay';
import { useStationWords } from '/@/renderer/features/player/station/use-station-words';
import { Button } from '/@/shared/components/button/button';
import { Text } from '/@/shared/components/text/text';

/**
 * The queue's autoplay chips (I-041), one row under the queue's header as YouTube Music has
 * them: Off, Close, Balanced, Explore with the hub's station engine, Off and Auto DJ without it.
 * The selected one is filled. A queue that belongs to a station shows that station's state,
 * which every device shares; any other queue shows this device's preference.
 *
 * A tap acts on the queue now (station-chips.ts): Off takes out what the station queued that
 * has not played and stops it, a character swaps that for a batch in the new character. The
 * playing track and the next one are never touched, so the music does not stop for it.
 *
 * The status sits on the same row, so a line coming and going never moves the queue under it.
 */
export const QueueStationChips = () => {
    const { t } = useTranslation();
    const words = useStationWords();
    const selected = selectedChip({
        autoplay: words.autoplay,
        bound: words.bound,
        mode: words.mode,
        preferred: words.preferred,
    });

    const labelOf = (chip: ChipId): string => {
        if (chip === 'off') return t('naviConnect.station.chipOff');
        if (chip === 'autoDj') return t('setting.autoDJ');
        return words.characterLabel(chip);
    };
    const descriptionOf = (chip: ChipId): string | undefined =>
        chip === 'off' || chip === 'autoDj'
            ? undefined
            : words.characters.find((row) => row.id === chip)?.description;

    return (
        <div className={styles.row} role="radiogroup">
            {chipsFor(words.mode).map((chip) => {
                const description = descriptionOf(chip);
                return (
                    <Button
                        aria-checked={selected === chip}
                        className={styles.chip}
                        key={chip}
                        onClick={() => {
                            if (selected !== chip) tapStationChip(chip);
                        }}
                        radius="xl"
                        role="radio"
                        size="compact-sm"
                        tooltip={description ? { label: description, openDelay: 500 } : undefined}
                        variant={selected === chip ? 'filled' : 'default'}
                    >
                        {labelOf(chip)}
                    </Button>
                );
            })}
            {words.status && (
                <Text className={styles.status} isMuted isNoSelect size="xs">
                    {words.status}
                </Text>
            )}
        </div>
    );
};
