import { useState } from 'react';

import { useLbBotAvailable } from '/@/renderer/features/lbbot/hooks/use-lbbot';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Text } from '/@/shared/components/text/text';

interface RefreshAboutButtonProps {
    /** Resolves true when lb-bot answered and the cached body was replaced. */
    onRefresh: () => Promise<boolean>;
}

/**
 * I-020: re-fetch the lb-bot "About" for this page, bypassing the caches that
 * otherwise hold it for 30 days. Hidden whenever lb-bot is, like the rest of the
 * layer; says so when it could not, and leaves what was on screen untouched.
 */
export const RefreshAboutButton = ({ onRefresh }: RefreshAboutButtonProps) => {
    const available = useLbBotAvailable();
    const [state, setState] = useState<'done' | 'failed' | 'idle' | 'pending'>('idle');
    if (!available) return null;

    return (
        <Group gap="xs">
            <Button
                disabled={state === 'pending'}
                loading={state === 'pending'}
                onClick={async () => {
                    setState('pending');
                    setState((await onRefresh()) ? 'done' : 'failed');
                }}
                size="compact-sm"
                variant="subtle"
            >
                Refresh About
            </Button>
            {state === 'done' && (
                <Text isMuted size="xs">
                    Refreshed
                </Text>
            )}
            {state === 'failed' && (
                <Text isMuted size="xs">
                    lb-bot had nothing new to give. What is shown is unchanged.
                </Text>
            )}
        </Group>
    );
};
