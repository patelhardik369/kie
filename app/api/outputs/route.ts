import { NextResponse } from 'next/server'

import { withWorkspace } from '@/lib/auth/route.ts'
import { assetToken } from '@/lib/gallery/asset-token.ts'
import { assetHref } from '@/lib/gallery/display.ts'
import { clampLimit, listReusableOutputs, type OutputKind } from '@/lib/library/outputs.ts'

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
 * Thumbnail URLs are minted here rather than in the browser: every stored object
 * needs a capability token, and that token is signed server-side (see
 * lib/gallery/asset-token.ts).
 */

const KINDS: readonly OutputKind[] = ['image', 'video', 'audio']

export async function GET(request: Request) {
  return withWorkspace(request, async ({ workspaceId }) => {
    const params = new URL(request.url).searchParams

    const requested = (params.get('kinds') ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter((k): k is OutputKind => (KINDS as readonly string[]).includes(k))

    // See clampLimit: a missing ?limit= must not read as zero, which is what
    // made this route answer with exactly one row.
    const limit = clampLimit(params.get('limit'))

    const outputs = await listReusableOutputs(workspaceId, {
      kinds: requested.length > 0 ? requested : undefined,
      search: params.get('q') ?? undefined,
      includePrivate: params.get('nsfw') === '1',
      limit,
    })

    return NextResponse.json({
      // Echoed so the picker can say "these are the 60 most recent" rather than
      // leaving a truncated list looking like the whole library.
      limit,
      outputs: outputs.map((output) => ({
        ...output,
        // Never null here: the query only returns outputs whose bytes are stored.
        href: output.storagePath
          ? assetHref(output.storagePath, assetToken(output.storagePath))
          : null,
      })),
    })
  })
}
