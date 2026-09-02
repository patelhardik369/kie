import { NextResponse } from 'next/server'

import { RECOVERABLE_STATES } from '@/lib/gallery/display.ts'
import { getRunner } from '@/lib/jobs/runner.ts'
import { parkedCounts } from '@/lib/library/queries.ts'

export const dynamic = 'force-dynamic'

/**
 * GET  /api/kie/recover — how many generations are parked and resumable.
 * POST /api/kie/recover — put all of them back on the poll loop.
 *
 * The bulk form of "Check again". These rows are deliberately excluded from the
 * startup sweep (see `RECOVERABLE_STATES`): a generation that already gave up
 * should not be re-polled on every restart forever. So resuming them is an
 * explicit act, and this is where it happens.
 *
 * Resuming reuses the stored `kie_task_id` — it never resubmits, so it cannot
 * pay for the same generation twice.
 */

export async function GET() {
  return NextResponse.json({ states: RECOVERABLE_STATES, ...(await parkedCounts()) })
}

export async function POST() {
  const resumed = await getRunner().retryAll()
  return NextResponse.json({ resumed: resumed.length, ids: resumed })
}
