import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { and, asc, eq } from 'drizzle-orm'

import { sealCurrentKeyFor } from '@/lib/auth/kie-key.ts'
import { withStudio, withWorkspace } from '@/lib/auth/route.ts'
import { assets, generations, getDb } from '@/lib/db'
import { assetUrl } from '@/lib/gallery/asset-token.ts'
import { driveOne, retry } from '@/lib/jobs/drive.ts'

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
 * GET  /api/kie/task/[id] — the current state of one generation, for display.
 * POST /api/kie/task/[id] — resume a generation that stopped short.
 *
 * The GET used to drive nothing: a long-lived runner owned the poll loop, and
 * two open tabs cost Kie the same one request as none. There is no such runner
 * any more, so this route now nudges the job as well — one step, under a lease,
 * after the response has been sent.
 *
 * That does not reintroduce the double-poll the old design avoided. The lease is
 * what prevents it: two tabs watching the same generation both call `driveOne`,
 * one takes the lease and polls, the other finds it held and returns
 * immediately. What it buys is that anything you are actually looking at makes
 * progress at the rate you are watching it, without waiting for the next tick.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withWorkspace(request, async ({ workspaceId }) => {
    const { id } = await params
    const db = getDb()

    const [generation] = await db
      .select()
      .from(generations)
      .where(and(eq(generations.id, id), eq(generations.workspaceId, workspaceId)))
      .limit(1)

    if (!generation) {
      return NextResponse.json({ error: 'No such generation.' }, { status: 404 })
    }

    const files = await db
      .select()
      .from(assets)
      .where(eq(assets.generationId, id))
      .orderBy(asc(assets.idx))

    // After the read, so the response reflects the state as it was rather than
    // racing a step that is about to change it. `waitUntil` keeps it off the
    // response's critical path entirely.
    if (isDrivable(generation.state)) waitUntil(driveOne(id))

    return NextResponse.json({
      id: generation.id,
      state: generation.state,
      modelSlug: generation.modelSlug,
      family: generation.family,
      capability: generation.capability,
      // Carried so the Tweak flow inherits the mark: a variation on private work
      // is private work, and having to remember to re-tick it is how it leaks.
      nsfw: generation.nsfw,
      // The exact object sent to Kie — the whole point of storing it verbatim.
      input: safeParse(generation.inputJson),
      failCode: generation.failCode,
      failMsg: generation.failMsg,
      creditsConsumed: generation.creditsConsumed,
      costTimeMs: generation.costTimeMs,
      pollAttempts: generation.pollAttempts,
      createdAt: generation.createdAt,
      submittedAt: generation.submittedAt,
      completedAt: generation.completedAt,
      assets: files.map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        // Served through /api/assets, which redirects to a signed Supabase URL.
        // Null for an output too large to store — the UI offers `remoteUrl`
        // instead, with the fourteen-day warning attached.
        url: assetUrl(asset.storagePath),
        storagePath: asset.storagePath,
        storageState: asset.storageState,
        remoteUrl: asset.storageState === 'stored' ? null : asset.remoteUrl,
        mime: asset.mime,
        bytes: asset.bytes,
        width: asset.width,
        height: asset.height,
        durationMs: asset.durationMs,
        layerMeta: asset.layerMeta ? safeParse(asset.layerMeta) : null,
      })),
    })
  })
}

/**
 * Resumes a `stalled` poll or a `needs_retry` store.
 *
 * Reuses the stored `kie_task_id` rather than resubmitting — the generation was
 * already paid for, and a second createTask would pay for it twice.
 *
 * The key from THIS request is re-sealed onto the row. That is what makes
 * "Check again" work on a job whose stored key was wiped or could not be
 * unsealed after an `APP_ENCRYPTION_KEY` rotation: the browser asking to resume
 * is holding a perfectly good key, and this is the moment to hand it over.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withStudio(request, async ({ workspaceId }) => {
    const { id } = await params
    const resumed = await retry(id, workspaceId, sealCurrentKeyFor(id))

    if (!resumed) {
      return NextResponse.json(
        { error: 'That generation is finished or does not exist.' },
        { status: 409 },
      )
    }

    waitUntil(driveOne(id))
    return NextResponse.json({ id, state: 'waiting', resumed: true })
  })
}

/** States a step could still move. Anything else is a wasted claim query. */
function isDrivable(state: string): boolean {
  return (
    state === 'waiting' ||
    state === 'queuing' ||
    state === 'generating' ||
    state === 'downloading' ||
    state === 'needs_retry'
  )
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}
