import isElectron from 'is-electron';
import { useTranslation } from 'react-i18next';

import { AdvancedTab } from '/@/renderer/features/settings/components/advanced/advanced-tab';
import { AppearanceTab } from '/@/renderer/features/settings/components/appearance/appearance-tab';
import { GeneralTab } from '/@/renderer/features/settings/components/general/general-tab';
import { HotkeysTab } from '/@/renderer/features/settings/components/hotkeys/hotkeys-tab';
import { PlaybackTab } from '/@/renderer/features/settings/components/playback/playback-tab';
import { ServerTab } from '/@/renderer/features/settings/components/server/server-tab';
import { tabFor } from '/@/renderer/features/settings/components/settings-tabs';
import { WindowTab } from '/@/renderer/features/settings/components/window/window-tab';
import { LibraryContainer } from '/@/renderer/features/shared/components/library-container';
import { useSettingsStore, useSettingsStoreActions } from '/@/renderer/store/settings.store';
import { ScrollArea } from '/@/shared/components/scroll-area/scroll-area';
import { Tabs } from '/@/shared/components/tabs/tabs';

export const SettingsContent = () => {
    const { t } = useTranslation();
    const storedTab = useSettingsStore((state) => state.tab);
    const { setSettings } = useSettingsStoreActions();
    const desktop = isElectron();
    // The stored value is left as it is (no migration); it is only read through tabFor.
    const currentTab = tabFor(storedTab, desktop);

    return (
        <LibraryContainer>
            <ScrollArea>
                <Tabs
                    keepMounted={false}
                    onChange={(e) => e && setSettings({ tab: e })}
                    orientation="horizontal"
                    value={currentTab}
                    variant="default"
                >
                    <Tabs.List>
                        {desktop && (
                            <Tabs.Tab value="server">{t('page.setting.serverTab')}</Tabs.Tab>
                        )}
                        <Tabs.Tab value="playback">{t('page.setting.playbackTab')}</Tabs.Tab>
                        <Tabs.Tab value="appearance">{t('page.setting.appearanceTab')}</Tabs.Tab>
                        <Tabs.Tab value="general">{t('page.setting.generalTab')}</Tabs.Tab>
                        <Tabs.Tab value="hotkeys">{t('page.setting.hotkeysTab')}</Tabs.Tab>
                        {desktop && (
                            <Tabs.Tab value="desktop">{t('page.setting.desktopTab')}</Tabs.Tab>
                        )}
                        <Tabs.Tab value="advanced">{t('page.setting.advanced')}</Tabs.Tab>
                    </Tabs.List>
                    {desktop && (
                        <Tabs.Panel value="server">
                            <ServerTab />
                        </Tabs.Panel>
                    )}
                    <Tabs.Panel value="playback">
                        <PlaybackTab />
                    </Tabs.Panel>
                    <Tabs.Panel value="appearance">
                        <AppearanceTab />
                    </Tabs.Panel>
                    <Tabs.Panel value="general">
                        <GeneralTab />
                    </Tabs.Panel>
                    <Tabs.Panel value="hotkeys">
                        <HotkeysTab />
                    </Tabs.Panel>
                    {desktop && (
                        <Tabs.Panel value="desktop">
                            <WindowTab />
                        </Tabs.Panel>
                    )}
                    <Tabs.Panel value="advanced">
                        <AdvancedTab />
                    </Tabs.Panel>
                </Tabs>
            </ScrollArea>
        </LibraryContainer>
    );
};
