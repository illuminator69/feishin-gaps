import isElectron from 'is-electron';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsSection } from '/@/renderer/features/settings/components/settings-section';
import { useAudioMuseSettings, useSettingsStoreActions } from '/@/renderer/store';
import { TextInput } from '/@/shared/components/text-input/text-input';

/**
 * navi-connect: the direct route to AudioMuse-AI's core API, for a setup with no hub (Q-096:
 * it used to sit in the autoplay popover). Through the hub, which holds AudioMuse's address and
 * token itself, both stay blank. Radio and autoplay never use this route: they are the hub's
 * stations (I-040). What still does is CLAP mood search and the mixes played without them.
 */
export const AudioMuseSettings = memo(() => {
    const { t } = useTranslation();
    const audioMuse = useAudioMuseSettings();
    const { setSettings } = useSettingsStoreActions();
    const isHidden = !isElectron();

    return (
        <SettingsSection
            options={[
                {
                    control: (
                        <TextInput
                            defaultValue={audioMuse.url}
                            onBlur={(e) => {
                                const url = e.currentTarget.value.trim();
                                if (url !== audioMuse.url) setSettings({ audioMuse: { url } });
                            }}
                            placeholder="http://localhost:8000"
                        />
                    ),
                    description: t('naviConnect.audioMuse.url_description'),
                    isHidden,
                    title: t('naviConnect.audioMuse.url'),
                },
                {
                    control: (
                        <TextInput
                            defaultValue={audioMuse.token}
                            onBlur={(e) => {
                                const token = e.currentTarget.value.trim();
                                if (token !== audioMuse.token) {
                                    setSettings({ audioMuse: { token } });
                                }
                            }}
                        />
                    ),
                    description: t('naviConnect.audioMuse.token_description'),
                    isHidden,
                    title: t('naviConnect.audioMuse.token'),
                },
            ]}
            title="AudioMuse-AI"
        />
    );
});
