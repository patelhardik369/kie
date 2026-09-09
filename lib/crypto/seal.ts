import 'server-only'

import crypto from 'node:crypto'

import { getEnv } from '../env.ts'

/**
 * Authenticated encryption for the one secret this server has to hold on
 * someone else's behalf: their Kie API key.
 *
 * The key belongs to the browser. It is kept there, in localStorage, and sent
 * with each request. But a generation outlives the request that created it —
 * Kie takes up to twenty minutes on a video, and the tab that started it may be
 * closed long before then. Something has to be able to poll and download without
 * a browser present, and that something needs the key.
 *
 * So the key is sealed with `APP_ENCRYPTION_KEY` and parked on the generation
 * row for exactly as long as the job runs, then wiped when it reaches a terminal
 * state (see lib/jobs/engine.ts). What that buys and what it costs:
 *
 *   - A database dump alone does not yield anyone's key; the sealing key lives
 *     in the environment, not in Postgres.
 *   - Someone holding BOTH the database and the environment can unseal the keys
 *     of jobs that are currently in flight. That is the honest limit of this
 *     design, and the reason the ciphertext is deleted the moment it stops being
 *     needed rather than kept "in case".
 *
 * AES-256-GCM: the tag is what stops a truncated or tampered ciphertext from
 * decrypting into a plausible-looking wrong key.
 */

const ALGORITHM = 'aes-256-gcm'
/** 96 bits — the size GCM is specified for; anything else costs a rehash. */
const IV_BYTES = 12
const TAG_BYTES = 16

/** Bumped if the format ever changes, so old ciphertexts stay readable. */
const VERSION = 'v1'

/**
 * Seals a UTF-8 string into `v1.<iv>.<tag>.<ciphertext>`, all base64url.
 *
 * The `aad` binds the ciphertext to a context — the generation id — so a sealed
 * key lifted from one row cannot be pasted into another and unsealed there.
 */
export function seal(plaintext: string, aad?: string): string {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, getEnv().encryptionKey, iv)
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'))

  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [VERSION, b64(iv), b64(tag), b64(body)].join('.')
}

/**
 * Reverses `seal`, or returns null.
 *
 * Null rather than throwing, for every failure alike: a rotated
 * `APP_ENCRYPTION_KEY`, a tampered row, a truncated value, an `aad` mismatch.
 * The caller's response to all of them is the same — treat the job as having no
 * usable key and ask the browser for one — and distinguishing them here would
 * only give an attacker a decryption oracle.
 */
export function unseal(sealed: string | null | undefined, aad?: string): string | null {
  if (!sealed) return null

  const parts = sealed.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) return null

  try {
    const iv = unb64(parts[1]!)
    const tag = unb64(parts[2]!)
    const body = unb64(parts[3]!)
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null

    const decipher = crypto.createDecipheriv(ALGORITHM, getEnv().encryptionKey, iv)
    decipher.setAuthTag(tag)
    if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'))

    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

/**
 * A stable, non-reversible label for a key.
 *
 * Lets two requests be recognised as carrying the same key — for the "this key
 * differs from the one that started the job" check — without the comparison
 * needing either key in the clear, and without a fingerprint that could be
 * walked back to the key itself.
 */
export function fingerprint(secret: string): string {
  return crypto
    .createHmac('sha256', getEnv().encryptionKey)
    .update(`fingerprint/v1:${secret}`)
    .digest('base64url')
    .slice(0, 16)
}

function b64(buffer: Buffer): string {
  return buffer.toString('base64url')
}

function unb64(value: string): Buffer {
  return Buffer.from(value, 'base64url')
}
