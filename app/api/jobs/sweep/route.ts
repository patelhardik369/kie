import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { and, eq, inArray, sql } from 'drizzle-orm'

import { withWorkspace } from '@/lib/auth/route.ts'
import { generations, getDb } from '@/lib/db'
import { sweepWorkspace } from '@/lib/jobs/drive.ts'
import { RESUMABLE_STATES } from '@/lib/jobs/lease.ts'

export const dynamic = 'force-dynamic'
/**
 * Seconds this route may run for. A literal, because Next only accepts a
 * statically analysable number here.
 *
 * 60 is the ceiling on Vercel's Hobby plan without Fluid compute, so it is the
 * value that works everywhere.
 */
export const maxDuration = 60

/**
 * POST /api/jobs/sweep — advance this browser's own due generations.
 *
 * Called once per page load. It exists because **Vercel's Hobby plan will only
 * run a cron job once a day**, which is useless for a twenty-minute video — so a
 * studio that depended on a scheduler would silently lose work for anyone on the
 * free tier. Their generation would be billed by Kie, complete upstream, and
 * never be stored.
 *
 * With this, the worst case with no scheduler at all is that a generation
 * finishes the next time you open the app instead of the moment Kie is done.
 * That is a latency difference, not a data-loss one, which is the distinction
 * that matters.
 *
 * Three things keep it cheap enough to fire on every load:
 *
 *   - It answers immediately and does the work in `waitUntil`, so it never
 *     delays a page.
 *   - It returns without claiming anything when nothing is due — one indexed
 *     count against `(state, next_poll_at)`.
 *   - The lease means three tabs opening at once still produce one poll per job,
 *     rather than three.
 *
 * Scoped to the caller's own workspace: a stranger's page load has no business
 * spending this invocation's budget on someone else's queue.
 */
export async function POST(request: Request) {
  return withWorkspace(request, async ({ workspaceId }) => {
    const now = Date.now()

    // Counted before claiming so the common case — nothing to do — costs one
    // indexed query and no lease traffic at all.
    const [row] = await getDb()
      .select({ n: sql<string>`count(*)` })
      .from(generations)
      .where(
        and(
          eq(generations.workspaceId, workspaceId),
          inArray(generations.state, [...RESUMABLE_STATES]),
          sql`(${generations.nextPollAt} is null or ${generations.nextPollAt} <= ${now})`,
        ),
      )

    const due = Number(row?.n ?? 0)
    if (due > 0) waitUntil(sweepWorkspace(workspaceId))

    return NextResponse.json({ due, swept: due > 0 })
  })
}
