import { NextResponse } from 'next/server'

import { withWorkspace } from '@/lib/auth/route.ts'
import { listInputAssets } from '@/lib/library/queries.ts'

export const dynamic = 'force-dynamic'

/**
 * GET /api/input-assets?kind=image — the asset library.
 *
 * Not under `/api/assets`, which is a catch-all serving OUTPUT files by path and
 * would swallow this route. Outputs and inputs are different things: outputs are
 * what a generation produced, inputs are what it was given.
 */
export async function GET(request: Request) {
  return withWorkspace(request, async ({ workspaceId }) => {
    const kind = new URL(request.url).searchParams.get('kind') ?? undefined
    const assets = await listInputAssets(workspaceId, kind)

    return NextResponse.json({
      assets: assets.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        label: asset.label,
        mime: asset.mime,
        bytes: asset.bytes,
        sha256: asset.sha256,
        storagePath: asset.storagePath,
        createdAt: asset.createdAt,
        // `live` says whether the cached Kie URL can be used as-is. An expired
        // asset is not broken — our own copy is kept in the bucket, and asking
        // to use it re-uploads transparently.
        live: asset.live,
        expiresAt: asset.expiresAt,
        fileUrl: asset.live ? asset.kieFileUrl : null,
      })),
    })
  })
}
