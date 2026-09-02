'use client'

import { useMemo, useState } from 'react'

import { formatTimestamp } from '@/lib/gallery/display.ts'

/**
 * Browse, add, edit and delete saved prompts.
 *
 * Filtering happens in the browser: the prompt library is small by nature, and
 * a round trip per keystroke would be slower than the list is long.
 */

export interface PromptItem {
  id: string
  title: string
  body: string
  tags: string[]
  createdAt: number
}

const inputClass =
  'w-full rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm ' +
  'outline-none transition focus:border-(--color-accent)'

export function PromptLibrary({
  initialPrompts,
  allTags,
}: {
  initialPrompts: PromptItem[]
  allTags: { tag: string; count: number }[]
}) {
  const [prompts, setPrompts] = useState(initialPrompts)
  const [search, setSearch] = useState('')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const prompt of prompts) {
      for (const tag of prompt.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
    return counts.size > 0
      ? [...counts.entries()]
          .map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count)
      : allTags
  }, [prompts, allTags])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return prompts.filter((prompt) => {
      if (activeTag && !prompt.tags.includes(activeTag)) return false
      if (!term) return true
      return (
        prompt.title.toLowerCase().includes(term) ||
        prompt.body.toLowerCase().includes(term) ||
        prompt.tags.some((tag) => tag.includes(term))
      )
    })
  }, [prompts, search, activeTag])

  const save = async () => {
    if (!body.trim()) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          body,
          tags: tagInput.split(',').map((t) => t.trim()).filter(Boolean),
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error ?? 'Could not save.')

      setPrompts((prev) => [
        {
          id: data.prompt.id,
          title: data.prompt.title,
          body: data.prompt.body,
          tags: JSON.parse(data.prompt.tagsJson),
          createdAt: data.prompt.createdAt,
        },
        ...prev,
      ])
      setTitle('')
      setBody('')
      setTagInput('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    const previous = prompts
    setPrompts((prev) => prev.filter((p) => p.id !== id))
    const response = await fetch(`/api/prompts/${id}`, { method: 'DELETE' })
    // Put it back rather than lie about what was deleted.
    if (!response.ok) setPrompts(previous)
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2 rounded-lg border border-(--color-border) bg-(--color-surface-raised) p-4">
        <h2 className="text-sm font-medium">Save a prompt</h2>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional — the opening words are used if blank)"
          className={inputClass}
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="The prompt text"
          className={`${inputClass} resize-y`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="tags, comma separated"
            className={`${inputClass} flex-1`}
          />
          <button
            type="button"
            onClick={save}
            disabled={saving || !body.trim()}
            className="rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-black transition hover:opacity-90 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search prompts…"
          aria-label="Search prompts"
          className={`${inputClass} min-w-56 flex-1`}
        />
        {tags.map(({ tag, count }) => (
          <button
            key={tag}
            type="button"
            onClick={() => setActiveTag(activeTag === tag ? null : tag)}
            aria-pressed={activeTag === tag}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${
              activeTag === tag
                ? 'border-(--color-accent) bg-(--color-accent)/15'
                : 'border-(--color-border) text-(--color-ink-muted) hover:border-(--color-ink-muted)'
            }`}
          >
            {tag} <span className="font-mono">{count}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-(--color-border) px-4 py-10 text-center text-sm text-(--color-ink-muted)">
          {prompts.length === 0 ? 'No saved prompts yet.' : 'Nothing matches.'}
        </p>
      ) : (
        <ul className="divide-y divide-(--color-border) overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface-raised)">
          {visible.map((prompt) => (
            <li key={prompt.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-medium">{prompt.title}</span>
                <span className="font-mono text-[11px] text-(--color-ink-muted)">
                  {formatTimestamp(prompt.createdAt)}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed whitespace-pre-wrap text-(--color-ink-muted)">
                {prompt.body}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {prompt.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded border border-(--color-border) px-1.5 py-0.5 font-mono text-[11px] text-(--color-ink-muted)"
                  >
                    {tag}
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => void navigator.clipboard?.writeText(prompt.body)}
                  className="ml-auto rounded-md border border-(--color-border) px-2 py-0.5 text-xs text-(--color-ink-muted) transition hover:border-(--color-ink-muted)"
                >
                  Copy
                </button>
                <button
                  type="button"
                  onClick={() => void remove(prompt.id)}
                  className="rounded-md border border-(--color-border) px-2 py-0.5 text-xs text-(--color-ink-muted) transition hover:border-red-400 hover:text-red-400"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
