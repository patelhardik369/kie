import 'server-only'

import crypto from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import { getDb, inputAssets, type InputAsset } from '../db/index.ts'
import { UPLOAD_TTL_MS, uploadExpiryMs, uploadBytes } from '../kie/upload.ts'
import { getObject, putObject } from '../storage/objects.ts'
import { extensionForMime, kindForMime } from './mime.ts'
import { inputObjectKey } from './paths.ts'

/**
 * Input files: a durable copy in the bucket, Kie's upload URL cached for 24h.
 *
 * Every `*_url` model field wants a `fileUrl` from Kie's file API, and those
 * expire in about a day (docs/API-CONTRACT.md §6). Two consequences shape this
 * module, and neither changed when the copy moved from disk to object storage:
 *
 *   - **Our own copy is kept.** Once the URL expires the file has to be
 *     re-uploaded, and the browser that supplied it is long gone. Without the
 *     copy an expired input is unrecoverable and a re-run is impossible.
 *   - **The cache is keyed on content, not name.** Dragging the same image into
 *     five generations uploads it once.
 *
 * What did change: the dedupe key is now `(workspace, sha256)` rather than
 * `sha256` alone. Two people uploading the same stock image must not end up
 * sharing a row, because deleting it on one side would break the other — and
 * because whose file it is would become unanswerable.
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
  storagePath: string
  kind: InputAsset['kind']
  mime?: string
  bytes: number
  sha256: string
  expiresAt: number
  /** True when this reused an existing upload rather than spending a round trip. */
  reused: boolean
}

export interface StoreUploadParams {
  workspaceId: string
  content: Uint8Array
  /** Original filename, used for the extension and the library label. */
  filename?: string
  mime?: string
  label?: string
  /**
   * The bytes ALREADY live at this object key.
   *
   * Set when a generation's own output is reused as an input. The output object
   * is already the durable copy — rule 2 in .claude/CLAUDE.md exists to make
   * sure of it — so writing a second one would double the storage cost of every
   * reused video to buy nothing, and storage is the binding constraint on this
   * plan.
   *
   * The consequence is deliberate and bounded: deleting that generation from the
   * gallery takes the object, and the input row with it (see lib/gallery/delete.ts).
   * A destructive action the user asked for is allowed to be destructive.
   */
  existingKey?: string
  /**
   * These bytes are a marked-up copy of another image.
   *
   * Carries the vector document that produced them, so the marks can be
   * reopened and edited rather than redrawn, and the id of the clean original
   * so it can be offered alongside.
   *
   * **Omitting it never clears what a row already has.** The fields are spread
   * in conditionally for exactly that reason: `refreshUpload` re-uploads an
   * expired asset through this same function with no annotation in hand, and a
   * flat assignment would silently drop the marks off every annotated image the
   * moment its 24-hour URL lapsed.
   */
  annotation?: {
    /** A serialized `AnnotationDoc` — see lib/annotate/doc.ts. */
    docJson: string
    /** The `input_assets` row the marks were drawn on, when it is known. */
    sourceAssetId: string | null
  }
}

/**
 * Stores a file, uploads it to Kie unless a live upload already exists, and
 * returns the `fileUrl` to hand the model.
 */
