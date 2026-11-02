import type {
    HubAuthState,
    HubSignInResult,
    HubUser,
    SignInFailure,
    SignInPair,
} from '/@/shared/utils/hub-signin';

/**
 * Worbus P2: this device's credential for the Worbus Server (design §6.2, §6.5).
 *
 * The hub issues a device secret at `POST /hub/signin` in exchange for the current Navidrome
 * server's `u`/`s`/`t`. The secret lives here, in main, only:
 *   - encrypted with `safeStorage` into electron-store (`hubAuth.secret`, hex ciphertext);
 *   - or, where the OS offers no encryption (R7), in memory only, with a marker that a silent
 *     sign-in is owed after a restart.
 * Nothing that leaves main carries it: the IPC answers are `HubSignInResult` / `HubAuthState`,
 * whose types have no slot for it.
 *
 * Pure apart from what `HubAuthDeps` hands in, and import-free except for types, so
 * `auth.harness.ts` runs it under `node --test` with a fake hub, store and vault. `index.ts`
 * wires it to Electron.
 */

/** electron-store key: the secret's ciphertext (hex). Never written in plain. */
export const SECRET_KEY = 'hubAuth.secret';
/**
 * electron-store key: this device signed in and has not been signed out by its user. While set,
 * the shared token is not used as a fallback: a device the server signed out says so instead of
 * quietly becoming the primary user through the token.
 */
export const SIGNED_IN_KEY = 'hubAuth.signedIn';

/** The hub gives Navidrome 8 s for its check; past this it is not answering. */
export const SIGNIN_TIMEOUT_MS = 15_000;
const SIGNOUT_TIMEOUT_MS = 5_000;

export interface HubAuthDeps {
    /** What the sign-in names this device: the stored hub id and how it shows in pickers. */
    device: () => { id: string; kind: string; name: string; platform: string };
    fetch: (
        url: string,
        init: {
            body?: string;
            headers: Record<string, string>;
            method: string;
            signal?: AbortSignal;
        },
    ) => Promise<{ status: number; text: () => Promise<string> }>;
    /** `http(s)://host:port` of the Worbus Server, or null when no address is set. */
    httpBase: () => null | string;
    /** The typed token (older servers). Empty when none. */
    legacyToken: () => string;
    log: { info: (message: string) => void; warn: (message: string) => void };
    /** R4: the id the hub answered with becomes this device's hub id. */
    setDeviceId: (id: string) => void;
    store: {
        delete: (key: string) => void;
        get: (key: string) => unknown;
        set: (key: string, value: unknown) => void;
    };
    vault: {
        available: () => boolean;
        decrypt: (hex: string) => string;
        encrypt: (text: string) => string;
    };
}

/** `ws://host:4790/connect` → `http://host:4790`. Null for an empty address. */
export const httpBaseOf = (wsUrl: string): null | string => {
    const url = wsUrl.trim();
    if (!url) return null;
    return url
        .replace(/^ws/i, 'http')
        .replace(/\/+$/, '')
        .replace(/\/connect$/, '');
};

const parseUser = (raw: unknown): HubUser | null => {
    if (typeof raw !== 'object' || raw === null) return null;
    const { admin, name, primary } = raw as Record<string, unknown>;
    if (typeof name !== 'string' || typeof admin !== 'boolean' || typeof primary !== 'boolean') {
        return null;
    }
    return { admin, name, primary };
};

const REFUSALS: Record<string, { code: string; kind: SignInFailure }> = {
    400: { code: 'bad_request', kind: 'badRequest' },
    401: { code: 'navidrome_refused', kind: 'navidromeRefused' },
    429: { code: 'too_many_attempts', kind: 'tooManyAttempts' },
    503: { code: 'navidrome_unreachable', kind: 'navidromeUnreachable' },
};

/**
 * One answer of `/hub/signin`, by R6: a refusal is its code; 404, 405, and anything that is not
 * this route's JSON (an HTML page, a 200 without a secret) is an older server.
 */
export const classifySignIn = (
    status: number,
    body: string,
): { result: HubSignInResult; secret?: string } => {
    let parsed: unknown = null;
    try {
        parsed = JSON.parse(body);
    } catch {
        parsed = null;
    }
    const obj =
        typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    if (status === 200) {
        const user = parseUser(obj.user);
        const { deviceId, deviceSecret } = obj;
        if (
            typeof deviceId === 'string' &&
            deviceId &&
            typeof deviceSecret === 'string' &&
            deviceSecret &&
            user
        ) {
            return { result: { deviceId, kind: 'signedIn', user }, secret: deviceSecret };
        }
        return { result: { kind: 'oldServer' } };
    }
    const refusal = REFUSALS[status];
    if (refusal && obj.code === refusal.code) return { result: { kind: refusal.kind } };
    return { result: { kind: 'oldServer' } };
};

/** What may cross to the renderer: an allow-listed copy, so no field can ride along. */
export const publicResult = (result: HubSignInResult): HubSignInResult =>
    result.kind === 'signedIn'
        ? {
              deviceId: result.deviceId,
              kind: 'signedIn',
              user: {
                  admin: result.user.admin,
                  name: result.user.name,
                  primary: result.user.primary,
              },
          }
        : { kind: result.kind };

