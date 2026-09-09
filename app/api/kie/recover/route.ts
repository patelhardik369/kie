import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'

import { sealCurrentKeyFor } from '@/lib/auth/kie-key.ts'
import { withStudio, withWorkspace } from '@/lib/auth/route.ts'
import { RECOVERABLE_STATES } from '@/lib/gallery/display.ts'
import { driveOne, retryAll } from '@/lib/jobs/drive.ts'
import { parkedCounts } from '@/lib/library/queries.ts'

export const dynamic = 'force-dynamic'
/**
 * Seconds this route may run for. A literal, because Next only accepts a
 * statically analysable number here — `'max'` is valid in vercel.json but not
 * in a route segment config.
 *
 * 60 is the ceiling on Vercel's Hobby plan without Fluid compute, so it is the
 * value that works everywhere. On Pro, or with Fluid enabled, raising it to 300
 * lets a single invocation carry a long video further before handing back to the
 * cron — nothing breaks either way, because the job's position lives in the
 * database rather than on the stack.
 */
export const maxDuration = 60

/**
 * GET  /api/kie/recover — how many generations are parked and resumable.
 * POST /api/kie/recover — put all of them back in the queue.
 *
 * The bulk form of "Check again". These rows are deliberately excluded from the
 * ordinary tick sweep (see `RECOVERABLE_STATES`): a generation that already gave
 * up should not be re-polled forever on a timer. So resuming them is an explicit
 * act, and this is where it happens.
 *
 * Resuming reuses the stored `kie_task_id` — it never resubmits, so it cannot
 * pay for the same generation twice. It also re-seals the key from this request
 * onto every row it touches, which is what makes recovery work after an
 * `APP_ENCRYPTION_KEY` rotation left the old sealed keys unreadable.
 */

export async function GET(request: Request) {
  return withWorkspace(request, async ({ workspaceId }) =>
    NextResponse.json({
      states: RECOVERABLE_STATES,
      ...(await parkedCounts(workspaceId)),
    }),
  )
}

export async function POST(request: Request) {
  return withStudio(request, async ({ workspaceId }) => {
    const resumed = await retryAll(workspaceId, (id) => sealCurrentKeyFor(id))

    // A nudge for the first few, so a small backlog clears without waiting on
    // the cron. The rest are due immediately and the next tick takes them —
    // driving all of them here would hold one invocation open on an unbounded
    // number of downloads.
    for (const id of resumed.slice(0, 3)) waitUntil(driveOne(id))

    return NextResponse.json({ resumed: resumed.length, ids: resumed })
  })
}
