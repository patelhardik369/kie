'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Star } from '@/components/shell/icons.tsx'

/**
 * What you can do with a past generation.
 *
 * **Re-run identical** resubmits the stored `input_json` verbatim and records
 * this generation as the new one's parent — the click that makes a past result
 * reproducible (docs/PRD.md F5). It deliberately does not reuse the Kie task:
 * that task's output is already on disk, and a re-run is meant to produce a new
 * one.
 *
 * **Tweak** opens the Studio prefilled, so changing one thing is one click plus
 * one edit.
 */
export function GenerationActions({
  id,
  modelSlug,
  input,
  favorite: initialFavorite,
  nsfw: initialNsfw,
  notes: initialNotes,
}: {
  id: string
  modelSlug: string
  input: Record<string, unknown>
  favorite: boolean
  nsfw: boolean
  notes: string | null
}) {
  const router = useRouter()
  const [favorite, setFavorite] = useState(initialFavorite)
  const [nsfw, setNsfw] = useState(initialNsfw)
  const [notes, setNotes] = useState(initialNotes ?? '')
  const [savedNotes, setSavedNotes] = useState(initialNotes ?? '')
  const [rerunning, setRerunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patch = async (body: Record<string, unknown>) => {
    const response = await fetch(`/api/generations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error('Could not save.')
  }

  const toggleFavorite = async () => {
    const next = !favorite
    setFavorite(next)
    try {
      await patch({ favorite: next })
    } catch {
      setFavorite(!next)
    }
  }

  /**
   * Marking is retroactive as well as up-front: you do not always know what a
   * model will give you until you see it. Unmarking is the same toggle, because
   * a mark applied by mistake must be as easy to undo as it was to make.
   */
  const togglePrivate = async () => {
    const next = !nsfw
    setNsfw(next)
    try {
      await patch({ nsfw: next })
      // The grid this page came from now sorts this row differently.
      router.refresh()
    } catch {
      setNsfw(!next)
      setError('Could not change the private mark.')
    }
  }

  const saveNotes = async () => {
    if (notes === savedNotes) return
    try {
      await patch({ notes })
      setSavedNotes(notes)
    } catch {
      setError('Could not save the note.')
    }
  }

  const rerun = async () => {
    setRerunning(true)
    setError(null)
    try {
      const response = await fetch('/api/kie/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Verbatim, and parented — this is what forms the lineage.
        // The mark rides along: a re-run of private work is private work.
        body: JSON.stringify({ model: modelSlug, input, parentId: id, nsfw }),
      })
      const data = await response.json()
      if (!response.ok) {
        const issues: string[] = (data?.issues ?? []).map(
          (issue: { key?: string; message: string }) =>
            issue.key ? `${issue.key}: ${issue.message}` : issue.message,
        )
        throw new Error([data?.error, ...issues].filter(Boolean).join(' '))
      }
      router.push(`/gallery/${data.id}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setRerunning(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={rerun}
          disabled={rerunning}
          className="btn btn-primary"
        >
          {rerunning ? 'Submitting…' : 'Re-run identical'}
        </button>

        <Link
          href={`/generate/${modelSlug}?from=${id}`}
          className="btn btn-ghost"
        >
          Tweak
        </Link>

        <button
          type="button"
          onClick={toggleFavorite}
          aria-pressed={favorite}
          className={`rounded-md border px-3 py-2 text-sm transition ${
            favorite
              ? 'border-(--color-warn)/60 bg-(--color-warn)/10 text-(--color-warn)'
              : 'border-(--color-border) text-(--color-ink-muted) hover:border-(--color-ink-muted)'
          }`}
        >
          <Star size={13} filled={favorite} />
          {favorite ? 'Favorited' : 'Favorite'}
        </button>

        <button
          type="button"
          onClick={togglePrivate}
          aria-pressed={nsfw}
          title={
            nsfw
              ? 'Hidden from Recent and from the unfiltered gallery.'
              : 'Hide this from Recent and from the gallery grid.'
          }
          className={`rounded-md border px-3 py-2 text-sm transition ${
            nsfw
              ? 'border-(--color-private)/60 bg-(--color-private)/10 text-(--color-private)'
              : 'border-(--color-border) text-(--color-ink-muted) hover:border-(--color-ink-muted)'
          }`}
        >
          {nsfw ? 'NSFW — private' : 'Mark private'}
        </button>
      </div>

      {nsfw && (
        <p className="rounded border-l-2 border-(--color-private) bg-(--color-private)/10 px-3 py-2 text-xs text-(--color-ink-muted)">
          Hidden from Recent and from the gallery grid. It appears under the
          gallery&rsquo;s <span className="text-(--color-private)">NSFW</span> filter, and
          here, where you asked for it by id. A re-run or tweak stays private too.
        </p>
      )}

      {error && (
        <p className="rounded border-l-2 border-(--color-bad) bg-(--color-bad)/10 px-3 py-2 text-sm text-(--color-bad)">
          {error}
        </p>
      )}

      <label className="block">
        <span className="text-xs text-(--color-ink-muted)">Notes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          rows={2}
          placeholder="What were you trying here?"
          className="input mt-1 resize-y"
        />
        <span className="text-[11px] text-(--color-ink-muted)">
          {notes === savedNotes ? 'Saved' : 'Unsaved — click away to save'}
        </span>
      </label>
    </div>
  )
}