export async function storeUpload(params: StoreUploadParams): Promise<CachedUpload> {
  const { workspaceId, content, filename, mime, label } = params
  const db = getDb()

  const sha256 = crypto.createHash('sha256').update(content).digest('hex')
  const existing = await findBySha(workspaceId, sha256)

  const ext = extensionFromName(filename) ?? extensionForMime(mime) ?? undefined
  // An existing row's key wins over the caller's: the same bytes are one asset,
  // and re-homing it on reuse would leave the older row pointing at nothing.
  const key =
    existing?.storagePath ?? params.existingKey ?? inputObjectKey(workspaceId, sha256, ext)

  // Written before the expiry check: a row can outlive its object if the bucket
  // was cleaned out, and the re-upload path needs the bytes back. Skipped when
  // the caller pointed us at bytes that are already stored.
  if (key !== params.existingKey) {
    await putObject(key, content, mime ?? 'application/octet-stream')
  }

  if (existing?.kieFileUrl && isLive(existing.expiresAt)) {
    /*
     * The bytes are cached, but the DOCUMENT may still have changed.
     *
     * Editing only a shape's note changes the legend and changes nothing on the
     * canvas, so the flattened image hashes identically and lands on this fast
     * path. Returning here without writing would accept the new note in the
     * prompt and silently keep the old one on the asset, so reopening the marks
     * later would show text the user had already replaced.
     */
    if (
      params.annotation &&
      (params.annotation.docJson !== existing.annotationJson ||
        params.annotation.sourceAssetId !== existing.sourceAssetId)
    ) {
      await db
        .update(inputAssets)
        .set({
          annotationJson: params.annotation.docJson,
          sourceAssetId: params.annotation.sourceAssetId,
        })
        .where(eq(inputAssets.id, existing.id))
    }

    return {
      id: existing.id,
      fileUrl: existing.kieFileUrl,
      storagePath: existing.storagePath,
      kind: existing.kind,
      mime: existing.mime ?? mime,
      bytes: existing.bytes ?? content.byteLength,
      sha256,
      expiresAt: existing.expiresAt!,
      reused: true,
    }
  }

  // Uploaded from the bytes in hand rather than from a path: there is no
  // filesystem to read back, and we already have exactly what Kie needs.
  const uploaded = await uploadBytes(content, {
    uploadPath: 'kie-studio',
    fileName: filename ?? `${sha256.slice(0, 16)}${ext ? `.${ext}` : ''}`,
    mime,
  })
  const expiresAt = uploadExpiryMs(uploaded)
  const kind: InputAsset['kind'] = kindForMime(uploaded.mimeType ?? mime) ?? 'file'

  const row = {
    workspaceId,
    storagePath: key,
    sha256,
    kind,
    mime: uploaded.mimeType ?? mime ?? null,
    bytes: content.byteLength,
    kieFileUrl: uploaded.fileUrl,
    expiresAt,
    label: label ?? filename ?? null,
    ...(params.annotation
      ? {
          annotationJson: params.annotation.docJson,
          sourceAssetId: params.annotation.sourceAssetId,
        }
      : {}),
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
    storagePath: key,
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
 * Returns null when our own copy is gone, which is the one unrecoverable case —
 * there is nothing left to upload.
 */
export async function refreshUpload(
  id: string,
  workspaceId: string,
): Promise<CachedUpload | null> {
  const [row] = await getDb()
    .select()
    .from(inputAssets)
    .where(and(eq(inputAssets.id, id), eq(inputAssets.workspaceId, workspaceId)))
    .limit(1)
  if (!row) return null

  const content = await getObject(row.storagePath)
  if (!content) return null

  return storeUpload({
    workspaceId,
    content,
    filename: row.label ?? basename(row.storagePath),
    mime: row.mime ?? undefined,
    label: row.label ?? undefined,
    existingKey: row.storagePath,
  })
}

async function findBySha(
  workspaceId: string,
  sha256: string,
): Promise<InputAsset | undefined> {
  const rows = await getDb()
    .select()
    .from(inputAssets)
    .where(and(eq(inputAssets.workspaceId, workspaceId), eq(inputAssets.sha256, sha256)))
    .limit(1)
  return rows[0]
}

function isLive(expiresAt: number | null): boolean {
  if (!expiresAt) return false
  return expiresAt - EXPIRY_MARGIN_MS > Date.now()
}

function extensionFromName(filename: string | undefined): string | undefined {
  if (!filename) return undefined
  const dot = filename.lastIndexOf('.')
  if (dot < 0) return undefined
  const ext = filename.slice(dot + 1).toLowerCase()
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : undefined
}

function basename(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1)
}

export { UPLOAD_TTL_MS }
