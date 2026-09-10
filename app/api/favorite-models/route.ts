import { NextResponse } from 'next/server'

import { withWorkspace } from '@/lib/auth/route.ts'
import { addPin, listPins, removePin, reorderPins } from '@/lib/library/pins.ts'
import { getModel } from '@/lib/kie/registry/index.ts'

export const dynamic = 'force-dynamic'

/**
 * Pinned models — the shortlist above the 86.
 *
 *   GET    /api/favorite-models              — the pins, in order
 *   POST   /api/favorite-models {slug}       — pin one (idempotent)
 *   DELETE /api/favorite-models?slug=<slug>  — unpin one
 *   PATCH  /api/favorite-models {order:[…]}  — reorder
 *
 * Every verb answers with the COMPLETE list. The pin bar renders on four
 * surfaces at once and each of them holds the same client store; returning the
 * whole list means a write is a replace, not a patch that each caller has to
 * apply correctly. The payload is a few dozen bytes per pin — there is nothing
 * to save by being clever here.
 *
 * The label and family come from the compiled registry, resolved server-side.
 * That is deliberate: it keeps the 86-model registry — every parameter of every
 * model — out of the browser bundle, so a nav popover costs a fetch rather than
 * a few hundred kilobytes of JavaScript.
 */

export async function GET(request: Request) {
  return withWorkspace(request, async ({ workspaceId }) =>
    NextResponse.json({ favorites: await listPins(workspaceId) }),
  )
}

export async function POST(request: Request) {
  return withWorkspace(request, async ({ workspaceId }) => {
    let body: { slug?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 })
    }

    const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
    if (!slug) {
      return NextResponse.json({ error: 'A pin needs a model slug.' }, { status: 400 })
    }

    /*
     * Checked against the registry on the way IN, never on the way out. Pinning a
     * slug that does not exist is a typo and is refused; a slug that stops
     * existing later is a registry change and is kept, flagged `missing`. Those
     * are different situations and they get different answers.
     */
    if (!getModel(slug)) {
      return NextResponse.json(
        {
          error: `No model with the slug "${slug}". Slugs are verbatim from the API — check the punctuation.`,
        },
        { status: 404 },
      )
    }

    return NextResponse.json({ favorites: await addPin(workspaceId, slug) })
  })
}

export async function DELETE(request: Request) {
  return withWorkspace(request, async ({ workspaceId }) => {
    const slug = new URL(request.url).searchParams.get('slug')?.trim()
    if (!slug) {
      return NextResponse.json({ error: 'Expected ?slug=<model slug>.' }, { status: 400 })
    }
    // No existence check: unpinning a model the registry has forgotten is exactly
    // how a stale pin gets cleaned up.
    return NextResponse.json({ favorites: await removePin(workspaceId, slug) })
  })
}

export async function PATCH(request: Request) {
  return withWorkspace(request, async ({ workspaceId }) => {
    let body: { order?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 })
    }

    if (!Array.isArray(body.order) || body.order.some((s) => typeof s !== 'string')) {
      return NextResponse.json(
        { error: 'Expected `order` to be an array of model slugs.' },
        { status: 400 },
      )
    }

    return NextResponse.json({
      favorites: await reorderPins(workspaceId, body.order as string[]),
    })
  })
}
