/**
 * B-049: a log-safe track id out of a stream URL. Stream URLs carry the account's
 * credentials in the query string (u/t/s or api_key), so this NEVER falls back to the
 * URL: no parseable URL or no `id` param yields the placeholder '?'.
 */
export function logSafeStreamId(url: null | string | undefined): string {
    if (!url) return '?';
    try {
        const id = new URL(url).searchParams.get('id');
        if (id) return id;
    } catch {
        /* not a parseable URL */
    }
    return '?';
}
