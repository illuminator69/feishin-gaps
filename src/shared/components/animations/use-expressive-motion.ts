import { useSyncExternalStore } from 'react';

/**
 * Reads the "Expressive motion" gate from the `data-motion` attribute the renderer stamps
 * on the document root (see use-app-theme.ts). Kept store-free so the shared overlay
 * components can use it without importing the renderer settings store (they're also shared
 * with the remote mini-app). Reactive: re-renders when the attribute flips.
 */
const subscribe = (onChange: () => void) => {
    const observer = new MutationObserver(onChange);
    observer.observe(document.documentElement, {
        attributeFilter: ['data-motion'],
        attributes: true,
    });
    return () => observer.disconnect();
};

const getSnapshot = () => document.documentElement.getAttribute('data-motion') === 'true';

export const useExpressiveMotion = (): boolean =>
    useSyncExternalStore(subscribe, getSnapshot, () => false);
