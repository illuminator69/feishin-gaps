import isElectron from 'is-electron';

import { useAuthStore, useHubStore } from '/@/renderer/store';
import { logger } from '/@/renderer/utils/logger';
import {
    createSilentSignIn,
    HubSignInResult,
    parseSubsonicPair,
    SignInPair,
} from '/@/shared/utils/hub-signin';

/**
 * Worbus P2: signing this device in to the Worbus Server (design §6.5). The pair is the current
 * Navidrome server's stored `u`/`s`/`t`; main posts it and keeps the secret. Everything the UI
 * shows about it is in `hub.store` (`signingIn`, `signInResult`, `signedOut`).
 */

const hub = isElectron() ? window.api.hub : null;

/** The current Navidrome server's sign-in pair, or null (no server, or not a token credential). */
export const currentServerPair = (): null | SignInPair =>
    parseSubsonicPair(useAuthStore.getState().currentServer?.credential);

/** The current server's account name, for "Sign in as <name>". */
export const currentServerUsername = (): null | string => currentServerPair()?.username ?? null;

const post = async (pair: SignInPair): Promise<HubSignInResult> => {
    if (!hub) return { kind: 'noServer' };
    useHubStore.getState().actions.setStore({ signingIn: true });
    try {
        return await hub.signIn(pair);
    } catch (error) {
        logger.warn('[hub] sign-in call failed', { error: String(error) });
        return { kind: 'unreachable' };
    }
};

const apply = (result: HubSignInResult | null, silent: boolean): void => {
    const { setStore } = useHubStore.getState().actions;
    if (result === null) {
        setStore({ signedOut: true, signingIn: false });
        return;
    }
    logger.info(`[hub] sign-in${silent ? ' (silent)' : ''}: ${result.kind}`);
    if (result.kind === 'signedIn' || result.kind === 'oldServer') {
        setStore({ signedOut: false, signingIn: false, signInResult: result });
        return;
    }
    // A failed silent sign-in leaves the device signed out; a failed tap leaves it as it was.
    setStore(
        silent
            ? { signedOut: true, signingIn: false, signInResult: result }
            : { signingIn: false, signInResult: result },
    );
};

/** The Server tab's "Sign in as <name>". */
export const signInWithCurrentServer = async (): Promise<HubSignInResult> => {
    const pair = currentServerPair();
    const result: HubSignInResult = pair ? await post(pair) : { kind: 'noAccount' };
    apply(result, false);
    return result;
};

/**
 * The one silent sign-in after the server signed this device out (close 4005), or at start when a
 * memory-only secret was lost to a restart (R7). `welcome()` re-arms it.
 */
export const silentSignIn = createSilentSignIn({
    currentPair: currentServerPair,
    onOutcome: (result) => apply(result, true),
    signIn: post,
});
