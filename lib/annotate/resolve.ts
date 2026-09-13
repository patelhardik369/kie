import 'server-only'

import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'

import { assets, getDb, inputAssets } from '../db/index.ts'

/**
 * Turning a URL sitting in a form field back into something we already hold.
 *
 * Every `*_url` field carries a Kie `downloadUrl`, which is opaque — it says
 * nothing about where the bytes came from or whether we have them. The markup
 * editor needs three answers about one of those URLs:
 *
 *   1. Can we serve the pixels from our own bucket? (Almost always yes, and
 *      that avoids both an outbound fetch and the canvas-tainting problem.)
 *   2. Has this image already been marked up, and if so with what document?
 *   3. If it has, which clean original was it drawn on?
 *
 * Two tables can hold the answer, because a field's URL can be either something
 * uploaded (`input_assets`) or one of this studio's own outputs picked straight
 * out of the gallery (`assets`). Both are checked, uploads first — that is the
 * one that can carry an annotation.
 *
 * Every query is scoped to the workspace. The service-role connection ignores
 * RLS, so this filter is the entire ownership check: without it, pasting
 * somebody else's Kie URL would serve their file.
 */

export interface ResolvedSource {
  /** Object key in our bucket, when we hold the bytes. */
  storagePath: string | null
  mime: string | null
  /** The `input_assets` row, when this URL is one of our uploads. */
  inputAssetId: string | null
  /** The stored `AnnotationDoc`, when this image is itself a marked-up copy. */
  annotationJson: string | null
  /** The clean original this was marked up from. */
  sourceAssetId: string | null
  /** A live Kie URL for the clean original, when there is one. */
  sourceFileUrl: string | null
  /**
   * The clean original's own content type.
   *
   * Needed because the editor redraws on the ORIGINAL, and the export format
   * follows what it was: re-encoding a JPEG photograph as PNG multiplies its
   * size for detail that is already gone.
   */
  sourceMime: string | null
}

const EMPTY: ResolvedSource = {
  storagePath: null,
  mime: null,
  inputAssetId: null,
  annotationJson: null,
  sourceAssetId: null,
  sourceFileUrl: null,
  sourceMime: null,
}

export async function resolveSource(
  workspaceId: string,
  url: string,
): Promise<ResolvedSource> {
  if (!url) return EMPTY
  const db = getDb()

  /*
   * Newest first, and limited.
   *
   * `kie_file_url` is not unique: an upload whose 24-hour URL expired is
   * re-uploaded in place, and a URL Kie happens to reissue could in principle
   * appear twice. The most recent row is the one whose annotation and source
   * actually describe the bytes behind this URL.
   */
  const uploads = await db
    .select()
    .from(inputAssets)
    .where(and(eq(inputAssets.workspaceId, workspaceId), eq(inputAssets.kieFileUrl, url)))
    .orderBy(desc(inputAssets.createdAt))
    .limit(1)

  const upload = uploads[0]
  if (upload) {
    const origin = upload.sourceAssetId
      ? await originOf(workspaceId, upload.sourceAssetId)
      : null
    return {
      storagePath: upload.storagePath,
      mime: upload.mime,
      inputAssetId: upload.id,
      annotationJson: upload.annotationJson,
      sourceAssetId: upload.sourceAssetId,
      sourceFileUrl: origin?.fileUrl ?? null,
      sourceMime: origin?.mime ?? null,
    }
  }

  /*
   * An output picked out of the gallery. `lib/jobs/uploads.ts` stores these
   * under the output's own object key rather than copying the bytes, so the
   * storage path here is the one the generation already wrote.
   */
  const outputs = await db
    .select({ storagePath: assets.storagePath, mime: assets.mime })
    .from(assets)
    .where(and(eq(assets.workspaceId, workspaceId), eq(assets.remoteUrl, url)))
    .orderBy(desc(assets.downloadedAt))
    .limit(1)

  const output = outputs[0]
  if (output?.storagePath) {
    return { ...EMPTY, storagePath: output.storagePath, mime: output.mime }
  }

  return EMPTY
}

/**
 * Which of these URLs point at an image with marks drawn into it.
 *
 * For the gallery, which shows a generation's stored `input_json` and should be
 * able to say "this input was marked up" rather than leaving an opaque URL. A
 * read-side lookup and nothing more — `input_json` is stored verbatim and is
 * never rewritten by what this finds.
 *
 * One query for the whole set rather than one per URL: a generation can carry
 * sixteen input images, and the detail page already fans out enough work.
 */
export async function annotatedUrls(
  workspaceId: string,
  urls: string[],
): Promise<ReadonlySet<string>> {
  const unique = [...new Set(urls.filter((url) => url.length > 0))]
  if (unique.length === 0) return new Set()

  const rows = await getDb()
    .select({ kieFileUrl: inputAssets.kieFileUrl })
    .from(inputAssets)
    .where(
      and(
        eq(inputAssets.workspaceId, workspaceId),
        inArray(inputAssets.kieFileUrl, unique),
        isNotNull(inputAssets.annotationJson),
      ),
    )

  return new Set(rows.map((row) => row.kieFileUrl!).filter(Boolean))
}

/**
 * The same answer, addressed by `input_assets` id rather than by URL.
 *
 * The editor needs this for the case that makes re-editing work at all: when a
 * field already holds an annotated image, the marks must be replayed over the
 * CLEAN original, never over the flattened copy — otherwise every reopen burns
 * another layer of circles into the pixels. The original is known by id, and it
 * may well have no live URL left to look it up by.
 */
export async function resolveByAssetId(
  workspaceId: string,
  id: string,
): Promise<ResolvedSource> {
  const rows = await getDb()
    .select()
    .from(inputAssets)
    .where(and(eq(inputAssets.workspaceId, workspaceId), eq(inputAssets.id, id)))
    .limit(1)

  const row = rows[0]
  if (!row) return EMPTY

  return {
    storagePath: row.storagePath,
    mime: row.mime,
    inputAssetId: row.id,
    annotationJson: row.annotationJson,
    sourceAssetId: row.sourceAssetId,
    sourceFileUrl: null,
    sourceMime: null,
  }
}

/**
 * The clean original's content type, and its Kie URL if that is still live.
 *
 * The URL is null once it has expired rather than being handed back dead: it is
 * what "also send the unmarked photo" would put in the request, and a link that
 * 404s at generation time turns a helpful option into a failed run. Our own copy
 * survives either way, so the caller re-uploads from it instead.
 */
async function originOf(
  workspaceId: string,
  id: string,
): Promise<{ fileUrl: string | null; mime: string | null } | null> {
  const rows = await getDb()
    .select({
      kieFileUrl: inputAssets.kieFileUrl,
      expiresAt: inputAssets.expiresAt,
      mime: inputAssets.mime,
    })
    .from(inputAssets)
    .where(and(eq(inputAssets.workspaceId, workspaceId), eq(inputAssets.id, id)))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  const live = row.kieFileUrl && row.expiresAt && row.expiresAt > Date.now()
  return { fileUrl: live ? row.kieFileUrl : null, mime: row.mime }
}
