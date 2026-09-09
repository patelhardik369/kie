import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'

import { withStudio } from '@/lib/auth/route.ts'
import { burst } from '@/lib/jobs/drive.ts'
import { submitGeneration } from '@/lib/jobs/submit.ts'
import { getModel, capabilitiesOf } from '@/lib/kie/registry/index.ts'
import { buildRequestInput } from '@/lib/kie/request.ts'
import { validateInput } from '@/lib/kie/validate.ts'
import { checkQuota } from '@/lib/storage/quota.ts'

export const dynamic = 'force-dynamic'
/**
 * Seconds this route may run for. The response itself is sent in milliseconds;
 * the rest of the budget belongs to `waitUntil`, which keeps driving the job.
 *
 * A literal, because Next only accepts a statically analysable number here — `'max'` is valid in vercel.json but not
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
 * POST /api/kie/create — submit a generation.
 *
 * Returns as soon as the row exists, BEFORE Kie has been called. The client
 * watches progress through `GET /api/kie/task/[id]`.
 *
 * What is different now that this runs on a serverless host: the row alone is
 * not enough. There is no process left afterwards to poll for the result, so the
 * response is followed by `waitUntil(burst(...))` — the invocation stays alive
 * on its own time and drives the job as far as it can. For a fast image model
 * that is usually all the way to a stored file before the browser polls once.
 * For a twenty-minute video it is a head start, and the cron tick finishes it.
 *
 * The quota check happens here rather than after the result comes back. A run
 * refused now costs nothing; one refused after Kie has billed for it costs
 * credits and produces an output with nowhere to go.
 *
 * Validation happens here rather than at the API boundary alone: a local check
 * can say *why* a payload is wrong, where Kie's 422 only names the field.
 */

interface CreateBody {
  model?: string
  input?: Record<string, unknown>
  /** Lineage: the generation this was re-run or tweaked from. */
  parentId?: string
  /** Groups the rows of one parameter sweep. */
  batchId?: string
  presetId?: string
  /** Marks the run private, keeping it out of Recent and out of the grid. */
  nsfw?: boolean
}

export async function POST(request: Request) {
  return withStudio(request, async ({ workspaceId }) => {
    let body: CreateBody
    try {
      body = (await request.json()) as CreateBody
    } catch {
      return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 })
    }

    const model = body.model ? getModel(body.model) : undefined
    if (!model) {
      return NextResponse.json(
        {
          error: `Unknown model "${body.model ?? ''}".`,
          detail:
            'Slugs are verbatim from the API — check punctuation, or run /verify-catalog ' +
            'if Kie may have added this model since the registry was written.',
        },
        { status: 400 },
      )
    }

    // Documented defaults are NOT applied server-side by Kie, so the same builder
    // the form previews with fills them in here. What is stored is what is sent.
    const input = buildRequestInput(model, body.input ?? {})
    const validation = validateInput(model, input)
    if (!validation.ok) {
      return NextResponse.json(
        { error: 'The request does not satisfy this model.', issues: validation.issues },
        { status: 400 },
      )
    }

    const quota = await checkQuota(workspaceId)
    if (!quota.ok) {
      return NextResponse.json(
        { error: quota.message, detail: 'Nothing was submitted and no credits were spent.' },
        { status: 507 },
      )
    }

    const { id } = await submitGeneration(workspaceId, model, input, {
      parentId: body.parentId,
      batchId: body.batchId,
      presetId: body.presetId,
      nsfw: body.nsfw === true,
    })

    // Deliberately not awaited. `waitUntil` keeps the invocation alive after the
    // response is sent, so the caller is not made to wait on the submission gate
    // — and the job still gets driven rather than sitting untouched until the
    // next tick.
    waitUntil(burst(id))

    return NextResponse.json(
      {
        id,
        state: 'waiting',
        model: model.slug,
        capability: model.capability,
        capabilities: capabilitiesOf(model),
        nsfw: body.nsfw === true,
        input,
        storage: {
          usedBytes: quota.usage.totalBytes,
          quotaBytes: quota.usage.quotaBytes,
          warn: quota.usage.warn,
        },
      },
      { status: 202 },
    )
  })
}
