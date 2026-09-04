import 'server-only'

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { eq } from 'drizzle-orm'

import { getDb, inputAssets, type InputAsset } from '../db/index.ts'
import { getEnv } from '../env.ts'
import { UPLOAD_TTL_MS, uploadExpiryMs, uploadFile } from '../kie/upload.ts'
import { extensionForMime, kindForMime } from './mime.ts'
import { inputRelativePath } from './paths.ts'

/**
 * Input files: local copy on disk, Kie upload URL cached for 24 hours.
 *
 * Every `*_url` model field wants a `fileUrl` from Kie's file API, and those
 * expire in about a day (docs/API-CONTRACT.md §6). Two consequences shape this
 * module:
 *
 *   - **A local copy is kept.** Once the URL expires, the file has to be
 *     re-uploaded, and the browser that supplied it is long gone. Without the
 *     copy, an expired input is unrecoverable and a re-run is impossible.
 *   - **The cache is keyed on content, not name.** Dragging the same image into
 *     five generations uploads it once.
 */

/**
 * Treat an upload as expired slightly early. A URL that dies between the cache
 * hit and the model reading it fails the generation for no visible reason.
 */
const EXPIRY_MARGIN_MS = 5 * 60_000

export interface CachedUpload {
  id: string
  /** The value to put in the model's `*_url` field. */
  fileUrl: string
  localPath: string
  kind: InputAsset['kind']
  mime?: string
  bytes: number
  sha256: string
  expiresAt: number
  /** True when this reused an existing upload rather than spending a round trip. */
  reused: boolean
}

export interface StoreUploadParams {
  content: Uint8Array
  /** Original filename, used for the extension and the library label. */
  filename?: string
  mime?: string
  label?: string
  /**
   * The bytes ALREADY live here, relative to KIE_OUTPUT_DIR.
   *
   * Set when a generation's own output is reused as an input. The output tree is
   * already the durable local copy — rule 2 in .claude/CLAUDE.md exists to make
   * sure of it — so writing a second copy under `_inputs/` would double the disk
   * cost of every reused video to buy nothing.
   *
   * The consequence is deliberate and bounded: deleting that generation from the
   * gallery takes the file, and the input row with it (see lib/gallery/delete.ts).
   * A destructive action the user asked for is allowed to be destructive.
   */
  existingPath?: string
}

/**
 * Stores a file locally, uploads it to Kie unless a live upload already exists,
 * and returns the `fileUrl` to hand the model.
 */
export async function storeUpload(params: StoreUploadParams): Promise<CachedUpload> {
  const { content, filename, mime, label } = params
  const db = getDb()

  const sha256 = crypto.createHash('sha256').update(content).digest('hex')
  const existing = await findBySha(sha256)

  const ext =
    extensionFromName(filename) ?? extensionForMime(mime) ?? undefined
  // An existing row's path wins over the caller's: the same bytes are one asset,
  // and re-homing it on reuse would leave the older row pointing at nothing.
  const relativePath =
    existing?.localPath ?? params.existingPath ?? inputRelativePath(sha256, ext)
  const absolutePath = path.join(getEnv().outputDir, relativePath)

  // Written before the expiry check: a row can outlive its file if the output
  // folder was cleaned out, and the re-upload path needs the bytes back. Skipped
  // when the caller pointed us at bytes that are already on disk.
  if (relativePath !== params.existingPath) {
    await writeIfAbsent(absolutePath, content)
  }

  if (existing?.kieFileUrl && isLive(existing.expiresAt)) {
    return {
      id: existing.id,
      fileUrl: existing.kieFileUrl,
      localPath: existing.localPath,
      kind: existing.kind,
      mime: existing.mime ?? mime,
      bytes: existing.bytes ?? content.byteLength,
      sha256,
      expiresAt: existing.expiresAt!,
      reused: true,
    }
  }

  const uploaded = await uploadFile(absolutePath, {
    uploadPath: 'kie-studio',
    fileName: filename,
  })
  const expiresAt = uploadExpiryMs(uploaded)
  const kind: InputAsset['kind'] = kindForMime(uploaded.mimeType ?? mime) ?? 'file'

  const row = {
    localPath: relativePath,
    sha256,
    kind,
    mime: uploaded.mimeType ?? mime ?? null,
    bytes: content.byteLength,
    kieFileUrl: uploaded.fileUrl,
    expiresAt,
    label: label ?? filename ?? null,
  }

  let id = existing?.id
  if (id) {
    // Updated in place, never inserted twice: the same file re-uploaded after
    // expiry is the same asset with a fresher URL.
    await db.update(inputAssets).set(row).where(eq(inputAssets.id, id))
  } else {
    id = crypto.randomUUID()
    await db.insert(inputAssets).values({ id, ...row, createdAt: Date.now() })
  }

  return {
    id,
    fileUrl: uploaded.fileUrl,
    localPath: relativePath,
    kind,
    mime: row.mime ?? undefined,
    bytes: content.byteLength,
    sha256,
    expiresAt,
    reused: false,
  }
}

/**
 * Re-uploads a stored input whose Kie URL has expired.
 *
 * Returns null when the local copy is gone, which is the one unrecoverable
 * case — there is nothing left to upload.
 */
export async function refreshUpload(id: string): Promise<CachedUpload | null> {
  const rows = await getDb()
    .select()
    .from(inputAssets)
    .where(eq(inputAssets.id, id))
    .limit(1)
  const row = rows[0]
  if (!row) return null

  const absolutePath = path.join(getEnv().outputDir, row.localPath)
  let content: Uint8Array
  try {
    content = await fs.readFile(absolutePath)
  } catch {
    return null
  }

  return storeUpload({
    content,
    filename: row.label ?? path.basename(row.localPath),
    mime: row.mime ?? undefined,
    label: row.label ?? undefined,
  })
}

async function findBySha(sha256: string): Promise<InputAsset | undefined> {
  const rows = await getDb()
    .select()
    .from(inputAssets)
    .where(eq(inputAssets.sha256, sha256))
    .limit(1)
  return rows[0]
}

function isLive(expiresAt: number | null): boolean {
  if (!expiresAt) return false
  return expiresAt - EXPIRY_MARGIN_MS > Date.now()
}

async function writeIfAbsent(absolutePath: string, content: Uint8Array) {
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  try {
    const stat = await fs.stat(absolutePath)
    if (stat.size === content.byteLength) return
  } catch {
    // Not there yet — fall through and write it.
  }
  await fs.writeFile(absolutePath, content)
}

function extensionFromName(filename: string | undefined): string | undefined {
  if (!filename) return undefined
  const ext = path.extname(filename).slice(1).toLowerCase()
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : undefined
}

export { UPLOAD_TTL_MS }
