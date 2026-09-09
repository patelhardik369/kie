import 'server-only'

import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'

import { assets, generations, getDb, inputAssets } from '../db/index.ts'
import { promptOf } from '../gallery/display.ts'
import { storeUpload } from '../jobs/uploads.ts'
import { getObject, keyBelongsTo } from '../storage/objects.ts'
import { URL_UPLOAD_MAX_BYTES } from '../kie/upload.ts'

/**
 * Feeding a generation's output back in as the next one's input.
 *
 * The loop this closes: make an image, then animate it, then upscale that. Until
 * now every hop meant opening the output folder, finding the file, and uploading
 * it by hand — and doing it again tomorrow, because Kie's upload URLs expire in
 * a day.
 *
 * The bytes are never stored twice. An output is already in the bucket (rule 2
 * in .claude/CLAUDE.md), so reuse hands that exact object key to `storeUpload`
 * as `existingKey`: no second copy — which matters more here than it did on a
 * laptop, because storage is the binding constraint on the free plan — and the
 * content hash means the same output reused across ten generations is uploaded
 * to Kie once, not ten times.
 *
 * Kie's own `assets.remote_url` is deliberately NOT the answer here, except as
 * the last resort below. It dies after about fourteen days, and a `input_json`
 * holding a URL that has since expired makes the generation unreproducible —
 * the one thing `input_json` exists to guarantee.
 */

/** Kie deletes generated media about fourteen days after the task completes. */
const RESULT_URL_TTL_MS = 14 * 24 * 60 * 60 * 1000

/** How many outputs a picker asks for when it does not say. */
export const DEFAULT_OUTPUT_LIMIT = 60
/** The ceiling a caller can raise it to. */
export const MAX_OUTPUT_LIMIT = 200

/**
 * A `?limit=` string as a row count.
 *
 * Pure, exported and tested, because the naive version of this is a trap that
 * has already been fallen into once: `Number(searchParams.get('limit'))` on a
 * MISSING parameter is `Number(null)`, which is `0` — finite, so it survives an
 * `isFinite` guard, and `Math.max(1, 0)` then clamps the page to a single row.
 * The picker showed exactly one output and looked like a filtering bug.
 *
 * Anything that is not a usable count — absent, blank, non-numeric, zero,
 * negative — means "you did not choose", and the default applies.
 */
export function clampLimit(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === '') return DEFAULT_OUTPUT_LIMIT
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_OUTPUT_LIMIT
  return Math.min(Math.floor(parsed), MAX_OUTPUT_LIMIT)
}

/** Re-upload slightly before expiry, so a URL cannot die between here and submit. */
const EXPIRY_MARGIN_MS = 5 * 60_000

export type OutputKind = 'image' | 'video' | 'audio'

