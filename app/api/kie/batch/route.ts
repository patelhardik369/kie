import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'

import { withStudio } from '@/lib/auth/route.ts'
import { burst } from '@/lib/jobs/drive.ts'
import { newBatchId, submitBatch } from '@/lib/jobs/submit.ts'
import { getModel } from '@/lib/kie/registry/index.ts'
import { buildRequestInput } from '@/lib/kie/request.ts'
import { validateInput } from '@/lib/kie/validate.ts'
import {
  MAX_SWEEP_RUNS,
  SweepError,
  expandSweep,
  type SweepPlan,
} from '@/lib/gallery/sweep.ts'
import { checkQuota } from '@/lib/storage/quota.ts'

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
 * POST /api/kie/batch — submit N generations from one request.
 *
 * Two plans (docs/PRD.md F5):
 *   - `{ kind: 'count', count: 5 }` — five runs, each with its own seed.
 *   - `{ kind: 'values', key: 'cfg_scale', values: [3, 5, 7] }` — one parameter
 *     swept, everything else held fixed.
 *
 * Every run is validated INDEPENDENTLY before anything is written. A sweep can
 * walk a parameter out of its documented range — `n` past the ceiling a
 * constraint lowers, say — and finding that out on run 4 of 5, after paying for
 * three, is the failure this ordering exists to prevent.
 *
 * All rows share one `batch_id`, and one `parent_id` when swept from an
 * existing generation, so the results are comparable afterwards.
 *
 * The storage check is made once for the whole sweep, against the run count.
 * Five videos is the fastest way to hit a 1 GB ceiling, and discovering that on
 * run four — after paying for three — is exactly what checking up front avoids.
 */

/**
 * A rough per-run reservation for the quota check, in bytes.
 *
 * Deliberately a guess, and deliberately generous. Nothing knows how large a
 * video will be until it exists, and the cost of over-estimating is a sweep
 * refused slightly early, where the cost of under-estimating is one that fills
 * the bucket halfway through.
 */
const ESTIMATED_BYTES_PER_RUN = { video: 25 * 1024 * 1024, other: 3 * 1024 * 1024 } as const

interface BatchBody {
  model?: string
  input?: Record<string, unknown>
  plan?: SweepPlan
  /** The generation this sweep varies. Recorded on every run. */
  parentId?: string
  /** Marks every run of the sweep private. */
  nsfw?: boolean
}

export async function POST(request: Request) {
  return withStudio(request, async ({ workspaceId }) => {
    let body: BatchBody
    try {
      body = (await request.json()) as BatchBody
    } catch {
      return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 })
    }

    const model = body.model ? getModel(body.model) : undefined
    if (!model) {
      return NextResponse.json(
        { error: `Unknown model "${body.model ?? ''}".` },
        { status: 400 },
      )
    }

    if (!body.plan) {
      return NextResponse.json(
        { error: 'A batch needs a plan: a run count, or a parameter and its values.' },
        { status: 400 },
      )
    }

    const base = buildRequestInput(model, body.input ?? {})

    let inputs: Record<string, unknown>[]
    try {
      inputs = expandSweep(model, base, body.plan)
    } catch (error) {
      if (error instanceof SweepError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      throw error
    }

    // Validate every run before writing any of them.
    for (const [index, input] of inputs.entries()) {
      const validation = validateInput(model, input)
      if (!validation.ok) {
        return NextResponse.json(
          {
            error:
              inputs.length === 1
                ? 'The request does not satisfy this model.'
                : `Run ${index + 1} of ${inputs.length} does not satisfy this model, ` +
                  'so nothing was submitted.',
            run: index + 1,
            issues: validation.issues,
          },
          { status: 400 },
        )
      }
    }

    const perRun =
      model.outputKind === 'video'
        ? ESTIMATED_BYTES_PER_RUN.video
        : ESTIMATED_BYTES_PER_RUN.other
    const quota = await checkQuota(workspaceId, perRun * inputs.length)
    if (!quota.ok) {
      return NextResponse.json(
        {
          error: quota.message,
          detail:
            `A ${inputs.length}-run sweep needs roughly ` +
            `${Math.round((perRun * inputs.length) / (1024 * 1024))} MB. ` +
            'Nothing was submitted and no credits were spent.',
        },
        { status: 507 },
      )
    }

    const batchId = newBatchId()
    const submitted = await submitBatch(workspaceId, model, inputs, {
      batchId,
      parentId: body.parentId,
      nsfw: body.nsfw === true,
    })

    // Only the first run gets an inline burst. Driving all of them here would
    // hold one invocation open on N concurrent downloads and, worse, would push
    // every submission through the same few seconds — the tick paces the rest
    // under Kie's 20-per-10s ceiling, which is what that limit needs.
    if (submitted[0]) waitUntil(burst(submitted[0].id))

    return NextResponse.json(
      {
        batchId,
        model: model.slug,
        count: submitted.length,
        max: MAX_SWEEP_RUNS,
        ids: submitted.map((s) => s.id),
      },
      { status: 202 },
    )
  })
}
