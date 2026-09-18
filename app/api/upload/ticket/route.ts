import { NextResponse } from 'next/server'

import { withWorkspace } from '@/lib/auth/route.ts'
import { getEnv } from '@/lib/env'
import { inputObjectKey } from '@/lib/jobs/paths.ts'
import { extensionForMime } from '@/lib/jobs/mime.ts'
import { extensionFromName, findStoredUpload } from '@/lib/jobs/uploads.ts'
import { URL_UPLOAD_MAX_BYTES } from '@/lib/kie/upload.ts'
import { createUploadUrl } from '@/lib/storage/objects.ts'
import { checkQuota } from '@/lib/storage/quota.ts'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * POST /api/upload/ticket — permission to put a file in the bucket, and where.
 *
 * The first half of the upload path for anything that will not fit through a
 * serverless function. `POST /api/upload` takes the bytes itself, which is fine
 * until they pass the platform's request-body cap (4.5 MB on Vercel) — at which
 * point the edge rejects the request before any of our code runs and the browser
 * is handed a plain-text `Request Entity Too Large` where it expected JSON.
 * There is no server-side fix for that, because there is no server-side code in
 * the failure. The bytes have to go somewhere else.
 *
 * So the browser hashes the file, asks here, uploads straight to Supabase with
 * the URL this returns, and then calls `POST /api/upload` with the KEY instead
 * of the bytes. Three round trips rather than one, taken only above the
 * threshold — see lib/client/upload.ts, which decides which path a file takes.
 *
 * What stays on the server, and why this is a route rather than a signed URL
 * handed out once:
 *
 *   - **The key.** Built here from the workspace and the content hash. A caller
 *     that could name its own key could name one under someone else's prefix,
 *     and the bucket's service-role connection would happily oblige.
 *   - **The ceilings.** Refused now, while it costs nothing, instead of after a
 *     40 MB upload that the per-object limit was never going to accept.
 *   - **The quota.** Checked BEFORE the bytes move, which is the rule the whole
 *     storage design turns on.
 */
export async function POST(request: Request) {
  return withWorkspace(request, async ({ workspaceId }) => {
    let body: { sha256?: unknown; bytes?: unknown; mime?: unknown; filename?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 })
    }

    const sha256 = typeof body.sha256 === 'string' ? body.sha256.toLowerCase() : ''
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      return NextResponse.json(
        { error: 'Expected `sha256` to be a 64-character hex digest of the file.' },
        { status: 400 },
      )
    }

    const bytes = typeof body.bytes === 'number' ? body.bytes : NaN
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return NextResponse.json({ error: 'Expected `bytes` to be the file size.' }, { status: 400 })
    }

    const { maxFileBytes } = getEnv()
    const ceiling = Math.min(maxFileBytes, URL_UPLOAD_MAX_BYTES)
    if (bytes > ceiling) {
      return NextResponse.json(
        {
          error: `That file is ${mb(bytes)} MB, past this project's ${mb(ceiling)} MB ceiling.`,
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

    const quota = await checkQuota(workspaceId, bytes)
    if (!quota.ok) {
      return NextResponse.json({ error: quota.message }, { status: 507 })
    }

    const mime = typeof body.mime === 'string' && body.mime ? body.mime : undefined
    const filename = typeof body.filename === 'string' ? body.filename : undefined
    const ext = extensionFromName(filename) ?? extensionForMime(mime) ?? undefined

    /*
     * An existing row's key wins over the one this would compute.
     *
     * Same rule as `storeUpload`, for the same reason: the same bytes are one
     * asset. The extension is the part that can differ — the same PNG added once
     * as `shot.png` and once as a blob with no name lands on two keys otherwise,
     * and the second would leave the first orphaned in the bucket, counted
     * against a 1 GB quota with no row pointing at it.
     */
    const existing = await findStoredUpload(workspaceId, sha256)
    const storageKey = existing?.storagePath ?? inputObjectKey(workspaceId, sha256, ext)

    const { uploadUrl } = await createUploadUrl(storageKey)

    return NextResponse.json({
      storageKey,
      uploadUrl,
      /**
       * True when the bucket already holds these exact bytes, so the browser can
       * skip the transfer and go straight to finalizing. Content-addressed keys
       * are what make that answerable without reading the object.
       */
      alreadyStored: Boolean(existing),
    })
  })
}

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}
