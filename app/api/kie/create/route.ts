import { NextResponse } from 'next/server'

import { submitGeneration } from '@/lib/jobs/submit.ts'
import { getModel, capabilitiesOf } from '@/lib/kie/registry/index.ts'
import { buildRequestInput } from '@/lib/kie/request.ts'
import { validateInput } from '@/lib/kie/validate.ts'

export const dynamic = 'force-dynamic'

/**
 * POST /api/kie/create — submit a generation.
 *
 * Returns as soon as the row exists, BEFORE Kie has been called. The runner may
 * be holding the job behind the rate gate, and the client watches progress
 * through `GET /api/kie/task/[id]`. A route that waited for `createTask` would
 * make the submission gate look like a hung request.
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

  // Inserts the row and hands it to the runner, which owns the lifecycle from
  // here — it survives this request finishing, and the browser closing.
  const { id } = await submitGeneration(model, input, {
    parentId: body.parentId,
    batchId: body.batchId,
    presetId: body.presetId,
    nsfw: body.nsfw === true,
  })

  return NextResponse.json(
    {
      id,
      state: 'waiting',
      model: model.slug,
      capability: model.capability,
      capabilities: capabilitiesOf(model),
      nsfw: body.nsfw === true,
      input,
    },
    { status: 202 },
  )
}
