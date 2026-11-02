import type { HubUser } from '../../../../shared/utils/hub-signin.ts';

/**
 * Worbus P2 (design §6.5): which hub and lb-bot surfaces a signed-in user sees, and what a change
 * of Navidrome account does to this device's hub sign-in. Pure (type imports only) so
 * `hub-roles.harness.ts` runs it.
 *
 * `hub.store.user` (`welcome.user`, replaced by each `user` frame) is the only role source for
 * these surfaces; Navidrome's own `isAdmin` in the auth store keeps gating only what it gated
 * before. lb-bot's own table stays the authority: these gates only hide what lb-bot would refuse.
 */

export interface HubRoles {
    admin: boolean;
    primary: boolean;
}

/** No `user` at all: an older hub, which sends none. Today's behaviour: everything shown. */
export const TODAY_ROLES: HubRoles = { admin: true, primary: true };

export const rolesOf = (user: HubUser | null | undefined): HubRoles =>
    user ? { admin: user.admin, primary: user.primary } : TODAY_ROLES;

/**
 * Each gated surface and the flag it needs. A non-admin keeps browse, the wishlist and Scan now
 * (P1's table); the listening history and everything built from it is the primary user's (the
 * hub sends `HUB_ND_USER`'s credentials for the fingerprint).
 */
export const ROLE_GATES = {
    /** Fix album match (the context menu, the gap box's album controls, the album dialog). */
    albumMatch: 'admin',
    /** Fix MusicBrainz match on an artist (the scan's "match manually", the MBID dialog). */
    artistMatch: 'admin',
    /** Getting albums: acquire, the fill buttons (retry, cancel, MP3), Activity. */
    downloads: 'admin',
    /** The fingerprint mix kind and the direct AudioMuse fingerprint. */
    fingerprint: 'primary',
    libraryMatches: 'admin',
    /** My Listening / Statistics. */
    listening: 'primary',
    /** Merge into one name. */
    merge: 'admin',
    needsAttention: 'admin',
    /** The hub's seedless station. */
    yourMix: 'primary',
} as const satisfies Record<string, keyof HubRoles>;

export type RoleGate = keyof typeof ROLE_GATES;

export const allows = (roles: HubRoles, gate: RoleGate): boolean => roles[ROLE_GATES[gate]];

/**
 * lb-bot (or the hub) refused an action for a role the client still believed it had - a demotion
 * the `user` frame has not brought yet. Lower the flag now, so the action hides in place instead
 * of being offered again; the next `user` frame or welcome restates the real flags. No user (an
 * older hub): nothing to lower, lb-bot's refusal holds the line.
 */
export const userAfterRefusal = (
    user: HubUser | null,
    code: string | undefined,
): HubUser | null => {
    if (!user) return user;
    if (code === 'admin_only' && user.admin) return { ...user, admin: false };
    if (code === 'primary_only' && user.primary) return { ...user, primary: false };
    return user;
};

/** What a change of the current Navidrome server means for the hub sign-in. */
export type AccountChange = 'logout' | 'none' | 'switch';

export const accountChange = (
    previousId: null | string | undefined,
    nextId: null | string | undefined,
): AccountChange => {
    if ((previousId ?? null) === (nextId ?? null)) return 'none';
    return nextId ? 'switch' : 'logout';
};

export interface AccountFollowDeps {
    clearMirror: () => void;
    clearSavedQueues: () => void;
    /** Connect is on and an address is set: a sign-in has somewhere to go. */
    hubOn: () => boolean;
    signIn: () => Promise<unknown>;
    /** Sign out of the hub and leave the transport down. */
    signOut: () => Promise<void>;
}

/**
 * A Navidrome logout signs the device out of the Worbus Server (the owner's 2026-11-02 answer)
 * and drops what the old account left here: the lb-bot mirror and the saved-queue cache, which
 * the next welcome would otherwise push up into the new account's space. A switch then signs in
 * again with the new server's account; its refusal (`navidrome_refused`) is what the Server tab
 * shows.
 */
export const followAccount = async (
    change: AccountChange,
    deps: AccountFollowDeps,
): Promise<void> => {
    if (change === 'none') return;
    await deps.signOut();
    deps.clearMirror();
    deps.clearSavedQueues();
    if (change === 'switch' && deps.hubOn()) await deps.signIn();
};
