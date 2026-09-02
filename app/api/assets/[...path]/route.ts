import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

import { eq } from 'drizzle-orm'

import { assets, generations, getDb } from '@/lib/db'
import { getEnv } from '@/lib/env'
import { assetTokenMatches } from '@/lib/gallery/asset-token.ts'
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
 * Files belonging to a generation marked private need `?k=` as well. Hiding a
 * generation from every listing is worth little while its bytes stay one
 * guessable URL away — the path is a date, a family, a model slug and an id.
 * The pages allowed to render it mint the token server-side; without a valid one
 * the answer is 404, not 403, so a probe cannot even confirm the file exists.
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

  const relativePath = segments.join('/')
  const absolutePath = resolveWithin(outputDir, relativePath)
  if (!absolutePath) {
    return new Response('Forbidden', { status: 403 })
  }

  if (await isPrivate(relativePath)) {
    const token = new URL(request.url).searchParams.get('k')
    if (!assetTokenMatches(relativePath, token)) {
      // Indistinguishable from a path that was never generated.
      return new Response('Not found', { status: 404 })
    }
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

/**
 * Whether this file belongs to a generation marked private.
 *
 * Looked up by `local_path`, which is what the row stores and what the URL
 * carries. A path with no `assets` row — an `_inputs/` upload, or a stray file —
 * is not private: those are named by the SHA-256 of their own contents, so the
 * path is already unguessable to anyone who does not have the file.
 */
async function isPrivate(relativePath: string): Promise<boolean> {
  const rows = await getDb()
    .select({ nsfw: generations.nsfw })
    .from(assets)
    .innerJoin(generations, eq(assets.generationId, generations.id))
    .where(eq(assets.localPath, relativePath))
    .limit(1)

  return rows[0]?.nsfw === true
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
