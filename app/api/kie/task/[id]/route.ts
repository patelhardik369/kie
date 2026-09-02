import { NextResponse } from 'next/server'
import { asc, eq } from 'drizzle-orm'

import { assets, generations, getDb } from '@/lib/db'
import { getRunner } from '@/lib/jobs/runner.ts'

export const dynamic = 'force-dynamic'

/**
 * GET  /api/kie/task/[id] — the current state of one generation, for display.
 * POST /api/kie/task/[id] — resume a generation that stopped short.
 *
 * The client polls GET purely to render. It drives nothing: the runner owns the
 * poll loop, so two open tabs cost Kie the same one request per task as none,
 * and closing the browser does not stop the job.
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()

  const rows = await db.select().from(generations).where(eq(generations.id, id)).limit(1)
  const generation = rows[0]
  if (!generation) {
    return NextResponse.json({ error: 'No such generation.' }, { status: 404 })
  }

  const files = await db
    .select()
    .from(assets)
    .where(eq(assets.generationId, id))
    .orderBy(asc(assets.idx))

  return NextResponse.json({
    id: generation.id,
    state: generation.state,
    modelSlug: generation.modelSlug,
    family: generation.family,
    capability: generation.capability,
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
      // Served through /api/assets, never as a filesystem path.
      url: `/api/assets/${encodePath(asset.localPath)}`,
      localPath: asset.localPath,
      mime: asset.mime,
      bytes: asset.bytes,
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
      layerMeta: asset.layerMeta ? safeParse(asset.layerMeta) : null,
    })),
  })
}

/**
 * Resumes a `stalled` poll or a `needs_retry` download.
 *
 * Reuses the stored `kie_task_id` rather than resubmitting — the generation was
 * already paid for, and a second createTask would pay for it twice.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const resumed = await getRunner().retry(id)

  if (!resumed) {
    return NextResponse.json(
      { error: 'That generation is finished or does not exist.' },
      { status: 409 },
    )
  }
  return NextResponse.json({ id, state: 'waiting', resumed: true })
}

/** Each segment encoded separately so the slashes survive as separators. */
function encodePath(localPath: string): string {
  return localPath.split('/').map(encodeURIComponent).join('/')
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}
