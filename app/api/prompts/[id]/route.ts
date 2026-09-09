import { NextResponse } from 'next/server'

import { withWorkspace } from '@/lib/auth/route.ts'
import { deletePrompt, updatePrompt } from '@/lib/library/queries.ts'

export const dynamic = 'force-dynamic'

/** PATCH / DELETE one saved prompt. */

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withWorkspace(request, async ({ workspaceId }) => {
    const { id } = await params

    let body: { title?: string; body?: string; tags?: string[] }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 })
    }

    const prompt = await updatePrompt(workspaceId, id, {
      title: typeof body.title === 'string' ? body.title.trim() : undefined,
      body: typeof body.body === 'string' ? body.body : undefined,
      tags: Array.isArray(body.tags)
        ? body.tags.filter((t): t is string => typeof t === 'string')
        : undefined,
    })

    if (!prompt) return NextResponse.json({ error: 'No such prompt.' }, { status: 404 })
    return NextResponse.json({ prompt })
  })
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withWorkspace(request, async ({ workspaceId }) => {
    const { id } = await params
    const removed = await deletePrompt(workspaceId, id)
    if (!removed) return NextResponse.json({ error: 'No such prompt.' }, { status: 404 })
    return NextResponse.json({ deleted: id })
  })
}
