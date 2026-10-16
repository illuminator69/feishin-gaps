import type { StationCharacterId } from '/@/shared/types/station-types';

import { useTranslation } from 'react-i18next';

import { useStationWords } from '/@/renderer/features/player/station/use-station-words';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { SegmentedControl } from '/@/shared/components/segmented-control/segmented-control';
import { Stack } from '/@/shared/components/stack/stack';
import { Text } from '/@/shared/components/text/text';

/**
 * The station half of the autoplay controls (I-040), shared by the popover and Settings: the
 * character as a three-way control in the catalogue's own words, its description, and one line
 * naming what is playing. "Nothing left that fits" is an answer from the hub, not a failure, so
 * it comes with the one thing that can change it: Explore.
 *
 * A character change keeps everything on screen: the control moves, the queue is untouched, and
 * the bound station takes the new character from its next batch.
 */
export const StationControls = ({ words }: { words: ReturnType<typeof useStationWords> }) => {
    const { t } = useTranslation();
    const description = words.characters.find((row) => row.id === words.character)?.description;

    return (
        <Stack gap="xs">
            <SegmentedControl
                data={words.characters.map((row) => ({ label: row.label, value: row.id }))}
                onChange={(value) => words.setCharacter(value as StationCharacterId)}
                value={words.character}
                w="100%"
            />
            {description && (
                <Text isMuted isNoSelect size="xs">
                    {description}
                </Text>
            )}
            {(words.line || words.status) && (
                <Group gap="xs" justify="space-between" wrap="nowrap">
                    <Stack gap={0} style={{ minWidth: 0 }}>
                        {words.line && (
                            <Text isNoSelect lineClamp={1} size="sm">
                                {words.line}
                            </Text>
                        )}
                        {words.status && (
                            <Text isMuted isNoSelect lineClamp={2} size="xs">
                                {words.status}
                            </Text>
                        )}
                    </Stack>
                    {words.canExplore && (
                        <Button
                            onClick={() => words.setCharacter('explore')}
                            size="compact-sm"
                            variant="default"
                        >
                            {t('naviConnect.station.explore')}
                        </Button>
                    )}
                </Group>
            )}
        </Stack>
    );
};
