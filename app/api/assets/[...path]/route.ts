import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

import { getEnv } from '@/lib/env'
import { mimeForExtension } from '@/lib/jobs/mime.ts'
import { resolveWithin } from '@/lib/jobs/paths.ts'

export const dynamic = 'force-dynamic'

/**
 * GET /api/assets/<relative path> — serves a file out of KIE_OUTPUT_DIR.
 *
 * The gallery renders from local files, never from Kie URLs, because those are
 * deleted after 14 days. This route is what makes that possible.
 *
 * It takes a filesystem path from the browser, so the traversal guard is not
 * optional: `resolveWithin` resolves the request against KIE_OUTPUT_DIR and
 * returns null for anything landing outside it — `..`, an absolute path, or a
 * Windows drive letter alike.
 *
 * Range requests are honoured because `<video>` needs them to seek; without a
 * 206 the browser has to buffer a whole clip before it can scrub.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params
  const outputDir = getEnv().outputDir

  const absolutePath = resolveWithin(outputDir, segments.join('/'))
  if (!absolutePath) {
    return new Response('Forbidden', { status: 403 })
  }

  let stat
  try {
    stat = await fs.stat(absolutePath)
    if (!stat.isFile()) return new Response('Not found', { status: 404 })
  } catch {
    return new Response('Not found', { status: 404 })
  }

  const mime = mimeForExtension(path.extname(absolutePath).slice(1))
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`

  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } })
  }

  const headers = new Headers({
    'Content-Type': mime,
    ETag: etag,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600, must-revalidate',
  })

  const range = parseRange(request.headers.get('range'), stat.size)

  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${stat.size}`)
    return new Response(null, { status: 416, headers })
  }

  const start = range?.start ?? 0
  const end = range?.end ?? stat.size - 1

  headers.set('Content-Length', String(end - start + 1))
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${stat.size}`)

  const stream = Readable.toWeb(
    createReadStream(absolutePath, { start, end }),
  ) as unknown as ReadableStream<Uint8Array>

  return new Response(stream, { status: range ? 206 : 200, headers })
}

/** Single-range `bytes=` only — the form every browser media element sends. */
function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | undefined {
  if (!header) return undefined

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return undefined

  const [, rawStart, rawEnd] = match
  let start: number
  let end: number

  if (rawStart === '') {
    // A suffix range: the LAST n bytes.
    const length = Number(rawEnd)
    if (!Number.isFinite(length) || length <= 0) return 'unsatisfiable'
    start = Math.max(0, size - length)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'unsatisfiable'
  if (start >= size || start > end) return 'unsatisfiable'

  return { start, end: Math.min(end, size - 1) }
}
