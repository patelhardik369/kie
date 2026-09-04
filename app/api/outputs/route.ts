import { NextResponse } from 'next/server'

import { assetTokenFor } from '@/lib/gallery/asset-token.ts'
import { assetHref } from '@/lib/gallery/display.ts'
import { listReusableOutputs, type OutputKind } from '@/lib/library/outputs.ts'

export const dynamic = 'force-dynamic'

/**
 * GET /api/outputs — past outputs, as candidate INPUTS.
 *
 * Feeds the picker that sits on every asset field, so the answer to "use the
 * image I made ten minutes ago" is a click rather than a trip through the output
 * folder and an upload.
 *
 *   ?kinds=image,video   restrict to what the parameter accepts
 *   ?q=<text>            match the prompt or the model slug
 *   ?nsfw=1              include generations marked private
 *   ?limit=<n>           default 60, capped at 200
 *
 * Thumbnail URLs are minted here rather than in the browser: a private
 * generation's file needs a capability token, and that token is signed
 * server-side (see lib/gallery/asset-token.ts).
 */

const KINDS: readonly OutputKind[] = ['image', 'video', 'audio']

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams

  const requested = (params.get('kinds') ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter((k): k is OutputKind => (KINDS as readonly string[]).includes(k))

  const limitRaw = Number(params.get('limit'))
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 60

  const outputs = await listReusableOutputs({
    kinds: requested.length > 0 ? requested : undefined,
    search: params.get('q') ?? undefined,
    includePrivate: params.get('nsfw') === '1',
    limit,
  })

  return NextResponse.json({
    outputs: outputs.map((output) => ({
      ...output,
      href: assetHref(output.localPath, assetTokenFor(output.localPath, output.nsfw)),
    })),
  })
}
