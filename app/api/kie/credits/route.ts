import { NextResponse } from 'next/server'
import { getCredits, isKieError } from '@/lib/kie'
import { recordBalance } from '@/lib/library/queries.ts'

export const dynamic = 'force-dynamic'

/**
 * GET /api/kie/credits — the account's remaining credit balance.
 *
 * A proxy, deliberately: the browser never holds KIE_API_KEY, so every call to
 * Kie goes through a route like this one.
 */
export async function GET() {
  try {
    const credits = await getCredits()

    // Logged so spend has a history: Kie's own logs age out after two months,
    // which makes the local table the only long-term record. `recordBalance`
    // throttles, so a page that polls this does not bury the trend.
    if (typeof credits === 'number' && Number.isFinite(credits)) {
      await recordBalance(credits).catch(() => undefined)
    }

    return NextResponse.json({ credits })
  } catch (error) {
    if (isKieError(error)) {
      return NextResponse.json(
        {
          error: error.message,
          kind: error.kind,
          detail: error.detail,
          retryable: error.retryable,
        },
        // 401/402 are about our server's credentials, not the caller's request.
        { status: error.kind === 'rate_limited' ? 429 : 502 },
      )
    }
    throw error
  }
}
