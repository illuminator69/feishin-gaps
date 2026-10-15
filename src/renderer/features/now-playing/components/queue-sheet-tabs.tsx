import { useTranslation } from 'react-i18next';

import { ActionIcon } from '/@/shared/components/action-icon/action-icon';
import { Group } from '/@/shared/components/group/group';

export type QueueSheetTab = 'queue' | 'related';

interface QueueSheetTabsProps {
    activeTab: QueueSheetTab;
    onChange: (tab: QueueSheetTab) => void;
}

/**
 * Up Next / Related switch for the docked queue sheet surfaces (drawer / popover / sidebar),
 * drawn as the full-screen player draws its own: an icon button per tab with its name as
 * the tooltip, the active one in the primary colour. It was a pair of uppercase text
 * buttons, a control upstream's queue surfaces do not have.
 */
export const QueueSheetTabs = ({ activeTab, onChange }: QueueSheetTabsProps) => {
    const { t } = useTranslation();
    const tabs: { icon: 'queue' | 'related'; id: QueueSheetTab; label: string }[] = [
        { icon: 'queue', id: 'queue', label: t('page.fullscreenPlayer.upNext') },
        { icon: 'related', id: 'related', label: t('page.fullscreenPlayer.related') },
    ];

    return (
        <Group gap="xs" px="sm" py="xs">
            {tabs.map((tab) => (
                <ActionIcon
                    aria-pressed={activeTab === tab.id}
                    icon={tab.icon}
                    iconProps={{
                        color: activeTab === tab.id ? 'primary' : undefined,
                        size: 'lg',
                    }}
                    key={tab.id}
                    onClick={() => onChange(tab.id)}
                    tooltip={{ label: tab.label }}
                    variant="subtle"
                />
            ))}
        </Group>
    );
};