export interface HubAuth {
    /** The secret, else (never signed in, or signed out by the user) the typed token; else null. */
    bearer: () => null | string;
    /** What a `hello` carries: the secret, or the legacy token. */
    helloCredential: () => { auth: { deviceSecret: string } } | { token: string };
    /** Read the stored secret (start-up). */
    load: () => void;
    /** The hub refused the secret (close 4005 / `signed_out`): forget it; a sign-in is owed. */
    signedOutByServer: () => void;
    signIn: (pair: SignInPair) => Promise<HubSignInResult>;
    /** `POST /hub/signout`, best effort, then forget the secret for good. */
    signOut: () => Promise<void>;
    state: () => HubAuthState;
}

export const createHubAuth = (deps: HubAuthDeps): HubAuth => {
    let secret: null | string = null;

    const memoryOnly = () => !deps.vault.available();
    const marked = () => deps.store.get(SIGNED_IN_KEY) === true;

    const keep = (value: string) => {
        secret = value;
        deps.store.set(SIGNED_IN_KEY, true);
        if (memoryOnly()) {
            // R7: nothing is written in plain anywhere; a restart owes a silent sign-in.
            deps.store.delete(SECRET_KEY);
            return;
        }
        deps.store.set(SECRET_KEY, deps.vault.encrypt(value));
    };

    const drop = (final: boolean) => {
        secret = null;
        deps.store.delete(SECRET_KEY);
        if (final) deps.store.delete(SIGNED_IN_KEY);
    };

    return {
        bearer: () => secret ?? (marked() ? null : deps.legacyToken() || null),

        helloCredential: () =>
            secret
                ? { auth: { deviceSecret: secret } }
                : { token: marked() ? '' : deps.legacyToken() },

        load: () => {
            secret = null;
            const stored = deps.store.get(SECRET_KEY);
            if (typeof stored !== 'string' || !stored) return;
            if (memoryOnly()) {
                deps.store.delete(SECRET_KEY);
                return;
            }
            try {
                const value = deps.vault.decrypt(stored);
                if (value) secret = value;
            } catch (error) {
                // A keyring that changed, or a profile copied to another machine. The marker
                // stays, so one silent sign-in replaces it.
                deps.log.warn(
                    `[hub] the stored device credential could not be read (${String(error)}) - a sign-in is owed`,
                );
                deps.store.delete(SECRET_KEY);
            }
        },

        signedOutByServer: () => {
            if (secret) deps.log.warn('[hub] the Worbus Server signed this device out');
            drop(false);
        },

        signIn: async (pair) => {
            const base = deps.httpBase();
            if (!base) return { kind: 'noServer' };
            const device = deps.device();
            let status: number;
            let body: string;
            try {
                const res = await deps.fetch(`${base}/hub/signin`, {
                    body: JSON.stringify({
                        deviceId: device.id,
                        kind: device.kind,
                        name: device.name,
                        platform: device.platform,
                        salt: pair.salt,
                        token: pair.token,
                        username: pair.username,
                    }),
                    headers: { 'Content-Type': 'application/json' },
                    method: 'POST',
                    signal: AbortSignal.timeout(SIGNIN_TIMEOUT_MS),
                });
                status = res.status;
                body = await res.text();
            } catch (error) {
                // Refused, timed out or dropped: unreachable, never an older server (R6).
                const cause = (error as { cause?: { code?: string } }).cause;
                deps.log.warn(
                    `[hub] sign-in: no answer from the Worbus Server (${(error as Error).name}` +
                        `${cause?.code ? ` ${cause.code}` : ''})`,
                );
                return { kind: 'unreachable' };
            }
            const { result, secret: issued } = classifySignIn(status, body);
            if (result.kind === 'signedIn' && issued) {
                keep(issued);
                deps.setDeviceId(result.deviceId);
                deps.log.info(
                    `[hub] signed in as ${result.user.name} (admin=${result.user.admin}, ` +
                        `primary=${result.user.primary}); device credential length ${issued.length}` +
                        `${memoryOnly() ? ', kept in memory only (no OS encryption)' : ''}`,
                );
            } else {
                deps.log.warn(`[hub] sign-in answered ${status}: ${result.kind}`);
                // An older server does not do sign-in: a secret from another one is no use there.
                if (result.kind === 'oldServer') drop(true);
            }
            return publicResult(result);
        },

        signOut: async () => {
            const held = secret;
            const base = deps.httpBase();
            drop(true);
            if (!held || !base) return;
            try {
                const res = await deps.fetch(`${base}/hub/signout`, {
                    headers: { Authorization: `Bearer ${held}` },
                    method: 'POST',
                    signal: AbortSignal.timeout(SIGNOUT_TIMEOUT_MS),
                });
                deps.log.info(`[hub] signed out of the Worbus Server (${res.status})`);
            } catch (error) {
                deps.log.warn(
                    `[hub] sign-out did not reach the Worbus Server (${(error as Error).name}); forgotten here`,
                );
            }
        },

        state: () => ({
            memoryOnly: memoryOnly(),
            needsSignIn: !secret && marked(),
            signedIn: Boolean(secret),
        }),
    };
};
