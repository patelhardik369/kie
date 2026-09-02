import { NextResponse } from 'next/server'

import { storeUpload } from '@/lib/jobs/uploads.ts'
import { isKieError } from '@/lib/kie'
import { URL_UPLOAD_MAX_BYTES } from '@/lib/kie/upload.ts'

export const dynamic = 'force-dynamic'

/**
 * POST /api/upload — a local file becomes a `fileUrl` a model can read.
 *
 * Two request shapes:
 *   - `multipart/form-data` with a `file` field — the normal path, used by the
 *     form's file picker. Streamed up, so no 10 MB base64 ceiling applies.
 *   - `application/json` with `{ dataUrl }` — for pasted or canvas-generated
 *     images, which arrive as a data URI and have nowhere else to come from.
 *
 * Both land in the same place: the bytes are kept locally and the Kie upload URL
 * is cached against their hash for 24 hours, so re-using an image across
 * generations costs one round trip, not one per generation.
 */
export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''

  try {
    const file = contentType.includes('multipart/form-data')
      ? await readMultipart(request)
      : await readJson(request)

    if ('error' in file) {
      return NextResponse.json({ error: file.error }, { status: 400 })
    }

    if (file.content.byteLength > URL_UPLOAD_MAX_BYTES) {
      return NextResponse.json(
        {
          error: `That file is ${mb(file.content.byteLength)} MB. Kie's ceiling is ${mb(
            URL_UPLOAD_MAX_BYTES,
          )} MB.`,
        },
        { status: 413 },
      )
    }

    const stored = await storeUpload(file)

    return NextResponse.json({
      fileUrl: stored.fileUrl,
      id: stored.id,
      kind: stored.kind,
      mime: stored.mime,
      bytes: stored.bytes,
      // Surfaced so the UI can warn before a stale URL reaches a model.
      expiresAt: stored.expiresAt,
      reused: stored.reused,
    })
  } catch (error) {
    if (isKieError(error)) {
      return NextResponse.json(
        { error: error.message, kind: error.kind, detail: error.detail },
        { status: error.kind === 'rate_limited' ? 429 : 502 },
      )
    }
    throw error
  }
}

interface UploadInput {
  content: Uint8Array
  filename?: string
  mime?: string
  label?: string
}

async function readMultipart(request: Request): Promise<UploadInput | { error: string }> {
  const form = await request.formData()
  const file = form.get('file')

  if (!(file instanceof File)) {
    return { error: 'Expected a `file` field in the multipart body.' }
  }
  if (file.size === 0) {
    return { error: 'That file is empty.' }
  }

  const label = form.get('label')
  return {
    content: new Uint8Array(await file.arrayBuffer()),
    filename: file.name,
    mime: file.type || undefined,
    label: typeof label === 'string' && label ? label : undefined,
  }
}

async function readJson(request: Request): Promise<UploadInput | { error: string }> {
  let body: { dataUrl?: string; filename?: string; label?: string }
  try {
    body = await request.json()
  } catch {
    return { error: 'Request body must be multipart/form-data or JSON.' }
  }

  if (!body.dataUrl) {
    return { error: 'Expected `dataUrl` in the JSON body.' }
  }

  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(body.dataUrl)
  if (!match) {
    return { error: 'That is not a data URI.' }
  }

  const [, mime, isBase64, payload] = match
  const content = isBase64
    ? new Uint8Array(Buffer.from(payload!, 'base64'))
    : new TextEncoder().encode(decodeURIComponent(payload!))

  if (content.byteLength === 0) {
    return { error: 'That data URI carried no data.' }
  }

  return {
    content,
    filename: body.filename,
    mime: mime || undefined,
    label: body.label,
  }
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}
