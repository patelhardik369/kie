import { NextResponse } from 'next/server'

import { resolveSource } from '@/lib/annotate/resolve.ts'
import { withWorkspace } from '@/lib/auth/route.ts'

export const dynamic = 'force-dynamic'

/**
 * GET /api/annotate/context?url=… — everything the editor needs before it opens.
 *
 * Separate from `/api/annotate/source`, which returns pixels, because these are
 * two different things with two different lifetimes: the bytes go into an
 * `<img>` and can be cached, while this is a small JSON fact. Carrying the
 * document in a header on the byte response was the alternative, and a
 * stroke-heavy annotation is far past what a response header can hold.
 *
 * The route answers one question rather than exposing rows: **what should be
 * drawn on, and what can be sent afterwards.** Keeping that decision on the
 * server means the branch that matters — a field already holding an annotated
 * image must be re-edited on the CLEAN original, never on the flattened copy,
 * or every reopen burns another layer of circles into the pixels — lives in one
 * place instead of being reconstructed by the client from three nullable fields.
 */
export async function GET(request: Request) {
  return withWorkspace(request, async ({ workspaceId }) => {
    const url = new URL(request.url).searchParams.get('url')
    if (!url) {
      return NextResponse.json({ error: 'Expected a `url` parameter.' }, { status: 400 })
    }

    const resolved = await resolveSource(workspaceId, url)
    const reEditing = resolved.sourceAssetId !== null

    return NextResponse.json({
      /** Whether we hold the bytes ourselves. The editor says so when we do not. */
      stored: resolved.storagePath !== null,
      /** The saved marks, when this image already has some. */
      annotationJson: resolved.annotationJson,
      /**
       * What to draw on. `assetId` set means re-editing: load the clean
       * original by id, because its own 24-hour URL may be long gone.
       */
      base: {
        assetId: resolved.sourceAssetId,
        mime: reEditing ? resolved.sourceMime : resolved.mime,
      },
      /**
       * The clean original, for "also send the unmarked photo".
       *
       * `fileUrl` null with an `assetId` present is not a failure — it means the
       * upload expired and the client should ask `/api/input-assets/<id>` to
       * re-issue one from our stored copy.
       */
      clean: {
        assetId: resolved.sourceAssetId,
        fileUrl: resolved.sourceFileUrl,
      },
      /** The row these bytes belong to, so a re-save knows what it replaced. */
      inputAssetId: resolved.inputAssetId,
    })
  })
}
