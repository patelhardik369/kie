import 'server-only'

import fs from 'node:fs/promises'
import path from 'node:path'
import { KIE_UPLOAD_BASE, UPLOAD_TIMEOUT_MS, kieRequest } from './client.ts'
import { KieError } from './errors.ts'

/**
 * File uploads.
 *
 * Host is kieai.redpandaai.co, NOT api.kie.ai.
 *
 * Every model field named `*_url` / `*_urls` wants a `fileUrl` from here (or
 * another publicly reachable URL) — never raw file content.
 *
 * Uploaded files expire in ~24 hours. The `input_assets` table caches
 * localPath -> kieFileUrl with `expiresAt` so a reuse inside the window skips
 * the round trip; past it, re-upload rather than sending a dead URL.
 */

/** Kie's advertised ceiling for base64 payloads. */
export const BASE64_MAX_BYTES = 10 * 1024 * 1024
/** Kie's advertised ceiling for remote-URL ingestion. */
export const URL_UPLOAD_MAX_BYTES = 100 * 1024 * 1024
/** Observed upload lifetime. Used to compute `input_assets.expires_at`. */
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000

/**
 * What the file endpoints actually return in `data`.
 *
 * Verified against the live API and
 * https://docs.kie.ai/file-upload-api/upload-file-stream.md: the usable link is
 * **`downloadUrl`**, and there is no `fileUrl` field at all. Reading `fileUrl`
 * yields `undefined`, which JSON.stringify then drops from a response — the
 * failure is silent all the way to an upload that appears to do nothing.
 */
interface UploadResponse {
  fileName?: string
  filePath?: string
  /** The URL to hand a model. Kie's name for it. */
  downloadUrl?: string
  fileSize?: number
  mimeType?: string
  uploadedAt?: string
}

export interface UploadedFile {
  /** Pass THIS to the model. Normalized from Kie's `downloadUrl`. */
  fileUrl: string
  fileName?: string
  filePath?: string
  fileSize?: number
  mimeType?: string
  uploadedAt?: string
}

/**
 * Turns a raw response into an `UploadedFile`, or throws.
 *
 * Throwing is the point. An upload whose URL cannot be found is useless, and
 * returning it with an undefined `fileUrl` is how a file silently fails to
 * attach itself to anything.
 */
function normalizeUpload(response: UploadResponse | null): UploadedFile {
  const fileUrl = response?.downloadUrl
  if (!fileUrl) {
    throw new KieError({
      code: 200,
      kind: 'unknown',
      retryable: false,
      message: 'Kie accepted the upload but returned no downloadUrl for it.',
      detail: JSON.stringify(response),
    })
  }
  return {
    fileUrl,
    fileName: response.fileName,
    filePath: response.filePath,
    fileSize: response.fileSize,
    mimeType: response.mimeType,
    uploadedAt: response.uploadedAt,
  }
}

/**
 * When this upload stops being usable, for the input_assets cache.
 *
 * Kie returns no expiry of its own — only `uploadedAt` — so the ~24h lifetime is
 * measured from the upload time when we have it, and from now when we do not.
 */
export function uploadExpiryMs(file: UploadedFile, now = Date.now()): number {
  const parsed = file.uploadedAt ? Date.parse(file.uploadedAt) : NaN
  return (Number.isFinite(parsed) ? parsed : now) + UPLOAD_TTL_MS
}

interface UploadCommon {
  /** Logical folder on Kie's side, e.g. `images`. */
  uploadPath?: string
  fileName?: string
  signal?: AbortSignal
}

/**
 * Streams a local file up as multipart.
 *
 * The default for local files: no 10 MB ceiling, no ~33% base64 inflation.
 */
export async function uploadFile(
  filePath: string,
  options: UploadCommon = {},
): Promise<UploadedFile> {
  const bytes = await fs.readFile(filePath)
  const name = options.fileName ?? path.basename(filePath)

  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)]), name)
  if (options.uploadPath) form.append('uploadPath', options.uploadPath)
  if (options.fileName) form.append('fileName', options.fileName)

  return normalizeUpload(
    await kieRequest<UploadResponse>('/api/file-stream-upload', {
      method: 'POST',
      base: KIE_UPLOAD_BASE,
      formData: form,
      timeoutMs: UPLOAD_TIMEOUT_MS,
      signal: options.signal,
    }),
  )
}

/**
 * Uploads a data URI.
 *
 * Only for small pasted or canvas-generated data — prefer `uploadFile`.
 * `base64Data` must keep its `data:<mime>;base64,` prefix.
 */
export async function uploadBase64(
  base64Data: string,
  options: UploadCommon = {},
): Promise<UploadedFile> {
  return normalizeUpload(
    await kieRequest<UploadResponse>('/api/file-base64-upload', {
      method: 'POST',
      base: KIE_UPLOAD_BASE,
      body: {
        base64Data,
        ...(options.uploadPath ? { uploadPath: options.uploadPath } : {}),
        ...(options.fileName ? { fileName: options.fileName } : {}),
      },
      timeoutMs: UPLOAD_TIMEOUT_MS,
      signal: options.signal,
    }),
  )
}

/**
 * Has Kie fetch a publicly reachable URL server-side.
 *
 * Kie applies a 30s download timeout on its end, so an origin that is slow or
 * requires auth will fail here rather than in our request.
 */
export async function uploadFromUrl(
  fileUrl: string,
  options: UploadCommon = {},
): Promise<UploadedFile> {
  return normalizeUpload(
    await kieRequest<UploadResponse>('/api/file-url-upload', {
      method: 'POST',
      base: KIE_UPLOAD_BASE,
      body: {
        fileUrl,
        ...(options.uploadPath ? { uploadPath: options.uploadPath } : {}),
        ...(options.fileName ? { fileName: options.fileName } : {}),
      },
      timeoutMs: UPLOAD_TIMEOUT_MS,
      signal: options.signal,
    }),
  )
}
