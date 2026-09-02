import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { generations, getDb } from '@/lib/db'
import { deleteGeneration } from '@/lib/gallery/delete.ts'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/generations/[id] — the three fields a person edits after the fact.
 *
 * Favorite, notes, and the private mark. Everything else on a generation is a
 * record of what happened — the parameters sent, the state reached, what Kie
 * charged — and making any of it editable would break the promise that a row
 * reproduces its output exactly. These three are annotations ON that record
 * rather than part of it, and `nsfw` governs visibility alone.
 */

interface PatchBody {
  favorite?: boolean
  notes?: string | null
  nsfw?: boolean
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  let body: PatchBody
  try {
    body = (await request.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 })
  }

  const patch: { favorite?: boolean; notes?: string | null; nsfw?: boolean } = {}
  if (typeof body.favorite === 'boolean') patch.favorite = body.favorite
  if (typeof body.nsfw === 'boolean') patch.nsfw = body.nsfw
  if (typeof body.notes === 'string') patch.notes = body.notes.trim() || null
  else if (body.notes === null) patch.notes = null

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: 'Nothing to update. Send `favorite`, `notes` or `nsfw`.' },
      { status: 400 },
    )
  }

  const updated = await getDb()
    .update(generations)
    .set(patch)
    .where(eq(generations.id, id))
    .returning({
      id: generations.id,
      favorite: generations.favorite,
      notes: generations.notes,
      nsfw: generations.nsfw,
    })

  if (updated.length === 0) {
    return NextResponse.json({ error: 'No such generation.' }, { status: 404 })
  }

  return NextResponse.json(updated[0])
}

/**
 * DELETE /api/generations/[id] — throw one generation away, bytes and all.
 *
 * The one destructive route in the app. It removes the row, its asset rows and
 * the files those rows point at, and it refuses while the runner still owns the
 * generation. See lib/gallery/delete.ts for why it is a hard delete rather than
 * a hidden row.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const outcome = await deleteGeneration(id)

  if (!outcome.ok) {
    // 409, not 400: the request is valid and will succeed once the generation
    // stops moving.
    return NextResponse.json(
      { error: outcome.message, reason: outcome.reason },
      { status: outcome.reason === 'not_found' ? 404 : 409 },
    )
  }

  return NextResponse.json(outcome.deleted)
}
