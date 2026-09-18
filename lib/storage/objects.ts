import 'server-only'

import { bucket } from './client.ts'
import { getEnv } from '../env.ts'

/**
 * Reading and writing the object store.
 *
 * The one rule the rest of the app relies on: **an object key always begins with
 * the owning workspace id.** Nothing else enforces isolation in the bucket — the
 * service-role key can read every object in it — so the prefix is what makes
 * "this file belongs to that workspace" a checkable claim rather than a hope.
 * `keyBelongsTo` is that check, and every route that turns a client-supplied key
 * into bytes calls it.
 */

export class StorageError extends Error {
  readonly cause?: unknown
  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'StorageError'
    this.cause = cause
  }
}

/** Signed URLs last an hour: long enough to watch a video, short enough to expire. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60

/**
 * True when `key` is inside `workspaceId`'s prefix.
 *
 * The traversal guard, in object-store terms. `..` has no meaning to Supabase
 * Storage — keys are opaque strings, not paths — but a key that simply starts
 * with another workspace's id is the equivalent mistake, and it is one a
 * client-supplied value can make. Checked on the segment boundary so `wk_abc`
 * cannot match `wk_abcdef`.
 */
export function keyBelongsTo(key: string, workspaceId: string): boolean {
  return key.startsWith(`${workspaceId}/`) && !key.includes('..')
}

export interface PutResult {
  key: string
  bytes: number
  contentType: string
}

/**
 * Writes one object, replacing anything already at that key.
 *
 * `upsert` is on deliberately. Keys are deterministic — generation id plus
 * ordinal — so a retried download after a partial failure must land on the same
 * object rather than erroring or, worse, accumulating a second copy that counts
 * against the quota and that nothing points at.
 */
export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<PutResult> {
  const max = getEnv().maxFileBytes
  if (body.byteLength > max) {
    throw new StorageError(
      `That object is ${mb(body.byteLength)} MB, past this project's ${mb(max)} MB ` +
        'per-file ceiling. Supabase Free caps every object at 50 MB and the limit ' +
        'is not raisable on that plan.',
    )
  }

  const { error } = await bucket().upload(key, body, {
    contentType,
    upsert: true,
    // The object is served through a signed URL that expires in an hour, so a
    // longer cache lifetime than that buys nothing and risks a stale body after
    // an upsert.
    cacheControl: '3600',
  })

  if (error) throw new StorageError(`Could not store ${key}: ${error.message}`, error)
  return { key, bytes: body.byteLength, contentType }
}

/**
 * A time-limited URL the browser can PUT bytes to, straight into the bucket.
 *
 * This is the one way a file larger than a few megabytes can reach us at all.
 * A serverless function's REQUEST body is capped by the platform — 4.5 MB on
 * Vercel — and the cap is enforced by the edge, before any of our code runs, so
 * it cannot be raised, caught, or answered with a useful message: the browser
 * gets a plain-text `Request Entity Too Large` where it expected JSON. A
 * marked-up screenshot flattened to PNG passes 4.5 MB routinely, and so does
 * any photograph off a modern phone.
 *
 * So those bytes never touch a function. The browser uploads them to Supabase
 * directly, and the function that follows only reads back what is already
 * stored. The upload URL is minted against a key we chose, not one the caller
 * named, which is what keeps the workspace prefix (and therefore the isolation
 * rule at the top of this file) a server-side decision.
 *
 * `upsert` is on for the same reason `putObject` has it on: input keys are
 * content-addressed, so re-adding a file someone already has lands on the key
 * that file is already at.
 */
export async function createUploadUrl(
  key: string,
): Promise<{ uploadUrl: string; key: string }> {
  const { data, error } = await bucket().createSignedUploadUrl(key, { upsert: true })
  if (error || !data?.signedUrl) {
    throw new StorageError(
      `Could not open an upload slot for ${key}: ${error?.message ?? 'no URL returned'}`,
      error,
    )
  }
  return { uploadUrl: data.signedUrl, key }
}

/**
 * A time-limited URL the browser can fetch directly.
 *
 * Direct is the point: the bytes go from Supabase's CDN to the browser without
 * passing through a Vercel function. Proxying a 40 MB video through a serverless
 * invocation would spend the function's whole memory and duration budget to
 * deliver something the CDN already serves — with byte-range support for video
 * scrubbing, which a naive proxy loses.
 */
export async function signedUrl(
  key: string,
  ttlSeconds = SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  const { data, error } = await bucket().createSignedUrl(key, ttlSeconds)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

/**
 * Signed URLs for many keys at once.
 *
 * The gallery renders up to a few hundred tiles per page and one round trip per
 * tile would dominate the render. Returns a map so a caller can tell a key that
 * failed to sign from one it never asked about.
 */
export async function signedUrls(
  keys: string[],
  ttlSeconds = SIGNED_URL_TTL_SECONDS,
): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  if (keys.length === 0) return found

  const unique = [...new Set(keys)]
  const { data, error } = await bucket().createSignedUrls(unique, ttlSeconds)
  if (error || !data) return found

  for (const entry of data) {
    // Supabase reports per-key failures inside a successful response, so a
    // single missing object does not cost the whole page its images.
    if (entry.signedUrl && entry.path) found.set(entry.path, entry.signedUrl)
  }
  return found
}

/** Reads an object back into memory. Null when it is not there. */
export async function getObject(key: string): Promise<Uint8Array | null> {
  const { data, error } = await bucket().download(key)
  if (error || !data) return null
  return new Uint8Array(await data.arrayBuffer())
}

/**
 * Removes objects. Missing keys are not an error — the point of the call is that
 * they should not exist afterwards.
 */
export async function removeObjects(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0

  // Supabase caps a single remove call; batching keeps a bulk gallery delete
  // from silently dropping everything past the limit.
  const BATCH = 100
  let removed = 0

  for (let i = 0; i < keys.length; i += BATCH) {
    const slice = keys.slice(i, i + BATCH)
    const { data, error } = await bucket().remove(slice)
    if (error) {
      throw new StorageError(`Could not remove ${slice.length} object(s): ${error.message}`, error)
    }
    removed += data?.length ?? 0
  }
  return removed
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0)
}
