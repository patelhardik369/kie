import 'server-only'

import crypto from 'node:crypto'

import { getEnv } from '../env.ts'

/**
 * Capability tokens for stored objects.
 *
 * `/api/assets` takes an object key and hands back a signed URL. A key is
 * guessable — a workspace id, a date, a family, a model slug, a generation id —
 * so something has to prove the caller was allowed to know it.
 *
 * It cannot be the `X-Studio-Workspace` header. An `<img src>` and a `<video
 * src>` send no custom headers, and those are the only two ways an asset is ever
 * actually fetched. Any scheme that depends on a header would work in `fetch`
 * and fail in the markup that matters.
 *
 * So the proof travels in the URL. Every asset link carries `?k=`, an HMAC of
 * its own key, minted only by a page or route that has already checked the
 * caller owns the row. Two consequences worth being explicit about:
 *
 *   - **Every asset needs one now, not only private ones.** The local build
 *     tokenised marked generations alone, because on `localhost` the only reader
 *     was the person sitting there. On a public URL the same reasoning makes
 *     everything guessable, so everything is signed.
 *   - **Stable, with no expiry.** A signed URL that goes stale would break a
 *     video mid-scrub and a tab left open overnight. What this defends against
 *     is a key someone typed or enumerated, not a link they were given — those
 *     are the same thing for any capability URL. The Supabase URL it redirects
 *     to *does* expire in an hour, so a shared link stops working on its own
 *     soon enough.
 *
 * The signing key is derived from `APP_ENCRYPTION_KEY`. It used to come from
 * `KIE_API_KEY`, which stopped making sense the moment each browser brought its
 * own: the same file would have minted a different token per visitor. Rotating
 * the encryption key re-mints every link on the next render.
 */

/** 128 bits, base64url. Long enough that guessing is not a strategy. */
const TOKEN_BYTES = 16

const KEY_CONTEXT = 'kie-studio/asset-token/v2'

let cachedKey: Buffer | undefined

function signingKey(): Buffer {
  cachedKey ??= crypto
    .createHash('sha256')
    .update(KEY_CONTEXT)
    .update(getEnv().encryptionKey)
    .digest()
  return cachedKey
}

export function assetToken(storagePath: string): string {
  return crypto
    .createHmac('sha256', signingKey())
    .update(storagePath)
    .digest('base64url')
    .slice(0, Math.ceil((TOKEN_BYTES * 8) / 6))
}

/**
 * Constant-time comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, so lengths are checked first —
 * a truncated `?k=` must be a rejection, not a 500.
 */
export function assetTokenMatches(
  storagePath: string,
  token: string | null | undefined,
): boolean {
  if (!token) return false
  const expected = Buffer.from(assetToken(storagePath))
  const actual = Buffer.from(token)
  if (expected.length !== actual.length) return false
  return crypto.timingSafeEqual(expected, actual)
}

/**
 * The full URL for one stored object, token included.
 *
 * The single place an asset URL is built server-side. Callers that have already
 * scoped their query to a workspace can hand a row straight to this.
 */
export function assetUrl(storagePath: string | null | undefined): string | null {
  if (!storagePath) return null
  const encoded = storagePath.split('/').map(encodeURIComponent).join('/')
  return `/api/assets/${encoded}?k=${assetToken(storagePath)}`
}
