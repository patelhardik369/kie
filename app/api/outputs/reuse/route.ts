import { NextResponse } from 'next/server'

import { resolveOutputAsInput } from '@/lib/library/outputs.ts'
import { isKieError } from '@/lib/kie'

export const dynamic = 'force-dynamic'

/**
 * POST /api/outputs/reuse — `{ assetId }` becomes a URL a model can fetch.
 *
 * The whole "use what I just made as the next input" flow lands here. It is
 * idempotent and cheap to repeat: the second call for the same file inside a day
 * returns the cached upload with `reused: true` and spends no round trip.
 *
 * Deliberately not under `/api/input-assets/`, whose `[id]` segment would make
 * this look like an asset id, and not under `/api/assets/`, whose catch-all
 * serves output FILES by path and would swallow it.
 */
export async function POST(request: Request) {
  let body: { assetId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 })
  }

  const assetId = typeof body.assetId === 'string' ? body.assetId.trim() : ''
  if (!assetId) {
    return NextResponse.json({ error: 'Expected `assetId`.' }, { status: 400 })
  }

  try {
    const outcome = await resolveOutputAsInput(assetId)
    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.message }, { status: outcome.status })
    }

    const { ok: _ok, ...result } = outcome
    return NextResponse.json(result)
  } catch (error) {
    // An upload can fail for every reason any Kie call can — surfaced with the
    // same shape the upload route uses, so the form reports it identically.
    if (isKieError(error)) {
      return NextResponse.json(
        { error: error.message, kind: error.kind, detail: error.detail },
        { status: error.kind === 'rate_limited' ? 429 : 502 },
      )
    }
    throw error
  }
}
