import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'

import { withStudio, withWorkspace } from '@/lib/auth/route.ts'
import { getDb, inputAssets } from '@/lib/db'
import { refreshUpload } from '@/lib/jobs/uploads.ts'
import { deleteInputAsset } from '@/lib/library/queries.ts'
import { removeObjects } from '@/lib/storage/objects.ts'

export const dynamic = 'force-dynamic'

/**
 * POST /api/input-assets/[id] — hand back a URL a model can actually fetch.
 *
 * This is the whole point of the asset library (docs/PRD.md F7):
 *
 *   - **Inside 24h** the cached `kie_file_url` is returned as-is. No upload, no
 *     round trip — reusing the same reference image across ten generations
 *     costs one upload, not ten.
 *   - **Past that** our own copy is re-uploaded and the row updated in place,
 *     transparently. The caller cannot tell the difference except by `reused`.
 *
 * Keeping our own copy is what makes the second case possible at all. Without
 * it an expired asset would be unrecoverable, since the browser that supplied
 * it is long gone.
 */

/** Re-upload slightly before expiry, so a URL cannot die between here and submit. */
const EXPIRY_MARGIN_MS = 5 * 60_000

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withStudio(request, async ({ workspaceId }) => {
    const { id } = await params

    const [asset] = await getDb()
      .select()
      .from(inputAssets)
      .where(and(eq(inputAssets.id, id), eq(inputAssets.workspaceId, workspaceId)))
      .limit(1)

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

    const refreshed = await refreshUpload(id, workspaceId)
    if (!refreshed) {
      return NextResponse.json(
        {
          error:
            'The stored copy of this asset is missing, so its expired upload cannot ' +
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
  })
}

/**
 * DELETE /api/input-assets/[id] — forget an input, and reclaim its bytes.
 *
 * The object goes with the row. On a 1 GB plan an orphaned object is not
 * untidiness, it is quota spent on something nothing can reach any more.
 *
 * Objects under a generation's own output key are the exception, and are left
 * alone: an output reused as an input shares the output's key rather than
 * getting a copy (see lib/jobs/uploads.ts), so removing it here would delete a
 * gallery item's file out from under it. Only `_inputs/` objects are this row's
 * to delete.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withWorkspace(request, async ({ workspaceId }) => {
    const { id } = await params
    const removed = await deleteInputAsset(workspaceId, id)
    if (!removed) return NextResponse.json({ error: 'No such asset.' }, { status: 404 })

    const ownsObject = removed.storagePath.startsWith(`${workspaceId}/_inputs/`)
    if (ownsObject) {
      // Not fatal. The row is already gone, and a stray object can be swept
      // later — where a library entry pointing at nothing cannot be.
      await removeObjects([removed.storagePath]).catch((error) => {
        console.error('[kie-studio] could not remove input object:', error)
      })
    }

    return NextResponse.json({
      deleted: id,
      bytesFreed: ownsObject ? (removed.bytes ?? 0) : 0,
    })
  })
}
