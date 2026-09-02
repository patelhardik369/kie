import { NextResponse } from 'next/server'

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

export const dynamic = 'force-dynamic'

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
 */

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

  const batchId = newBatchId()
  const submitted = await submitBatch(model, inputs, {
    batchId,
    parentId: body.parentId,
    nsfw: body.nsfw === true,
  })

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
}
