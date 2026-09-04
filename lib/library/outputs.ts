import 'server-only'

import fs from 'node:fs/promises'

import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { assets, generations, getDb, inputAssets } from '../db/index.ts'
import { getEnv } from '../env.ts'
import { promptOf } from '../gallery/display.ts'
import { resolveWithin } from '../jobs/paths.ts'
import { storeUpload } from '../jobs/uploads.ts'
import { URL_UPLOAD_MAX_BYTES } from '../kie/upload.ts'

/**
 * Feeding a generation's output back in as the next one's input.
 *
 * The loop this closes: make an image, then animate it, then upscale that. Until
 * now every hop meant opening the output folder, finding the file, and uploading
 * it by hand — and doing it again tomorrow, because Kie's upload URLs expire in
 * a day.
 *
 * The bytes never leave the machine twice. An output is already on local disk
 * (rule 2 in .claude/CLAUDE.md), so reuse hands that exact path to `storeUpload`
 * as `existingPath`: no second copy, and the content hash means the same output
 * reused across ten generations is uploaded once, not ten times.
 *
 * Kie's own `assets.remote_url` is deliberately NOT the answer here, except as
 * the last resort below. It dies after about fourteen days, and a `input_json`
 * holding a URL that has since expired makes the generation unreproducible —
 * the one thing `input_json` exists to guarantee.
 */

/** Kie deletes generated media about fourteen days after the task completes. */
const RESULT_URL_TTL_MS = 14 * 24 * 60 * 60 * 1000

/** Re-upload slightly before expiry, so a URL cannot die between here and submit. */
const EXPIRY_MARGIN_MS = 5 * 60_000

export type OutputKind = 'image' | 'video' | 'audio'

export interface ReusableOutput {
  assetId: string
  generationId: string
  modelSlug: string
  kind: OutputKind
  localPath: string
  mime: string | null
  bytes: number | null
  width: number | null
  height: number | null
  durationMs: number | null
  /** The prompt that made it, for a caption you can recognize it by. */
  prompt: string | null
  createdAt: number
  /** Marked private — the picker hides these unless asked. */
  nsfw: boolean
  /**
   * A Kie upload URL for these exact bytes that is still live, if one exists.
   *
   * Present means picking this costs no round trip at all. Absent means one
   * upload, then a day of free reuse.
   */
  fileUrl: string | null
}

export interface ListOutputsOptions {
  /** Restrict to the kinds a parameter accepts. Empty or absent means all. */
  kinds?: readonly OutputKind[]
  limit?: number
  /** Include generations marked private. Off by default, as everywhere else. */
  includePrivate?: boolean
  /** Matched against the stored input_json and the model slug. */
  search?: string
}

/**
 * Recent outputs, newest first, ready to be picked as an input.
 *
 * The join to `input_assets` is on `local_path`, not on a hash: reuse stores the
 * output's own path, so the row for "this file, already uploaded" is findable
 * without reading a single byte. Hashing 40 videos to render a dropdown would
 * be the wrong trade by three orders of magnitude.
 */
