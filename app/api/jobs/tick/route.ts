import crypto from 'node:crypto'
import { NextResponse } from 'next/server'

import { getEnv } from '@/lib/env'
import { TICK_BATCH, tick } from '@/lib/jobs/drive.ts'
import { dueCount } from '@/lib/jobs/lease.ts'

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
 * POST /api/jobs/tick — advance every generation that is due.
 *
 * **The safety net, and the only driver that works when nobody is watching.**
 * The other two — the inline burst on submit, and an open tab's status poll —
 * both depend on somebody being there. A twenty-minute video started at 4pm and
 * abandoned needs this, or it never finishes and the credits are simply gone.
 *
 * So this endpoint wants to be called about once a minute. Three ways to do it,
 * and the first is the one to reach for on a free plan:
 *
 *   1. **Supabase `pg_cron` + `pg_net`.** The database is already there, cron on
 *      it is free, and it runs at whatever interval you ask for. See
 *      docs/DEPLOYMENT.md.
 *   2. **Vercel Cron**, via the entry in `vercel.json`. Frequency limits differ
 *      by plan, so check yours before relying on it as the only driver.
 *   3. **Any external cron** — cron-job.org, a GitHub Action, an uptime monitor.
 *      It is one authenticated POST with no body.
 *
 * Whichever calls it, overlapping invocations are safe: the claim is atomic and
 * two ticks running at once take disjoint work rather than colliding.
 *
 * GET is accepted as well as POST because several cron services only issue GETs.
 */

export async function POST(request: Request) {
  return handle(request)
}

export function GET(request: Request) {
  return handle(request)
}

async function handle(request: Request): Promise<Response> {
  if (!authorized(request)) {
    // 404, not 401: an unauthenticated caller learns nothing about whether this
    // endpoint exists, and there is no legitimate caller to help with a hint.
    return new NextResponse('Not found', { status: 404 })
  }

  const report = await tick(batchSize(request))
  const remaining = await dueCount()

  return NextResponse.json({
    ...report,
    /**
     * Jobs still due after this batch. A cron that sees this stay high is a cron
     * running too slowly for the queue, and raising `?batch=` or the frequency
     * is the fix — better said in the response than discovered from a gallery
     * full of stuck rows.
     */
    remaining,
    batch: batchSize(request),
  })
}

/**
 * Bearer `CRON_SECRET`.
 *
 * Compared in constant time, and length-checked first because
 * `timingSafeEqual` throws on a mismatch rather than returning false.
 *
 * `x-vercel-cron` is accepted as well: Vercel's own scheduler sets it on
 * requests it originates, and those never carry a header you configured.
 */
function authorized(request: Request): boolean {
  if (request.headers.get('x-vercel-cron')) return true

  const header = request.headers.get('authorization') ?? ''
  const offered = header.replace(/^Bearer\s+/i, '').trim()
  if (!offered) return false

  const expected = Buffer.from(getEnv().cronSecret)
  const actual = Buffer.from(offered)
  if (expected.length !== actual.length) return false
  return crypto.timingSafeEqual(expected, actual)
}

/** `?batch=` raises the batch for a backlog. Clamped so one tick stays bounded. */
function batchSize(request: Request): number {
  const raw = new URL(request.url).searchParams.get('batch')
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 1) return TICK_BATCH
  return Math.min(Math.floor(parsed), 25)
}
