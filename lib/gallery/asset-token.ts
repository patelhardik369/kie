import 'server-only'

import crypto from 'node:crypto'

import { getEnv } from '../env.ts'

/**
 * Capability tokens for the files of a generation marked private.
 *
 * `/api/assets` serves by path, and a path is guessable — dated folder, family,
 * model slug, generation id. Hiding a generation from every listing still left
 * its bytes one pasted URL away, which is the difference between "not on screen"
 * and "not reachable". A private asset now needs `?k=`, and the pages allowed to
 * show it mint that server-side.
 *
 * **Stable, with no expiry.** A signed URL that goes stale would break a video
 * mid-scrub and a tab left open overnight, and re-minting it needs the page to
 * re-render anyway. What this defends against is a path someone typed or shared,
 * not a token they hold — those are the same thing for any capability URL.
 *
 * The signing key is derived from `KIE_API_KEY` rather than being one more thing
 * to configure. It is a one-way derivation: a token cannot be walked back to the
 * key, and rotating the key simply re-mints every link on the next render.
 */

/** 128 bits, base64url. Long enough that guessing is not a strategy. */
const TOKEN_BYTES = 16

const KEY_CONTEXT = 'kie-studio/asset-token/v1'

let cachedKey: Buffer | undefined

function signingKey(): Buffer {
  cachedKey ??= crypto
    .createHash('sha256')
    .update(KEY_CONTEXT)
    .update(getEnv().kieApiKey)
    .digest()
  return cachedKey
}

export function assetToken(localPath: string): string {
  return crypto
    .createHmac('sha256', signingKey())
    .update(localPath)
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
  localPath: string,
  token: string | null | undefined,
): boolean {
  if (!token) return false
  const expected = Buffer.from(assetToken(localPath))
  const actual = Buffer.from(token)
  if (expected.length !== actual.length) return false
  return crypto.timingSafeEqual(expected, actual)
}

/** The token only when one is needed, so ordinary URLs stay clean. */
export function assetTokenFor(localPath: string, nsfw: boolean): string | undefined {
  return nsfw ? assetToken(localPath) : undefined
}
