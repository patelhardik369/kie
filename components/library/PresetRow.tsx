'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { formatTimestamp } from '@/lib/gallery/display.ts'

/**
 * One saved preset.
 *
 * The drift warning is the point: when the registry has moved under a preset,
 * this says exactly which fields will not carry over BEFORE you apply it. The
 * alternative — applying silently and letting the user wonder why the form
 * looks wrong — is the failure mode docs/PRD.md F6 exists to prevent.
 */
export function PresetRow({
  id,
  name,
  modelSlug,
  summary,
  updatedAt,
  applicable,
  droppedCount,
  droppedMessages,
}: {
  id: string
  name: string
  modelSlug: string
  summary: string
  updatedAt: number
  applicable: boolean
  droppedCount: number
  droppedMessages: string[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const remove = async () => {
    setBusy(true)
    try {
      const response = await fetch(`/api/presets/${id}`, { method: 'DELETE' })
      if (response.ok) router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-medium">{name}</span>
        <span className="font-mono text-[11px] text-(--color-ink-muted)">
          {formatTimestamp(updatedAt)}
        </span>
      </div>

      <p className="mt-1 truncate font-mono text-xs text-(--color-ink-muted)">{summary}</p>

      {droppedCount > 0 && (
        <details className="mt-2 rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1.5">
          <summary className="cursor-pointer text-xs text-amber-300">
            {droppedCount} field{droppedCount === 1 ? '' : 's'} will be dropped —
            the registry has changed since this was saved
          </summary>
          <ul className="mt-1.5 space-y-1">
            {droppedMessages.map((message) => (
              <li key={message} className="text-[11px] text-(--color-ink-muted)">
                {message}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {applicable ? (
          <Link
            href={`/generate/${modelSlug}?preset=${id}`}
            className="rounded-md border border-(--color-border) px-2.5 py-1 text-xs transition hover:border-(--color-ink-muted)"
          >
            Apply in Studio
          </Link>
        ) : (
          <span className="text-xs text-(--color-ink-muted)">
            Cannot be applied — {modelSlug} is not in the registry.
          </span>
        )}
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="rounded-md border border-(--color-border) px-2.5 py-1 text-xs text-(--color-ink-muted) transition hover:border-red-400 hover:text-red-400 disabled:opacity-40"
        >
          {busy ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </li>
  )
}
