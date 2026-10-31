import { memo } from 'react';
import { Fragment } from 'react/jsx-runtime';

import { ExportImportSettings } from '/@/renderer/features/settings/components/advanced/export-import-settings';
import { LoggerSettings } from '/@/renderer/features/settings/components/advanced/logger-settings';
import { ResetSettings } from '/@/renderer/features/settings/components/advanced/reset-settings';
import { CacheSettings } from '/@/renderer/features/settings/components/window/cache-settngs';
import { Divider } from '/@/shared/components/divider/divider';
import { Stack } from '/@/shared/components/stack/stack';

// No Update and no Analytics section: this build has no update feed of its own and sends no usage
// data anywhere. Reset to default is last so it is not one click from the others.
const sections = [
    { component: ExportImportSettings, key: 'export-import' },
    { component: LoggerSettings, key: 'logger' },
    { component: CacheSettings, key: 'cache' },
    { component: ResetSettings, key: 'reset' },
];

export const AdvancedTab = memo(() => {
    return (
        <Stack gap="md">
            {sections.map(({ component: Section, key }, index) => (
                <Fragment key={key}>
                    <Section />
                    {index < sections.length - 1 && <Divider />}
                </Fragment>
            ))}
        </Stack>
    );
});
