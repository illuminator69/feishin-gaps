import { memo } from 'react';
import { Fragment } from 'react/jsx-runtime';

import { AudioMuseSettings } from '/@/renderer/features/settings/components/server/audiomuse-settings';
import { RemoteSettings } from '/@/renderer/features/settings/components/server/remote-settings';
import {
    CastingSettings,
    WorbusServerSettings,
} from '/@/renderer/features/settings/components/server/worbus-server-settings';
import { Accordion } from '/@/shared/components/accordion/accordion';
import { Divider } from '/@/shared/components/divider/divider';
import { Stack } from '/@/shared/components/stack/stack';

// Closed: someone with a Worbus Server never needs these (the server holds AudioMuse itself), and
// opening with them would suggest everyone does.
const WithoutServerSettings = memo(() => (
    <Accordion variant="separated">
        <Accordion.Item value="without-server">
            <Accordion.Control>Without a Worbus Server</Accordion.Control>
            <Accordion.Panel>
                <AudioMuseSettings />
            </Accordion.Panel>
        </Accordion.Item>
    </Accordion>
));

/** The tab a new user is sent to: the connection first, then the pieces that depend on it. */
export const ServerTab = memo(() => {
    const sections = [
        { element: <WorbusServerSettings />, key: 'worbus-server' },
        { element: <CastingSettings />, key: 'casting' },
        { element: <WithoutServerSettings />, key: 'without-server' },
        { element: <RemoteSettings />, key: 'browser-remote' },
    ];

    return (
        <Stack gap="md">
            {sections.map(({ element, key }, index) => (
                <Fragment key={key}>
                    {element}
                    {index < sections.length - 1 && <Divider />}
                </Fragment>
            ))}
        </Stack>
    );
});
