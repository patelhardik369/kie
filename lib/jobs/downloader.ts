import 'server-only'

import { assets, getDb, type Generation } from '../db/index.ts'
import { getEnv } from '../env.ts'
import { inferAssetKind, type LayerData, type ParsedResult } from '../kie/result.ts'
import { putObject, StorageError } from '../storage/objects.ts'
import { mimeForExtension, kindForMime } from './mime.ts'
import { extensionFromUrl, outputObjectKey } from './paths.ts'
import { mergeProbes, probeBuffer } from './probe.ts'

/**
 * Result URLs to bytes in the bucket.
 *
 * **The single most important operation in this codebase.** Kie deletes
 * generated media after 14 days, so a generation is not `complete` until its
 * bytes are ours. A store failure blocks completion (`needs_retry`) rather than
 * being logged and forgotten — see docs/API-CONTRACT.md §6.
 *
 * What changed in moving off the local disk:
 *
 *   - **The bytes go through memory, not a temp file.** There is no writable
 *     filesystem worth using on a serverless host, and the `.part`-then-rename
 *     trick that guarded against truncation has no equivalent in an object
 *     store. Its job is done instead by holding the whole response in memory,
 *     verifying the length against `content-length`, and only then uploading —
 *     a truncated transfer never becomes an object at all. Which is stricter
 *     than the rename was.
 *   - **A per-object ceiling now exists.** Supabase Free refuses anything over
 *     50 MB. An output past it is recorded as `too_large` with its Kie URL kept,
 *     rather than failing the generation: the run was paid for, the file is real
 *     for another fortnight, and the honest thing is to say so and let it be
 *     downloaded, not to pretend it never happened.
 */

/** Generous: a 1080p video off a cold CDN edge is not fast. */
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000

/** Per-URL retry delays. A CDN 5xx right after `success` is common. */
const RETRY_DELAYS_MS = [2_000, 5_000, 12_000]

/** How much of each end to read when probing dimensions and duration. */
const PROBE_WINDOW_BYTES = 256 * 1024

export class DownloadError extends Error {
  readonly url: string
  readonly attempts: number

  constructor(url: string, attempts: number, cause?: unknown) {
    super(`Failed to download ${url} after ${attempts} attempt(s).`, { cause })
    this.name = 'DownloadError'
    this.url = url
    this.attempts = attempts
  }
}

export interface DownloadedAsset {
  id: string
  index: number
  /** Null when the object was too large to store. */
  storagePath: string | null
  storageState: 'stored' | 'too_large'
  remoteUrl: string
  kind: 'image' | 'video' | 'audio'
  mime: string
  bytes: number
  width?: number
  height?: number
  durationMs?: number
  /** Said out loud when an output could not be stored. */
  warning?: string
}

/**
 * Fetches every URL of a finished generation and records an `assets` row for
 * each. Resolves only when all of them are accounted for; throws otherwise,
 * leaving the caller to mark the generation `needs_retry`.
 */
export async function downloadGenerationAssets(
  generation: Pick<Generation, 'id' | 'family' | 'modelSlug' | 'workspaceId'>,
  result: ParsedResult,
): Promise<DownloadedAsset[]> {
  const layersByUrl = new Map((result.layers ?? []).map((l) => [l.url, l]))
  const downloaded: DownloadedAsset[] = []

  // Sequential, not parallel: several 1080p videos at once would hold all of
  // them in one function's memory at the same time, and ordering keeps `idx`
  // meaningful.
  for (const [index, url] of result.urls.entries()) {
    downloaded.push(
      await storeOne({ generation, url, index, layer: layersByUrl.get(url) }),
    )
  }

  return downloaded
}

interface StoreOneParams {
  generation: Pick<Generation, 'id' | 'family' | 'modelSlug' | 'workspaceId'>
  url: string
  index: number
  layer?: LayerData
}

