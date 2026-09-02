'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { stateLabel } from '@/lib/gallery/display.ts'

/**
 * "Resume all" for generations parked in a recoverable state.
 *
 * These rows are excluded from the startup sweep on purpose — a generation that
 * already gave up should not be re-polled on every restart — so the only way
 * they move is someone asking, either per-generation in the gallery or here for
 * the whole set at once.
 *
 * Resuming reuses each stored `kie_task_id`, so it costs nothing: the work was
 * already paid for, and this only goes back to look at it.
 */
export function ResumeParked({
  total,
  byState,
}: {
  total: number
  byState: Record<string, number>
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const resume = async () => {
    setBusy(true)
    setResult(null)
    try {
      const response = await fetch('/api/kie/recover', { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error ?? 'Could not resume.')
      setResult(
        data.resumed === 0
          ? 'Nothing left to resume.'
          : `Resumed ${data.resumed} generation${data.resumed === 1 ? '' : 's'} — watch the gallery for progress.`,
      )
      router.refresh()
    } catch (cause) {
      setResult(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (total === 0) {
    return (
      <p className="mt-3 text-xs text-(--color-ink-muted)">
        Nothing is parked. Stalled polls and failed downloads would show up here.
      </p>
    )
  }

  return (
    <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/5 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="font-mono">{total}</span> generation
          {total === 1 ? '' : 's'} stopped short —{' '}
          {Object.entries(byState)
            .map(([state, n]) => `${n} ${stateLabel(state).toLowerCase()}`)
            .join(', ')}
          .
        </div>
        <button
          type="button"
          onClick={resume}
          disabled={busy}
          className="rounded-md border border-amber-300/60 px-3 py-2 text-sm text-amber-300 transition hover:bg-amber-400/10 disabled:opacity-40"
        >
          {busy ? 'Resuming…' : 'Resume all'}
        </button>
      </div>
      <p className="mt-2 text-[11px] text-(--color-ink-muted)">
        Each one resumes from its existing Kie task — nothing is resubmitted, so
        this cannot spend credits twice.
      </p>
      {result && <p className="mt-2 text-xs text-(--color-ink-muted)">{result}</p>}
    </div>
  )
}
