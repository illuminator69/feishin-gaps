/**
 * Small pure normalisations of lb-bot/hub wire values, shared by the main
 * process client and the renderer's status and index-mirror hooks.
 *
 * Q-010 leftover 6: these were three independent copies — the main client's
 * `lbBotWebUrl`, the renderer's `routeAdvertised` and `adoptLbBotWelcome`'s
 * inline webUrl check, and `index-mirror.ts`'s own `feedAdvertised` — asking
 * the same two questions ("does the hub advertise this route", "is this a
 * webUrl worth keeping") slightly differently. `src/shared/` is reachable
 * from both processes (`/@/shared/*`), so one copy of each now is.
 */

/**
 * Whether a hub's advertised route list includes `route`.
 *
 * An **empty** list is an older hub that doesn't advertise at all: assume
 * supported rather than hiding a feature that probably works. Used both for
 * a single lb-bot route (`useHubSupports`) and for the index change feed
 * (`feedAdvertised`).
 */
export const routeAdvertised = (routes: string[] | undefined, route: string): boolean =>
    !routes || routes.length === 0 || routes.includes(route);

/**
 * lb-bot's own web UI, kept only if it is something a browser should open —
 * http(s) only, with no trailing slash. `""` means don't show a link.
 */
export const normalizeLbBotWebUrl = (value: unknown): string =>
    typeof value === 'string' && /^https?:\/\//.test(value) ? value.replace(/\/+$/, '') : '';
