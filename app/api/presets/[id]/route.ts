import { NextResponse } from 'next/server'

import { deletePreset, getPreset, updatePreset } from '@/lib/library/queries.ts'
import { getModel } from '@/lib/kie/registry/index.ts'
import { applyPreset } from '@/lib/presets/apply.ts'

export const dynamic = 'force-dynamic'

/**
 * GET    /api/presets/[id] — the preset, resolved against the current registry.
 * PATCH  /api/presets/[id] — rename, or overwrite its parameters.
 * DELETE /api/presets/[id]
 *
 * The GET is where drift is handled. It returns the values that still apply
 * PLUS the list of what was dropped, so the form can prefill and say what it
 * could not carry over — never erroring, and never silently swallowing.
 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const preset = await getPreset(id)
  if (!preset) {
    return NextResponse.json({ error: 'No such preset.' }, { status: 404 })
  }

  const model = getModel(preset.modelSlug)
  if (!model) {
    // The whole model is gone from the registry, not just some fields.
    return NextResponse.json({
      preset,
      values: {},
      dropped: [],
      modelMissing: true,
      message:
        `${preset.modelSlug} is no longer in the registry, so this preset cannot ` +
        'be applied. Run /verify-catalog if Kie may have renamed it.',
    })
  }

  const stored = safeParse(preset.paramsJson)
  const applied = applyPreset(model, stored)

  return NextResponse.json({
    preset,
    values: applied.values,
    dropped: applied.dropped,
    clean: applied.clean,
    modelMissing: false,
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let body: { name?: string; params?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 })
  }

  const patch: { name?: string; params?: Record<string, unknown> } = {}
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (body.params && typeof body.params === 'object') patch.params = body.params

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: 'Nothing to update. Send `name` or `params`.' },
      { status: 400 },
    )
  }

  const preset = await updatePreset(id, patch)
  if (!preset) return NextResponse.json({ error: 'No such preset.' }, { status: 404 })
  return NextResponse.json({ preset })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const removed = await deletePreset(id)
  if (!removed) return NextResponse.json({ error: 'No such preset.' }, { status: 404 })
  return NextResponse.json({ deleted: id })
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
