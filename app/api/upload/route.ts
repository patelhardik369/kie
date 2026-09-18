import crypto from 'node:crypto'

import { NextResponse } from 'next/server'

import { withStudio } from '@/lib/auth/route.ts'
import { getEnv } from '@/lib/env'
import { findStoredUpload, storeUpload } from '@/lib/jobs/uploads.ts'
import { URL_UPLOAD_MAX_BYTES } from '@/lib/kie/upload.ts'
import { getObject, keyBelongsTo, removeObjects } from '@/lib/storage/objects.ts'
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
 * Three request shapes:
 *   - `multipart/form-data` with a `file` field — the normal path for a small
 *     file, and one round trip.
 *   - `application/json` with `{ storageKey, sha256 }` — the second half of the
 *     direct upload (app/api/upload/ticket). The bytes are already in the
 *     bucket; this only reads them back, checks they are what was promised, and
 *     puts them in front of Kie. **This is the only shape that works for a file
 *     over ~4.5 MB**, because the platform refuses a request body that large
 *     before this route is reached — see the ticket route for the whole story.
 *   - `application/json` with `{ dataUrl }` — for pasted or canvas-generated
 *     images, which arrive as a data URI and have nowhere else to come from.
 *
 * All three land in the same place: the bytes are kept in the bucket and the Kie
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

    const parsed = contentType.includes('multipart/form-data')
      ? await readMultipart(request)
      : await readJson(request)

    if ('error' in parsed) return fail(parsed)

    /*
     * The direct-upload path can often answer without moving a byte.
     *
     * The browser sent the hash, the hash is the key, and a row against it with
     * a live Kie URL is the same answer `storeUpload` would reach after
     * downloading the object to work it out. Skipped when there are marks to
     * record: those change the ROW without changing the pixels, so the hash hits
     * while the document that has to be written alongside it is new.
     */
    if (parsed.kind === 'stored' && !parsed.annotation) {
      const known = await findStoredUpload(workspaceId, parsed.sha256)
      if (known?.cached && known.storagePath === parsed.storageKey) {
        return NextResponse.json(describe(known.cached))
      }
    }

    const file = parsed.kind === 'stored' ? await collect(parsed, workspaceId) : parsed
    if ('error' in file) return fail(file)

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

    /*
     * Not re-checked on the direct path: the ticket route checked it BEFORE the
     * bytes moved, which is the whole point of that route existing. Refusing
     * here would refuse an object that is already in the bucket, leaving it
     * there with no row pointing at it — spending the quota to enforce it.
     */
    if (file.kind === 'bytes') {
      const quota = await checkQuota(workspaceId, size)
      if (!quota.ok) {
        return NextResponse.json({ error: quota.message }, { status: 507 })
      }
    }

    // Kie errors are mapped by `withStudio`, so nothing is caught here — one
    // error shape across every route is what lets the form report them all
    // the same way.
    const { kind: _kind, ...rest } = file
    const stored = await storeUpload({ workspaceId, ...rest })

    return NextResponse.json(describe(stored))
  })
}

interface Annotation {
  docJson: string
  sourceAssetId: string | null
}

interface Common {
  filename?: string
  mime?: string
  label?: string
  annotation?: Annotation
}

/** Bytes in hand — from a multipart body, a data URI, or read back out of the bucket. */
interface BytesInput extends Common {
  kind: 'bytes'
  content: Uint8Array
  /** Set when those bytes came back out of the bucket and are already stored. */
  existingKey?: string
}

/** Bytes already in the bucket, put there by the browser. See the ticket route. */
interface StoredInput extends Common {
  kind: 'stored'
  storageKey: string
  sha256: string
}

/** A refusal, carrying the status it should be answered with. */
interface Failure {
  error: string
  detail?: string
  status?: number
}

function fail(failure: Failure): Response {
  return NextResponse.json(
    { error: failure.error, ...(failure.detail ? { detail: failure.detail } : {}) },
    { status: failure.status ?? 400 },
  )
}

/** The one response shape, whichever path produced it. */
function describe(stored: {
  fileUrl: string
  id: string
  kind: string
  mime?: string
  bytes: number
  expiresAt: number
  reused: boolean
}) {
  return {
    fileUrl: stored.fileUrl,
    id: stored.id,
    kind: stored.kind,
    mime: stored.mime,
    bytes: stored.bytes,
    // Surfaced so the UI can warn before a stale URL reaches a model.
    expiresAt: stored.expiresAt,
    reused: stored.reused,
  }
}

/**
 * Turns a finished direct upload into bytes, refusing anything that does not
 * add up.
 *
 * Two checks, and neither is ceremony. The **prefix** check is the only thing
 * standing between a caller-supplied key and another workspace's files: the
 * bucket is opened with a service-role key that can read all of it, so "this
 * object is mine" is a claim application code has to verify rather than one the
 * database will refuse (.claude/CLAUDE.md, rule 4). The **hash** check is what
 * keeps a content-addressed key honest — a key that says one thing while the
 * bytes under it say another poisons every later dedupe against that hash, and
 * every generation that reuses the asset gets a file nobody asked for.
 */
