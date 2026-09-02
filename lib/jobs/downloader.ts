import 'server-only'

import fs from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { assets, getDb, type Generation } from '../db/index.ts'
import { getEnv } from '../env.ts'
import { inferAssetKind, type LayerData, type ParsedResult } from '../kie/result.ts'
import { mimeForExtension, kindForMime } from './mime.ts'
import { extensionFromUrl, outputRelativePath } from './paths.ts'
import { mergeProbes, probeBuffer } from './probe.ts'

/**
 * Result URLs to bytes on disk.
 *
 * **The single most important operation in this codebase.** Kie deletes
 * generated media after 14 days, so a generation is not `complete` until its
 * bytes are local. A download failure blocks completion (`needs_retry`) rather
 * than being logged and forgotten — see docs/API-CONTRACT.md §6.
 */

/** Generous: a 1080p video off a cold CDN edge is not fast. */
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000

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
  localPath: string
  remoteUrl: string
  kind: 'image' | 'video' | 'audio'
  mime: string
  bytes: number
  width?: number
  height?: number
  durationMs?: number
}

/**
 * Downloads every URL of a finished generation and records an `assets` row for
 * each. Resolves only when all of them are on disk; throws otherwise, leaving
 * the caller to mark the generation `needs_retry`.
 */
export async function downloadGenerationAssets(
  generation: Pick<Generation, 'id' | 'family' | 'modelSlug'>,
  result: ParsedResult,
): Promise<DownloadedAsset[]> {
  const outputDir = getEnv().outputDir
  const layersByUrl = new Map((result.layers ?? []).map((l) => [l.url, l]))

  const downloaded: DownloadedAsset[] = []

  // Sequential, not parallel: several 1080p videos at once saturate the link and
  // make every one of them slower, and ordering keeps `idx` meaningful.
  for (const [index, url] of result.urls.entries()) {
    downloaded.push(
      await downloadOne({
        generation,
        outputDir,
        url,
        index,
        layer: layersByUrl.get(url),
      }),
    )
  }

  return downloaded
}

interface DownloadOneParams {
  generation: Pick<Generation, 'id' | 'family' | 'modelSlug'>
  outputDir: string
  url: string
  index: number
  layer?: LayerData
}

async function downloadOne(params: DownloadOneParams): Promise<DownloadedAsset> {
  const { generation, outputDir, url, index, layer } = params

  const kind = inferAssetKind(url)
  const relativePath = outputRelativePath({
    generationId: generation.id,
    family: generation.family,
    modelSlug: generation.modelSlug,
    index,
    url,
    kind,
  })
  const absolutePath = path.join(outputDir, relativePath)

  const { bytes, contentType } = await fetchToFile(url, absolutePath)

  const ext = extensionFromUrl(url) ?? path.extname(absolutePath).slice(1)
  const mime = normalizeMime(contentType) ?? mimeForExtension(ext)
  const probed = await probeFile(absolutePath, bytes)

  const asset: DownloadedAsset = {
    // Deterministic, so re-running a download after a partial failure updates
    // the row rather than inserting a duplicate.
    id: `${generation.id}-${index}`,
    index,
    localPath: relativePath,
    remoteUrl: url,
    kind: kindForMime(mime) ?? kind,
    mime,
    bytes,
    ...probed,
  }

  await getDb()
    .insert(assets)
    .values({
      id: asset.id,
      generationId: generation.id,
      kind: asset.kind,
      localPath: asset.localPath,
      remoteUrl: asset.remoteUrl,
      mime: asset.mime,
      bytes: asset.bytes,
      width: asset.width ?? null,
      height: asset.height ?? null,
      durationMs: asset.durationMs ?? null,
      idx: index,
      layerMeta: layer ? JSON.stringify(layer) : null,
      downloadedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: assets.id,
      set: {
        localPath: asset.localPath,
        remoteUrl: asset.remoteUrl,
        mime: asset.mime,
        bytes: asset.bytes,
        width: asset.width ?? null,
        height: asset.height ?? null,
        durationMs: asset.durationMs ?? null,
        downloadedAt: Date.now(),
      },
    })

  return asset
}

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
 * Streams one URL to disk, retrying with backoff.
 *
 * Writes to a `.part` file and renames on success, so an interrupted download
 * can never leave a truncated file that looks complete to the gallery.
 */
async function fetchToFile(
  url: string,
  absolutePath: string,
): Promise<{ bytes: number; contentType: string | null }> {
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  const partPath = `${absolutePath}.part`

  let lastError: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]!)

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        cache: 'no-store',
      })

      if (!response.ok || !response.body) {
        // 403/404 here usually means the 14-day result URL already expired.
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
      }

      // fetch yields the DOM ReadableStream type; Readable.fromWeb wants the
      // node:stream/web one. Same object at runtime, two separate declarations.
      const source = response.body as Parameters<typeof Readable.fromWeb>[0]
      await pipeline(Readable.fromWeb(source), createWriteStream(partPath))

      const stat = await fs.stat(partPath)
      if (stat.size === 0) throw new Error('Downloaded file was empty.')

      // A stream cut short mid-transfer resolves cleanly; the length check is
      // the only thing that catches it.
      const expected = Number(response.headers.get('content-length'))
      if (Number.isFinite(expected) && expected > 0 && stat.size !== expected) {
        throw new Error(`Truncated: got ${stat.size} bytes, expected ${expected}.`)
      }

      await fs.rename(partPath, absolutePath)
      return { bytes: stat.size, contentType: response.headers.get('content-type') }
    } catch (error) {
      lastError = error
      await fs.rm(partPath, { force: true }).catch(() => undefined)
    }
  }

  throw new DownloadError(url, RETRY_DELAYS_MS.length + 1, lastError)
}

/**
 * Reads dimensions and duration off the finished file.
 *
 * Both ends are read: an MP4 written without faststart keeps its `moov` atom at
 * the tail, and that is where the duration lives.
 */
async function probeFile(absolutePath: string, size: number) {
  let handle
  try {
    handle = await fs.open(absolutePath, 'r')

    const headLength = Math.min(PROBE_WINDOW_BYTES, size)
    const head = new Uint8Array(headLength)
    await handle.read(head, 0, headLength, 0)

    if (size <= PROBE_WINDOW_BYTES) return probeBuffer(head)

    const tailLength = Math.min(PROBE_WINDOW_BYTES, size)
    const tail = new Uint8Array(tailLength)
    await handle.read(tail, 0, tailLength, size - tailLength)

    return mergeProbes(probeBuffer(head), probeBuffer(tail))
  } catch {
    return {}
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
