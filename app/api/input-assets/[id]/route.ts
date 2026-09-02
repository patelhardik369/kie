import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { getDb, inputAssets } from '@/lib/db'
import { deleteInputAsset } from '@/lib/library/queries.ts'
import { refreshUpload } from '@/lib/jobs/uploads.ts'
import { isKieError } from '@/lib/kie'

export const dynamic = 'force-dynamic'

/**
 * POST /api/input-assets/[id] — hand back a URL a model can actually fetch.
 *
 * This is the whole point of the asset library (docs/PRD.md F7):
 *
 *   - **Inside 24h** the cached `kie_file_url` is returned as-is. No upload, no
 *     round trip — reusing the same reference image across ten generations
 *     costs one upload, not ten.
 *   - **Past that** the local copy is re-uploaded and the row updated in place,
 *     transparently. The caller cannot tell the difference except by `reused`.
 *
 * The local copy is what makes the second case possible at all. Without it an
 * expired asset would be unrecoverable, since the browser that supplied it is
 * long gone.
 */

/** Re-upload slightly before expiry, so a URL cannot die between here and submit. */
const EXPIRY_MARGIN_MS = 5 * 60_000

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const rows = await getDb()
    .select()
    .from(inputAssets)
    .where(eq(inputAssets.id, id))
    .limit(1)
  const asset = rows[0]

  if (!asset) {
    return NextResponse.json({ error: 'No such asset.' }, { status: 404 })
  }

  const live =
    asset.kieFileUrl && asset.expiresAt && asset.expiresAt - EXPIRY_MARGIN_MS > Date.now()

  if (live) {
    return NextResponse.json({
      fileUrl: asset.kieFileUrl,
      reused: true,
      expiresAt: asset.expiresAt,
    })
  }

  try {
    const refreshed = await refreshUpload(id)
    if (!refreshed) {
      return NextResponse.json(
        {
          error:
            'The local copy of this asset is missing, so its expired upload cannot ' +
            'be renewed. Add the file again.',
        },
        { status: 410 },
      )
    }

    return NextResponse.json({
      fileUrl: refreshed.fileUrl,
      reused: false,
      expiresAt: refreshed.expiresAt,
    })
  } catch (error) {
    if (isKieError(error)) {
      return NextResponse.json(
        { error: error.message, kind: error.kind, detail: error.detail },
        { status: error.kind === 'rate_limited' ? 429 : 502 },
      )
    }
    throw error
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const removed = await deleteInputAsset(id)
  if (!removed) return NextResponse.json({ error: 'No such asset.' }, { status: 404 })
  return NextResponse.json({ deleted: id })
}