async function collect(
  input: StoredInput,
  workspaceId: string,
): Promise<BytesInput | Failure> {
  if (!keyBelongsTo(input.storageKey, workspaceId)) {
    return { error: 'That upload key does not belong to this workspace.', status: 403 }
  }

  const content = await getObject(input.storageKey)
  if (!content) {
    return {
      error: 'The upload did not arrive.',
      detail:
        'The file was not found in storage. This usually means the direct upload was ' +
        'interrupted — try again.',
      status: 409,
    }
  }

  const actual = crypto.createHash('sha256').update(content).digest('hex')
  if (actual !== input.sha256) {
    // Removed rather than left: it is at a key that describes different bytes,
    // so nothing will ever look for it again and it would sit in the quota
    // forever.
    await removeObjects([input.storageKey]).catch(() => undefined)
    return {
      error: 'The uploaded file did not match its checksum, so it was discarded.',
      detail: 'Try again — this usually means the transfer was truncated.',
      status: 400,
    }
  }

  return {
    kind: 'bytes',
    content,
    filename: input.filename,
    mime: input.mime,
    label: input.label,
    ...(input.annotation ? { annotation: input.annotation } : {}),
    // The bytes are already at this key, so `storeUpload` must not write them a
    // second time.
    existingKey: input.storageKey,
  }
}

async function readMultipart(request: Request): Promise<BytesInput | Failure> {
  const form = await request.formData()
  const file = form.get('file')

  if (!(file instanceof File)) {
    return { error: 'Expected a `file` field in the multipart body.' }
  }
  if (file.size === 0) {
    return { error: 'That file is empty.' }
  }

  const label = form.get('label')
  const annotation = readAnnotation(form.get('annotation'))
  if (annotation && 'error' in annotation) return annotation

  return {
    kind: 'bytes',
    content: new Uint8Array(await file.arrayBuffer()),
    filename: file.name,
    mime: file.type || undefined,
    label: typeof label === 'string' && label ? label : undefined,
    ...(annotation ? { annotation } : {}),
  }
}

/**
 * The markup editor's companion field: the vector document behind a flattened
 * image, plus the clean original it was drawn on.
 *
 * Validated only as far as this route can honestly validate it — that it is
 * JSON, and that it declares the version this build writes. The document's real
 * shape belongs to `lib/annotate/doc.ts`, and `parseDoc` re-checks it on the way
 * back out; a route that duplicated those rules would be a second place to keep
 * them in step.
 */
function readAnnotation(
  raw: FormDataEntryValue | unknown,
): Annotation | Failure | undefined {
  if (typeof raw !== 'string' || raw.length === 0) return undefined

  let parsed: { doc?: unknown; sourceAssetId?: unknown }
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: 'The `annotation` field is not valid JSON.' }
  }

  const doc = parsed.doc
  if (typeof doc !== 'object' || doc === null || (doc as { version?: unknown }).version !== 1) {
    return { error: 'The `annotation` field does not carry a version 1 document.' }
  }

  return {
    docJson: JSON.stringify(doc),
    sourceAssetId:
      typeof parsed.sourceAssetId === 'string' && parsed.sourceAssetId
        ? parsed.sourceAssetId
        : null,
  }
}

async function readJson(request: Request): Promise<BytesInput | StoredInput | Failure> {
  let body: {
    dataUrl?: string
    storageKey?: string
    sha256?: string
    filename?: string
    mime?: string
    label?: string
    annotation?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return { error: 'Request body must be multipart/form-data or JSON.' }
  }

  const annotation = readAnnotation(
    // Sent as a nested object here rather than as the string a multipart field
    // forces, so it is re-serialized to meet `readAnnotation` where it already
    // is. One validator, two wire formats.
    body.annotation === undefined ? null : JSON.stringify(body.annotation),
  )
  if (annotation && 'error' in annotation) return annotation

  // The direct-upload path: the bytes are in the bucket already and this only
  // says where. See app/api/upload/ticket/route.ts.
  if (typeof body.storageKey === 'string' && body.storageKey) {
    const sha256 = typeof body.sha256 === 'string' ? body.sha256.toLowerCase() : ''
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      return { error: 'A `storageKey` must be accompanied by the file’s `sha256`.' }
    }
    return {
      kind: 'stored',
      storageKey: body.storageKey,
      sha256,
      filename: body.filename,
      mime: body.mime,
      label: body.label,
      ...(annotation ? { annotation } : {}),
    }
  }

  if (!body.dataUrl) {
    return { error: 'Expected `dataUrl` or `storageKey` in the JSON body.' }
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
    kind: 'bytes',
    content,
    filename: body.filename,
    mime: mime || undefined,
    label: body.label,
    ...(annotation ? { annotation } : {}),
  }
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}
