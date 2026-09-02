import { PromptLibrary } from '@/components/library/PromptLibrary.tsx'
import { PageHeader } from '@/components/shell/PageHeader.tsx'
import { listPrompts, parseTags, promptTags } from '@/lib/library/queries.ts'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Prompts' }

/**
 * The prompt library: saved, taggable text insertable into any prompt field
 * (docs/PRD.md F8).
 */
export default async function PromptsPage() {
  const [rows, tags] = await Promise.all([listPrompts(), promptTags()])

  return (
    <main className="mx-auto max-w-4xl px-4 pt-6 pb-16">
      <PageHeader
        title="Prompts"
        description="Saved text, insertable into any prompt field from the generation form."
      />

      <div>
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
