import { NextResponse } from 'next/server'

import { createPreset, listPresets } from '@/lib/library/queries.ts'
import { getModel } from '@/lib/kie/registry/index.ts'
import { presetableValues } from '@/lib/presets/apply.ts'

export const dynamic = 'force-dynamic'

/**
 * GET  /api/presets?model=<slug> — presets, optionally for one model.
 * POST /api/presets               — save the current parameters under a name.
 *
 * Presets are model-scoped and stored as a partial input. They are deliberately
 * NOT validated on save beyond stripping asset URLs: the registry moves, and a
 * preset that was legal when saved should still load later with whatever no
 * longer applies reported rather than refused (docs/PRD.md F6).
 */

export async function GET(request: Request) {
  const modelSlug = new URL(request.url).searchParams.get('model') ?? undefined
  return NextResponse.json({ presets: await listPresets(modelSlug) })
}

interface CreateBody {
  name?: string
  model?: string
  params?: Record<string, unknown>
  /**
   * Whether runs from this preset start marked private.
   *
   * Sent alongside `params` rather than inside it: it is a studio setting, not
   * a model parameter, and it never reaches Kie.
   */
  nsfw?: boolean
}

export async function POST(request: Request) {
  let body: CreateBody
  try {
    body = (await request.json()) as CreateBody
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 })
  }

  const name = body.name?.trim()
  if (!name) {
    return NextResponse.json({ error: 'A preset needs a name.' }, { status: 400 })
  }

  const model = body.model ? getModel(body.model) : undefined
  if (!model) {
    return NextResponse.json(
      { error: `Unknown model "${body.model ?? ''}".` },
      { status: 400 },
    )
  }

  // Asset URLs are stripped here: a Kie upload dies after about 24 hours, so a
  // preset carrying one would apply cleanly and then fail at submit.
  const params = presetableValues(model, body.params ?? {})
  const preset = await createPreset({
    name,
    modelSlug: model.slug,
    params,
    nsfw: body.nsfw === true,
  })

  return NextResponse.json({ preset, savedKeys: Object.keys(params) }, { status: 201 })
}
