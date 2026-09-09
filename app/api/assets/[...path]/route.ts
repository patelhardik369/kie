import { NextResponse } from 'next/server'

import { assetTokenMatches } from '@/lib/gallery/asset-token.ts'
import { SIGNED_URL_TTL_SECONDS, signedUrl } from '@/lib/storage/objects.ts'

export const dynamic = 'force-dynamic'

/**
 * GET /api/assets/<object key>?k=<token> — redirects to a signed Supabase URL.
 *
 * The gallery renders from stored objects, never from Kie URLs, because those
 * are deleted after 14 days. This route is what makes that possible.
 *
 * **It redirects; it does not proxy.** That is the important decision here. The
 * old version streamed bytes off local disk and hand-rolled `Range` handling so
 * `<video>` could scrub. Doing the same on a serverless host would pull every
 * byte of a 40 MB video through a function — the whole file in memory, the whole
 * transfer against the invocation's duration budget, and a fresh copy for every
 * seek. A 302 to a signed Supabase URL hands the browser to a CDN that already
 * does byte ranges properly, costs one indexed HMAC check, and never touches the
 * bytes at all.
 *
 * Authorisation is the `?k=` token and nothing else, because nothing else can
 * reach here: `<img src>` and `<video src>` send no custom headers, so a
 * workspace header would be checkable in `fetch` and absent in exactly the two
 * cases that matter. The token is an HMAC of the object key itself, minted only
 * by code that has already established the caller owns the row — see
 * lib/gallery/asset-token.ts.
 *
 * A bad token is a 404, not a 403, so a probe cannot confirm a key exists.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await params
  const key = segments.map(decodeURIComponent).join('/')

  const token = new URL(request.url).searchParams.get('k')
  if (!assetTokenMatches(key, token)) {
    // Indistinguishable from an object that was never generated.
    return new NextResponse('Not found', { status: 404 })
  }

  const url = await signedUrl(key)
  if (!url) {
    return new NextResponse('Not found', { status: 404 })
  }

  return NextResponse.redirect(url, {
    status: 302,
    headers: {
      // The redirect may be cached for a little less than the URL it points at,
      // so a cached 302 can never outlive the signature it carries.
      'Cache-Control': `private, max-age=${SIGNED_URL_TTL_SECONDS - 300}`,
    },
  })
}
