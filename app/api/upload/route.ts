import { NextResponse } from 'next/server'

import { withStudio } from '@/lib/auth/route.ts'
import { getEnv } from '@/lib/env'
import { storeUpload } from '@/lib/jobs/uploads.ts'
import { URL_UPLOAD_MAX_BYTES } from '@/lib/kie/upload.ts'
import { checkQuota } from '@/lib/storage/quota.ts'

export const dynamic = 'force-dynamic'
/**
 * Seconds this route may run for. A literal, because Next only accepts a
 * statically analysable number here — `'max'` is valid in vercel.json but not
 * in a route segment config.
 *
 * 60 is the ceiling on Vercel's Hobby plan without Fluid compute, so it is the
 * value that works everywhere. On Pro, or with Fluid enabled, raising it to 300
 * lets a single invocation carry a long video further before handing back to the
 * cron — nothing breaks either way, because the job's position lives in the
 * database rather than on the stack.
 */
export const maxDuration = 60

/**
 * POST /api/upload — a local file becomes a `fileUrl` a model can read.
 *
 * Two request shapes:
 *   - `multipart/form-data` with a `file` field — the normal path, used by the
 *     form's file picker. Streamed up, so no 10 MB base64 ceiling applies.
 *   - `application/json` with `{ dataUrl }` — for pasted or canvas-generated
 *     images, which arrive as a data URI and have nowhere else to come from.
 *
 * Both land in the same place: the bytes are kept in the bucket and the Kie
 * upload URL is cached against their hash for 24 hours, so re-using an image
 * across generations costs one round trip, not one per generation.
 *
 * Two ceilings apply now, and they are different numbers for different reasons.
 * Kie will ingest up to 100 MB; the storage plan will hold a single object only
 * up to its own limit (50 MB on Supabase Free). The smaller one binds, because a
 * file we cannot keep is a file whose Kie URL dies in a day and takes the
 * re-runnability of every generation that used it with it.
 */
export async function POST(request: Request) {
  return withStudio(request, async ({ workspaceId }) => {
    const contentType = request.headers.get('content-type') ?? ''

    const file = contentType.includes('multipart/form-data')
      ? await readMultipart(request)
      : await readJson(request)

    if ('error' in file) {
      return NextResponse.json({ error: file.error }, { status: 400 })
    }

    const size = file.content.byteLength
    const { maxFileBytes } = getEnv()
    const ceiling = Math.min(maxFileBytes, URL_UPLOAD_MAX_BYTES)

    if (size > ceiling) {
      return NextResponse.json(
        {
          error: `That file is ${mb(size)} MB, past this project's ${mb(ceiling)} MB ceiling.`,
          detail:
            maxFileBytes < URL_UPLOAD_MAX_BYTES
              ? `Supabase Free caps every stored object at ${mb(maxFileBytes)} MB, and an ` +
                'input that cannot be stored could not be re-uploaded once its Kie URL ' +
                'expires tomorrow. Shrink the file, or raise the plan.'
              : `Kie's own ingestion ceiling is ${mb(URL_UPLOAD_MAX_BYTES)} MB.`,
        },
        { status: 413 },
      )
    }

    const quota = await checkQuota(workspaceId, size)
    if (!quota.ok) {
      return NextResponse.json({ error: quota.message }, { status: 507 })
    }

    // Kie errors are mapped by `withStudio`, so nothing is caught here — one
    // error shape across every route is what lets the form report them all
    // the same way.
    const stored = await storeUpload({ workspaceId, ...file })

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
  })
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
