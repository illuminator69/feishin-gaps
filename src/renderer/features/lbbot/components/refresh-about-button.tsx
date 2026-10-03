import { useState } from 'react';

import { useLbBotAvailable } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Text } from '/@/shared/components/text/text';

interface RefreshAboutButtonProps {
    /** Resolves to the sentence to show and whether lb-bot answered. */
    onRefresh: () => Promise<{ message: string; ok: boolean }>;
}

/**
 * I-020: re-fetch the lb-bot "About" for this page, bypassing the caches that
 * otherwise hold it for 30 days. Hidden whenever lb-bot is, like the rest of the
 * layer. Reports what is known: refreshed, the same, or why it could not; a failure
 * leaves what was on screen untouched.
 */
export const RefreshAboutButton = ({ onRefresh }: RefreshAboutButtonProps) => {
    const available = useLbBotAvailable();
    const [state, setState] = useState<'idle' | 'pending'>('idle');
    const [message, setMessage] = useState('');
    if (!available) return null;

    return (
        <Group gap="xs">
            <Button
                disabled={state === 'pending'}
                loading={state === 'pending'}
                onClick={async () => {
                    setState('pending');
                    setMessage('');
                    const outcome = await onRefresh();
                    setMessage(outcome.message);
                    setState('idle');
                }}
                size="compact-sm"
                variant="subtle"
            >
                Refresh About
            </Button>
            {message && (
                <Text isMuted size="xs">
                    {message}
                </Text>
            )}
        </Group>
    );
};
