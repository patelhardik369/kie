/**
 * URL building. Pure module — extracted from client.ts specifically so it can be
 * tested, after the bug below shipped once.
 */

/**
 * Joins a base (which carries a path prefix like `/api/v1`) with an endpoint path.
 *
 * WHY NOT `new URL(path, base)`: a leading-slash path is ABSOLUTE, so
 * `new URL('/chat/credit', 'https://api.kie.ai/api/v1')` yields
 * `https://api.kie.ai/chat/credit` — silently dropping `/api/v1` and producing a
 * 404 that looks like a missing resource rather than a malformed request.
 */
export function joinUrl(
  base: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  const url = new URL(`${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`)

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  return url.toString()
}