async function storeOne(params: StoreOneParams): Promise<DownloadedAsset> {
  const { generation, url, index, layer } = params

  const kind = inferAssetKind(url)
  const key = outputObjectKey({
    workspaceId: generation.workspaceId,
    generationId: generation.id,
    family: generation.family,
    modelSlug: generation.modelSlug,
    index,
    url,
    kind,
  })

  const { body, contentType } = await fetchToMemory(url)

  const ext = extensionFromUrl(url) ?? EXT_BY_KIND[kind]
  const mime = normalizeMime(contentType) ?? mimeForExtension(ext)
  const probed = probeBytes(body)

  let storagePath: string | null = key
  let storageState: 'stored' | 'too_large' = 'stored'
  let warning: string | undefined

  if (body.byteLength > getEnv().maxFileBytes) {
    // Not a failure. The generation ran and was billed; refusing to record it
    // would lose the parameters that produced it as well as the file.
    storagePath = null
    storageState = 'too_large'
    warning =
      `${mbs(body.byteLength)} MB is past the ${mbs(getEnv().maxFileBytes)} MB per-object ` +
      'ceiling on this Supabase plan, so it was not stored. Download it from the ' +
      'gallery within about fourteen days — after that Kie deletes it and it is gone.'
  } else {
    try {
      await putObject(key, body, mime)
    } catch (error) {
      // A StorageError here is a real failure of the durability rule, so it
      // propagates and parks the generation in needs_retry.
      throw error instanceof StorageError ? error : new DownloadError(url, 1, error)
    }
  }

  const asset: DownloadedAsset = {
    // Deterministic, so a retried store after a partial failure updates the row
    // rather than inserting a duplicate.
    id: `${generation.id}-${index}`,
    index,
    storagePath,
    storageState,
    remoteUrl: url,
    kind: kindForMime(mime) ?? kind,
    mime,
    bytes: body.byteLength,
    ...probed,
    warning,
  }

  const row = {
    workspaceId: generation.workspaceId,
    kind: asset.kind,
    storagePath: asset.storagePath,
    storageState: asset.storageState,
    remoteUrl: asset.remoteUrl,
    mime: asset.mime,
    bytes: asset.bytes,
    width: asset.width ?? null,
    height: asset.height ?? null,
    durationMs: asset.durationMs ?? null,
    downloadedAt: Date.now(),
  }

  await getDb()
    .insert(assets)
    .values({
      id: asset.id,
      generationId: generation.id,
      idx: index,
      layerMeta: layer ? JSON.stringify(layer) : null,
      ...row,
    })
    .onConflictDoUpdate({ target: assets.id, set: row })

  return asset
}

const EXT_BY_KIND = { image: 'png', video: 'mp4', audio: 'mp3' } as const

function normalizeMime(contentType: string | null): string | undefined {
  if (!contentType) return undefined
  const bare = contentType.split(';')[0]!.trim().toLowerCase()
  // CDNs love these two for everything; the extension knows better.
  if (!bare || bare === 'application/octet-stream' || bare === 'binary/octet-stream') {
    return undefined
  }
  return bare
}

/**
 * Fetches one URL fully into memory, retrying with backoff.
 *
 * Buffering rather than streaming through to Supabase is a deliberate trade. It
 * costs memory proportional to the file — bounded, because anything over the
 * per-object ceiling is not stored anyway — and buys three things a stream does
 * not give: the length can be verified before a single byte is committed, the
 * probe can read the tail (where an MP4 written without faststart keeps the
 * `moov` atom, and with it the duration), and a failed transfer leaves no
 * partial object behind.
 */
async function fetchToMemory(
  url: string,
): Promise<{ body: Uint8Array; contentType: string | null }> {
  let lastError: unknown

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]!)

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        cache: 'no-store',
      })

      if (!response.ok) {
        // 403/404 here usually means the 14-day result URL already expired.
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
      }

      const body = new Uint8Array(await response.arrayBuffer())
      if (body.byteLength === 0) throw new Error('The download was empty.')

      // A stream cut short mid-transfer resolves cleanly; the length check is
      // the only thing that catches it.
      const expected = Number(response.headers.get('content-length'))
      if (Number.isFinite(expected) && expected > 0 && body.byteLength !== expected) {
        throw new Error(`Truncated: got ${body.byteLength} bytes, expected ${expected}.`)
      }

      return { body, contentType: response.headers.get('content-type') }
    } catch (error) {
      lastError = error
    }
  }

  throw new DownloadError(url, RETRY_DELAYS_MS.length + 1, lastError)
}

/**
 * Reads dimensions and duration off the bytes in hand.
 *
 * Both ends are read for the same reason the file version opened two windows:
 * an MP4 written without faststart keeps its `moov` atom at the tail, and that
 * is where the duration lives.
 */
function probeBytes(body: Uint8Array) {
  try {
    if (body.byteLength <= PROBE_WINDOW_BYTES * 2) return probeBuffer(body)

    const head = body.subarray(0, PROBE_WINDOW_BYTES)
    const tail = body.subarray(body.byteLength - PROBE_WINDOW_BYTES)
    return mergeProbes(probeBuffer(head), probeBuffer(tail))
  } catch {
    return {}
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function mbs(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0)
}
