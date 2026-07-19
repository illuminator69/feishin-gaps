import { useTranslation } from 'react-i18next';

import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';

export type QueueSheetTab = 'queue' | 'related';

interface QueueSheetTabsProps {
    activeTab: QueueSheetTab;
    onChange: (tab: QueueSheetTab) => void;
}

/**
 * Up Next / Related switch for the docked queue sheet surfaces (drawer / popover / sidebar).
 * Mirrors the full-screen player's tab labels so the two Related tabs read the same.
 */
export const QueueSheetTabs = ({ activeTab, onChange }: QueueSheetTabsProps) => {
    const { t } = useTranslation();

    return (
        <Group gap="xs" grow px="sm" py="xs">
            <Button
                fw="600"
                onClick={() => onChange('queue')}
                size="sm"
                uppercase
                variant={activeTab === 'queue' ? 'subtle' : 'transparent'}
            >
                {t('page.fullscreenPlayer.upNext')}
            </Button>
            <Button
                fw="600"
                onClick={() => onChange('related')}
                size="sm"
                uppercase
                variant={activeTab === 'related' ? 'subtle' : 'transparent'}
            >
                {t('page.fullscreenPlayer.related')}
            </Button>
        </Group>
    );
};