export interface ReusableOutput {
  assetId: string
  generationId: string
  modelSlug: string
  kind: OutputKind
  storagePath: string | null
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
  /** Only outputs of this workspace are ever returned. */
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
 * The join to `input_assets` is on `storage_path`, not on a hash: reuse stores
 * the output's own key, so the row for "this file, already uploaded" is findable
 * without reading a single byte. Pulling 40 videos back out of the bucket to
 * hash them for a dropdown would be the wrong trade by three orders of
 * magnitude.
 */
export async function listReusableOutputs(
  workspaceId: string,
  options: ListOutputsOptions = {},
): Promise<ReusableOutput[]> {
  const { kinds, limit = DEFAULT_OUTPUT_LIMIT, includePrivate = false, search } = options
  const now = Date.now()

  const clauses: SQL[] = [eq(assets.workspaceId, workspaceId)]
  // An output that was too large to store has no bytes to reuse and no key to
  // hand anything — listing it would offer a picker entry that cannot be picked.
  clauses.push(eq(assets.storageState, 'stored'))
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
    .leftJoin(
      inputAssets,
      and(
        eq(inputAssets.storagePath, assets.storagePath),
        eq(inputAssets.workspaceId, workspaceId),
      ),
    )
    .where(and(...clauses))
    .orderBy(desc(assets.downloadedAt), desc(assets.idx))
    .limit(limit)

  return rows.map((row) => ({
    assetId: row.asset.id,
    generationId: row.generation.id,
    modelSlug: row.generation.modelSlug,
    kind: row.asset.kind,
    storagePath: row.asset.storagePath,
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
export async function resolveOutputAsInput(
  workspaceId: string,
  assetId: string,
): Promise<ResolveOutcome> {
  const db = getDb()

  const [row] = await db
    .select({ asset: assets, modelSlug: generations.modelSlug })
    .from(assets)
    .innerJoin(generations, eq(assets.generationId, generations.id))
    .where(and(eq(assets.id, assetId), eq(assets.workspaceId, workspaceId)))
    .limit(1)

  if (!row) return { ok: false, status: 404, message: 'No such output.' }
  const { asset } = row

  // 1. Already uploaded, still live.
  const [cached] = asset.storagePath
    ? await db
        .select()
        .from(inputAssets)
        .where(
          and(
            eq(inputAssets.storagePath, asset.storagePath),
            eq(inputAssets.workspaceId, workspaceId),
          ),
        )
        .limit(1)
    : []

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

  // An output past the per-object ceiling was never stored, so there are no
  // bytes of ours to upload. Its Kie URL is the only thing that points at it,
  // and that is exactly the fallback below — reached here rather than after a
  // pointless read.
  if (!asset.storagePath || asset.storageState !== 'stored') {
    return oversizeFallback(asset, asset.bytes ?? 0)
  }

  // The same guard the asset route applies: `storage_path` is data, and data
  // naming another workspace's object is not read.
  if (!keyBelongsTo(asset.storagePath, workspaceId)) {
    return { ok: false, status: 410, message: 'That output has an unusable storage key.' }
  }

  const content = await getObject(asset.storagePath)
  if (!content) {
    return {
      ok: false,
      status: 410,
      message:
        'The stored copy of that output is gone, so it cannot be uploaded. ' +
        'Its generation may have been deleted.',
    }
  }

  // 3. Oversized — checked before the upload, because Kie would reject it after
  //    spending the whole transfer.
  if (content.byteLength > URL_UPLOAD_MAX_BYTES) {
    return oversizeFallback(asset, content.byteLength)
  }

  // 2. The normal path.
  const stored = await storeUpload({
    workspaceId,
    content,
    filename: basename(asset.storagePath),
    mime: asset.mime ?? undefined,
    // Named for where it came from, so the asset library reads as a history
    // rather than a list of hashes.
    label: `${row.modelSlug} · ${asset.generationId.slice(0, 8)}`,
    existingKey: asset.storagePath,
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

/**
 * The last resort: hand Kie its own result URL back.
 *
 * Taken for anything we could not or would not store — over Kie's 100 MB upload
 * ceiling, or over the storage plan's per-object ceiling. It is a worse answer
 * and it is never chosen silently: the URL dies about fourteen days after the
 * generation, and with it goes the re-runnability that `input_json` exists to
 * guarantee. Past those fourteen days it is not offered at all, because a dead
 * URL in a request is a generation that fails for no visible reason.
 */
function oversizeFallback(
  asset: { remoteUrl: string; kind: string; downloadedAt: number },
  bytes: number,
): ResolveOutcome {
  const fresh = Date.now() - asset.downloadedAt < RESULT_URL_TTL_MS
  const size = bytes > 0 ? `${mb(bytes)} MB` : 'That output'

  if (!fresh) {
    return {
      ok: false,
      status: 413,
      message:
        `${size} is too large to re-upload, and its original Kie result URL has ` +
        'expired. Shrink it before reusing it.',
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
      `${size} is past an upload ceiling, so its original Kie result URL was used ` +
      'instead. That URL dies about fourteen days after the generation, and a ' +
      're-run after that will fail.',
  }
}

function basename(storagePath: string): string {
  return storagePath.slice(storagePath.lastIndexOf('/') + 1)
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
