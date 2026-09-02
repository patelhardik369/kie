import 'server-only'

import { kieRequest } from './client.ts'

/**
 * Account-level endpoints: credit balance and download links.
 */

/**
 * Remaining credits.
 *
 * `data` is a BARE NUMBER, not an object — `{ "code": 200, "data": 100 }`.
 *
 * Per-generation cost is more useful than this total and comes from
 * `recordInfo`'s `creditsConsumed`; persist that on the generation row.
 */
export async function getCredits(signal?: AbortSignal): Promise<number> {
  const data = await kieRequest<number>('/chat/credit', { signal })
  return typeof data === 'number' ? data : Number(data)
}

/** Links minted by `getDownloadUrl` are valid for 20 minutes. */
export const DOWNLOAD_URL_TTL_MS = 20 * 60 * 1000

/**
 * Mints a fresh, directly-downloadable link for a file Kie already produced.
 *
 * `data` is a BARE STRING. Only accepts kie.ai-generated URLs — anything else
 * returns 422.
 *
 * Use when a stored result URL is inside its 14-day window but will not fetch
 * directly. This does NOT extend retention and is not a substitute for
 * downloading outputs to disk.
 */
export async function getDownloadUrl(
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  return kieRequest<string>('/common/download-url', {
    method: 'POST',
    body: { url },
    signal,
  })
}