export async function listReusableOutputs(
  options: ListOutputsOptions = {},
): Promise<ReusableOutput[]> {
  const { kinds, limit = 60, includePrivate = false, search } = options
  const now = Date.now()

  const clauses: SQL[] = []
  if (kinds && kinds.length > 0) clauses.push(inArray(assets.kind, [...kinds]))
  if (!includePrivate) clauses.push(eq(generations.nsfw, false))

  if (search?.trim()) {
    const term = `%${search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const match = or(
      sql`${generations.inputJson} LIKE ${term} ESCAPE '\\'`,
      sql`${generations.modelSlug} LIKE ${term} ESCAPE '\\'`,
    )
    if (match) clauses.push(match)
  }

  const rows = await getDb()
    .select({
      asset: assets,
      generation: {
        id: generations.id,
        modelSlug: generations.modelSlug,
        inputJson: generations.inputJson,
        nsfw: generations.nsfw,
        createdAt: generations.createdAt,
      },
      cachedUrl: inputAssets.kieFileUrl,
      cachedExpiresAt: inputAssets.expiresAt,
    })
    .from(assets)
    .innerJoin(generations, eq(assets.generationId, generations.id))
    .leftJoin(inputAssets, eq(inputAssets.localPath, assets.localPath))
    .where(clauses.length > 0 ? and(...clauses) : undefined)
    .orderBy(desc(assets.downloadedAt), desc(assets.idx))
    .limit(limit)

  return rows.map((row) => ({
    assetId: row.asset.id,
    generationId: row.generation.id,
    modelSlug: row.generation.modelSlug,
    kind: row.asset.kind,
    localPath: row.asset.localPath,
    mime: row.asset.mime,
    bytes: row.asset.bytes,
    width: row.asset.width,
    height: row.asset.height,
    durationMs: row.asset.durationMs,
    prompt: promptOf(safeParse(row.generation.inputJson)) ?? null,
    createdAt: row.generation.createdAt,
    nsfw: row.generation.nsfw,
    fileUrl:
      row.cachedUrl && row.cachedExpiresAt && row.cachedExpiresAt - EXPIRY_MARGIN_MS > now
        ? row.cachedUrl
        : null,
  }))
}

export type ResolveOutcome =
  | {
      ok: true
      fileUrl: string
      kind: string
      /** No upload was spent — a live URL for these bytes already existed. */
      reused: boolean
      expiresAt: number | null
      /** `upload` is the normal path; `result-url` is the oversized fallback. */
      source: 'upload' | 'result-url'
      /** Said out loud when the fallback was taken. */
      warning?: string
    }
  | { ok: false; status: 404 | 410 | 413; message: string }

/**
 * Turns one downloaded output into a URL a model can fetch.
 *
 * The order of attempts, and why:
 *
 *   1. **A live upload for the same path.** Costs nothing, and is the common
 *      case once you have used a reference image twice.
 *   2. **Upload the local file.** The normal path. `storeUpload` dedupes on the
 *      content hash and caches the URL for a day.
 *   3. **Kie's own result URL**, and only when the file is past Kie's 100 MB
 *      upload ceiling. It is a worse answer — it expires in about fourteen days
 *      and takes the re-runnability of `input_json` with it — so it is the
 *      fallback, it is never chosen silently, and it is not offered at all once
 *      the fourteen days are up.
 */
export async function resolveOutputAsInput(assetId: string): Promise<ResolveOutcome> {
  const db = getDb()

  const [row] = await db
    .select({ asset: assets, modelSlug: generations.modelSlug })
    .from(assets)
    .innerJoin(generations, eq(assets.generationId, generations.id))
    .where(eq(assets.id, assetId))
    .limit(1)

  if (!row) return { ok: false, status: 404, message: 'No such output.' }
  const { asset } = row

  // 1. Already uploaded, still live.
  const [cached] = await db
    .select()
    .from(inputAssets)
    .where(eq(inputAssets.localPath, asset.localPath))
    .limit(1)

  if (
    cached?.kieFileUrl &&
    cached.expiresAt &&
    cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()
  ) {
    return {
      ok: true,
      fileUrl: cached.kieFileUrl,
      kind: cached.kind,
      reused: true,
      expiresAt: cached.expiresAt,
      source: 'upload',
    }
  }

  // The same guard the asset-serving route uses: `local_path` is data, and data
  // that escapes the output folder is not read.
  const absolute = resolveWithin(getEnv().outputDir, asset.localPath)
  if (!absolute) {
    return { ok: false, status: 410, message: 'That output has an unusable path on disk.' }
  }

  let content: Uint8Array
  try {
    content = await fs.readFile(absolute)
  } catch {
    return {
      ok: false,
      status: 410,
      message:
        'The local file for that output is gone, so it cannot be uploaded. ' +
        'Its generation may have been deleted.',
    }
  }

  // 3. Oversized — checked before the upload, because Kie would reject it after
  //    spending the whole transfer.
  if (content.byteLength > URL_UPLOAD_MAX_BYTES) {
    const fresh = Date.now() - asset.downloadedAt < RESULT_URL_TTL_MS
    if (!fresh) {
      return {
        ok: false,
        status: 413,
        message:
          `That output is ${mb(content.byteLength)} MB, past Kie's ${mb(URL_UPLOAD_MAX_BYTES)} MB ` +
          'upload ceiling, and its original result URL has expired. Shrink it before reusing it.',
      }
    }
    return {
      ok: true,
      fileUrl: asset.remoteUrl,
      kind: asset.kind,
      reused: true,
      expiresAt: asset.downloadedAt + RESULT_URL_TTL_MS,
      source: 'result-url',
      warning:
        `That output is ${mb(content.byteLength)} MB, past Kie's ${mb(URL_UPLOAD_MAX_BYTES)} MB ` +
        'upload ceiling, so its original Kie result URL was used instead. That URL dies about ' +
        'fourteen days after the generation, and a re-run after that will fail.',
    }
  }

  // 2. The normal path.
  const stored = await storeUpload({
    content,
    filename: basename(asset.localPath),
    mime: asset.mime ?? undefined,
    // Named for where it came from, so the asset library reads as a history
    // rather than a list of hashes.
    label: `${row.modelSlug} · ${asset.generationId.slice(0, 8)}`,
    existingPath: asset.localPath,
  })

  return {
    ok: true,
    fileUrl: stored.fileUrl,
    kind: stored.kind,
    reused: stored.reused,
    expiresAt: stored.expiresAt,
    source: 'upload',
  }
}

function basename(localPath: string): string {
  return localPath.slice(localPath.lastIndexOf('/') + 1)
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}
