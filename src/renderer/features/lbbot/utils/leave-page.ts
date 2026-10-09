/**
 * Leaving a page that no longer exists, from a surface that may be gone.
 *
 * An apply, a remove or a merge outlives the dialog that started it: when it ends,
 * the album or artist page the user was on can be dead (a retag changes Navidrome's
 * id) and the dialog may have been closed. Calling `navigate` from the dialog's
 * `useNavigate` then relies on an unmounted component's closure. The app runs under
 * a `HashRouter` (`app-router.tsx`), whose location IS `location.hash`, so assigning
 * the hash needs no component and no router instance: the router hears the change
 * and renders the route. The deciders (`decideLeave`, `decideMergeLeave`) stay pure
 * and pick the path; this only goes there.
 */

/** The route the HashRouter is showing, from `location.hash` ('#/a/b?x#y' -> '/a/b'). */
export const pathnameFromHash = (hash: string): string => hash.replace(/^#/, '').split(/[?#]/)[0];

/** The hash that makes a HashRouter show `path`. */
export const hashForPath = (path: string): string => `#${path.startsWith('/') ? path : `/${path}`}`;

/** The route being shown right now. */
export const currentRoutePath = (): string => pathnameFromHash(window.location.hash);

/** Show `path` in place of the current entry (no extra history step), no component needed. */
export const leaveTo = (path: string): void => {
    window.location.replace(hashForPath(path));
};
