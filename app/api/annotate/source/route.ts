import dns from 'node:dns/promises'

import { NextResponse } from 'next/server'

import { resolveByAssetId, resolveSource } from '@/lib/annotate/resolve.ts'
import {
  MAX_REDIRECTS,
  MAX_SOURCE_BYTES,
  REJECTION_MESSAGES,
  isImageContentType,
  isPrivateAddress,
  parseSourceUrl,
  type SourceRejection,
} from '@/lib/annotate/source-guard.ts'
import { withWorkspace } from '@/lib/auth/route.ts'
import { objectStream, type ObjectStream } from '@/lib/storage/objects.ts'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/annotate/source?url=… — an input image, on our own origin.
 *
 * The markup editor draws the source onto a canvas and then calls
 * `toDataURL()`. That throws on a canvas any cross-origin image has touched,
 * and both possible sources are cross-origin: a Kie `downloadUrl` on a host we
 * do not control, and a Supabase signed URL — which is where
 * `app/api/assets/[...path]` redirects to. Serving the bytes from here removes
 * the question entirely rather than betting on somebody else's CORS headers.
 *
 * **This one proxies where `/api/assets` redirects, and the difference is
 * deliberate.** That route redirects because streaming a 40 MB video through a
 * function would burn the invocation's whole duration budget on every seek.
 * Neither applies here: this is a single image, fetched once when an editor
 * opens, and it is the only shape that produces an untainted canvas.
 *
 * It **streams** rather than buffers, though, and that part is not a detail.
 * Reading the whole object into the function first cost about two seconds on a
 * 0.88 MB image before the browser saw a single byte — and then the same bytes
 * still had to come down a second link, with neither half overlapping the other.
 * `objectStream` carries the measurements. Same origin, a tenth of the wait.
 *
 * Two paths, in order:
 *
 *   1. **Ours.** The URL matches an `input_assets` or `assets` row in this
 *      workspace, and the bytes come straight out of the bucket. Essentially
 *      every real case, and it costs no outbound request at all.
 *   2. **Guarded outbound fetch.** Only for a URL somebody pasted by hand. This
 *      is server-side fetch of a client-supplied URL — SSRF by construction —
 *      so it is fenced by `lib/annotate/source-guard.ts`: https only, public
 *      addresses only, image content types only, size-capped, and redirects
 *      re-validated at every hop rather than followed blindly.
 */
export async function GET(request: Request) {
  return withWorkspace(request, async ({ workspaceId }) => {
    const search = new URL(request.url).searchParams

    /*
     * Addressed by id: the clean original behind an already-annotated image.
     *
     * This is what stops "edit marks" from burning a second layer of circles
     * into pixels that already have one. The original is identified by row id
     * rather than by URL precisely because its 24-hour Kie URL may be long
     * gone — our own copy is the durable thing.
     */
    const assetId = search.get('assetId')
    if (assetId) {
      const row = await resolveByAssetId(workspaceId, assetId)
      const stored = row.storagePath ? await objectStream(row.storagePath) : null
      if (!stored) {
        return NextResponse.json({ error: 'That image is no longer stored.' }, { status: 404 })
      }
      return streamed(stored, row.mime)
    }

    const raw = search.get('url')
    const parsed = parseSourceUrl(raw)
    if (typeof parsed === 'string') return refuse(parsed)

    // ---- 1. Something we already hold -----------------------------------
    const known = await resolveSource(workspaceId, raw!)
    if (known.storagePath) {
      const stored = await objectStream(known.storagePath)
      if (stored) return streamed(stored, known.mime)
      // The row outlived its object — fall through and try the URL itself,
      // which may still be live.
    }

    // ---- 2. A hand-pasted URL -------------------------------------------
    const fetched = await fetchGuarded(parsed)
    if (typeof fetched === 'string') return refuse(fetched)
    return image(fetched.bytes, fetched.contentType)
  })
}

