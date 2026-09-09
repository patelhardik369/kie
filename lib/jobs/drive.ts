import 'server-only'

import { and, eq, inArray } from 'drizzle-orm'

import { generations, getDb } from '../db/index.ts'
import { RECOVERABLE_STATES } from '../gallery/display.ts'
import { step, stepClaimed, type StepOutcome } from './engine.ts'
import { claimDue, RESUMABLE_STATES, workerId } from './lease.ts'

/**
 * The three things that make jobs move.
 *
 * A step (lib/jobs/engine.ts) advances one generation once. Something has to
 * keep calling it, and on a serverless host there is no process that outlives a
 * request to do it. So instead of one driver there are three, layered so that
 * each covers the case the one above it cannot:
 *
 *   1. **`burst`** — runs on the request that submitted the job, inside
 *      `waitUntil`, for as long as the invocation is allowed to live. This is
 *      what makes a fast image model feel instant: it is usually finished and
 *      stored before the browser's first status poll.
 *   2. **`driveOne`** — one step, called by an open tab's status poll. Free
 *      progress for anything the user is actually looking at.
 *   3. **`tick`** — a batch of due jobs, called by cron. The safety net. It is
 *      the only one that works when nobody is watching, so a twenty-minute
 *      video finishes whether or not the tab that started it still exists.
 *
 * All three are the same step under a lease, which is why none of them needs to
 * know the others exist.
 */

/** How long an inline burst may keep working before it must let go. */
const BURST_BUDGET_MS = 45_000

/** Jobs one tick will try to advance. Bounded to fit the invocation's budget. */
export const TICK_BATCH = 8

/** How long a whole tick may run before it stops claiming more work. */
const TICK_BUDGET_MS = 50_000

/**
 * Works one generation for as long as the invocation can afford to.
 *
 * Called inside `waitUntil`, so it keeps running after the response has been
 * sent. It stops on a settled job, on a step that asked to be called back later
 * than the budget allows, or when the budget runs out — and whatever it leaves
 * behind is picked up by the next tick, because the position is in the database
 * rather than on this stack.
 *
 * Never throws: it runs detached, where an unhandled rejection is a crashed
 * invocation and a log nobody reads.
 */
export async function burst(id: string, budgetMs = BURST_BUDGET_MS): Promise<void> {
  const owner = workerId()
  const deadline = Date.now() + budgetMs

  try {
    for (;;) {
      const outcome: StepOutcome = await step(id, owner)

      if (outcome.status === 'settled') return
      if (outcome.status === 'skipped') return

      const waitFor = outcome.nextPollAt - Date.now()
      // Handing back to the tick is the right answer whenever the next look is
      // further away than this invocation will be alive for.
      if (Date.now() + Math.max(waitFor, 0) >= deadline) return

      if (waitFor > 0) await sleep(waitFor)
    }
  } catch (error) {
    console.error(`[kie-studio] burst ${id} failed:`, error)
  }
}

/**
 * One step, for a caller that wants progress but not a wait.
 *
 * The status route calls this on every poll. It is cheap when there is nothing
 * to do — a claim that matches no row is one indexed UPDATE — and it means a
 * user staring at a generation is, in effect, driving it.
 */
export async function driveOne(id: string): Promise<StepOutcome> {
  try {
    return await step(id)
  } catch (error) {
    console.error(`[kie-studio] step ${id} failed:`, error)
    return { status: 'skipped', reason: 'leased' }
  }
}

export interface TickReport {
  claimed: number
  settled: number
  progressed: number
  failed: number
  /** True when the batch was cut short by the time budget rather than emptied. */
  truncated: boolean
  ms: number
}

/**
 * Advances every generation that is due, up to a batch.
 *
 * The claim is atomic, so two ticks overlapping — a cron firing while a previous
 * one still runs — take disjoint work rather than colliding. Jobs are stepped
 * concurrently because each is dominated by waiting on Kie or on a download, and
 * doing eight of those in series would not fit in one invocation.
 */
export async function tick(batch = TICK_BATCH): Promise<TickReport> {
  const startedAt = Date.now()
  const owner = workerId()
  const report: TickReport = {
    claimed: 0,
    settled: 0,
    progressed: 0,
    failed: 0,
    truncated: false,
    ms: 0,
  }

  const claimed = await claimDue(batch, owner)
  report.claimed = claimed.length

  const results = await Promise.allSettled(
    claimed.map((generation) => stepClaimed(generation, owner)),
  )

  for (const result of results) {
    if (result.status === 'rejected') {
      report.failed += 1
      console.error('[kie-studio] tick step failed:', result.reason)
      continue
    }
    if (result.value.status === 'settled') report.settled += 1
    else if (result.value.status === 'progressed') report.progressed += 1
  }

  report.truncated = Date.now() - startedAt >= TICK_BUDGET_MS
  report.ms = Date.now() - startedAt
  return report
}

/**
 * Re-arms a generation that stopped short — a `stalled` poll or a `needs_retry`
 * store.
 *
 * The task id is kept, so this resumes rather than resubmitting and paying for
 * the generation twice. `sealedKey` re-arms a job whose stored key was wiped or
 * could not be unsealed; it comes from the browser that is asking.
 *
 * `submittedAt` is pushed forward deliberately. The poll budget is measured from
 * submission, so a job that stalled at twenty minutes would poll once and stall
 * again — "check again" has to mean more than one look.
 */
export async function retry(
  id: string,
  workspaceId: string,
  sealedKey?: string | null,
): Promise<boolean> {
  const db = getDb()

  const [generation] = await db
    .select({ state: generations.state })
    .from(generations)
    .where(and(eq(generations.id, id), eq(generations.workspaceId, workspaceId)))
    .limit(1)

  if (!generation) return false
  if (generation.state === 'complete' || generation.state === 'failed') return false

  await db
    .update(generations)
    .set({
      state: 'waiting',
      pollAttempts: 0,
      submittedAt: Date.now(),
      nextPollAt: Date.now(),
      leaseOwner: null,
      leaseExpiresAt: null,
      ...(sealedKey ? { kieKeyEnc: sealedKey } : {}),
    })
    .where(and(eq(generations.id, id), eq(generations.workspaceId, workspaceId)))

  return true
}

/**
 * Resumes every generation of one workspace parked in a recoverable state.
 *
 * The bulk form of "Check again", for the case a whole batch stalled at once — a
 * cron that was not configured, or a network drop that took out several polls
 * together.
 */
export async function retryAll(
  workspaceId: string,
  sealedKeyFor?: (id: string) => string | null,
): Promise<string[]> {
  const rows = await getDb()
    .select({ id: generations.id })
    .from(generations)
    .where(
      and(
        eq(generations.workspaceId, workspaceId),
        inArray(generations.state, [...RECOVERABLE_STATES]),
      ),
    )

  const resumed: string[] = []
  for (const row of rows) {
    if (await retry(row.id, workspaceId, sealedKeyFor?.(row.id))) resumed.push(row.id)
  }
  return resumed
}

/** Generations of one workspace that a driver could still advance. */
export async function inFlightCount(workspaceId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: generations.id })
    .from(generations)
    .where(
      and(
        eq(generations.workspaceId, workspaceId),
        inArray(generations.state, [...RESUMABLE_STATES]),
      ),
    )
  return rows.length
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
