import Link from 'next/link'

import { PromptLibrary } from '@/components/library/PromptLibrary.tsx'
import { listPrompts, parseTags, promptTags } from '@/lib/library/queries.ts'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Prompts — Kie Studio' }

/**
 * The prompt library: saved, taggable text insertable into any prompt field
 * (docs/PRD.md F8).
 */
export default async function PromptsPage() {
  const [rows, tags] = await Promise.all([listPrompts(), promptTags()])

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="border-b border-(--color-border) pb-5">
        <Link href="/" className="text-sm text-(--color-ink-muted) hover:underline">
          ← Kie Studio
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Prompts</h1>
        <p className="mt-1.5 text-sm text-(--color-ink-muted)">
          Saved text, insertable into any prompt field from the generation form.
        </p>
      </header>

      <div className="mt-6">
        <PromptLibrary
          initialPrompts={rows.map((p) => ({
            id: p.id,
            title: p.title,
            body: p.body,
            tags: parseTags(p.tagsJson),
            createdAt: p.createdAt,
          }))}
          allTags={tags}
        />
      </div>
    </main>
  )
}