/**
 * The stored path: bytes forwarded as they arrive.
 *
 * The browser gets the first chunk in about a tenth of the time buffering took,
 * and decodes progressively from there — see `objectStream` for the numbers. The
 * row's own `mime` wins over what storage reports, because it is what the file
 * was accepted as; storage falls back to `application/octet-stream` for anything
 * it was not told about at upload time.
 */
function streamed(stored: ObjectStream, mime: string | null | undefined): Response {
  const contentType =
    mime ?? (stored.contentType && stored.contentType !== 'application/octet-stream'
      ? stored.contentType
      : 'application/octet-stream')

  return new NextResponse(stored.body, {
    headers: {
      'Content-Type': contentType,
      ...(stored.contentLength !== null
        ? { 'Content-Length': String(stored.contentLength) }
        : {}),
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function image(bytes: Uint8Array, contentType: string): Response {
  // Copied into a fresh ArrayBuffer: a Uint8Array from the storage client can be
  // a view onto a larger pooled buffer, and handing that straight to Response
  // would serve the whole pool.
  const body = bytes.slice().buffer as ArrayBuffer
  return new NextResponse(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(bytes.byteLength),
      // Private and short: the editor re-reads this on every open, and the
      // upstream URL it may have come from expires in a day.
      'Cache-Control': 'private, max-age=300',
      // Belt and braces — nothing here should ever be sniffed as a document.
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function refuse(reason: SourceRejection): Response {
  return NextResponse.json(
    { error: REJECTION_MESSAGES[reason], reason },
    { status: reason === 'too-large' ? 413 : 400 },
  )
}

interface FetchedImage {
  bytes: Uint8Array
  contentType: string
}

/**
 * Fetches an external image, re-checking the destination at every redirect.
 *
 * Redirects are followed manually because `redirect: 'follow'` would happily
 * chase a 302 from a public host into `169.254.169.254`, which is exactly the
 * bypass the address check exists to stop.
 *
 * A residual risk stays: DNS can be re-pointed between the lookup and the
 * connection. Closing that needs connecting by address with an overridden Host
 * header, which `fetch` cannot express. Given the ceiling on what this route
 * can return — image bytes, to the browser of the person who supplied the URL —
 * the check plus https-only plus the content-type gate is the proportionate
 * answer, and the exposure is stated here rather than left for someone to
 * discover.
 */
async function fetchGuarded(start: URL): Promise<FetchedImage | SourceRejection> {
  let target = start

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!(await hostIsPublic(target.hostname))) return 'private-host'

    const response = await fetch(target, {
      redirect: 'manual',
      headers: { Accept: 'image/*' },
      signal: AbortSignal.timeout(20_000),
    })

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return 'not-an-image'
      const next = parseSourceUrl(new URL(location, target).toString())
      if (typeof next === 'string') return next
      target = next
      continue
    }

    if (!response.ok) return 'not-an-image'
    if (!isImageContentType(response.headers.get('content-type'))) return 'not-an-image'

    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_SOURCE_BYTES) return 'too-large'

    const bytes = await readCapped(response)
    if (!bytes) return 'too-large'

    return { bytes, contentType: response.headers.get('content-type')!.split(';')[0]!.trim() }
  }

  return 'not-an-image'
}

/**
 * Reads a body, giving up past the ceiling.
 *
 * Streamed rather than `arrayBuffer()`d: a server that lies in `Content-Length`
 * — or omits it — would otherwise pull an unbounded body into the function's
 * memory before anyone checked its size.
 */
async function readCapped(response: Response): Promise<Uint8Array | null> {
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_SOURCE_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

/** Every address a hostname resolves to must be public — one private hit refuses. */
async function hostIsPublic(hostname: string): Promise<boolean> {
  const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
  if (/^[0-9.]+$/.test(bare) || bare.includes(':')) return !isPrivateAddress(bare)

  try {
    const addresses = await dns.lookup(bare, { all: true })
    if (addresses.length === 0) return false
    return addresses.every((entry) => !isPrivateAddress(entry.address))
  } catch {
    // A name that will not resolve is not a name we are going to fetch.
    return false
  }
}
