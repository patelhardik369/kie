import { NextResponse } from 'next/server'

import { withStudio } from '@/lib/auth/route.ts'
import { getCredits } from '@/lib/kie'
import { recordBalance } from '@/lib/library/queries.ts'

export const dynamic = 'force-dynamic'

/**
 * GET /api/kie/credits — the remaining balance on the caller's own key.
 *
 * A proxy, deliberately: the browser holds the key but must never talk to Kie
 * directly. Doing so from the page would put the key in a cross-origin request
 * whose response headers we do not control, and would leak it to anything
 * inspecting the network tab of a shared screen.
 *
 * It doubles as the key-validation endpoint. "Test & save" in Settings calls
 * exactly this, because it is the cheapest request that can only succeed with a
 * working key — no credits are spent finding out.
 */
export async function GET(request: Request) {
  return withStudio(request, async ({ workspaceId }) => {
    const credits = await getCredits()

    // Logged so spend has a history: Kie's own logs age out after two months,
    // which makes this table the only long-term record. `recordBalance`
    // throttles, so a page that polls this does not bury the trend.
    if (typeof credits === 'number' && Number.isFinite(credits)) {
      await recordBalance(workspaceId, credits).catch(() => undefined)
    }

    return NextResponse.json({ credits })
  })
}
