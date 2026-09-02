import { NextResponse } from 'next/server'

import { createPrompt, listPrompts, promptTags } from '@/lib/library/queries.ts'

export const dynamic = 'force-dynamic'

/**
 * GET  /api/prompts?q=<search> — saved prompts, with the tag counts.
 * POST /api/prompts            — save one.
 */

export async function GET(request: Request) {
  const search = new URL(request.url).searchParams.get('q') ?? undefined
  const [items, tags] = await Promise.all([listPrompts(search), promptTags()])
  return NextResponse.json({ prompts: items, tags })
}

export async function POST(request: Request) {
  let body: { title?: string; body?: string; tags?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 })
  }

  const text = body.body?.trim()
  if (!text) {
    return NextResponse.json({ error: 'A prompt needs a body.' }, { status: 400 })
  }

  const prompt = await createPrompt({
    // Falls back to the opening words, so saving from a prompt field takes one
    // click rather than a naming decision.
    title: body.title?.trim() || text.slice(0, 60),
    body: text,
    tags: Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === 'string') : [],
  })

  return NextResponse.json({ prompt }, { status: 201 })
}
