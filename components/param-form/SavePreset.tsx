'use client'

import Link from 'next/link'
import { useState } from 'react'

import { presetableValues } from '@/lib/presets/apply.ts'
import type { ModelDefinition } from '@/lib/kie/registry/types.ts'

/**
 * Save the current parameters as a named, model-scoped preset.
 *
 * Asset URLs are excluded before saving — a Kie upload dies after about a day,
 * so a preset carrying one would apply cleanly and then fail at submit with a
 * dead link. The count shown is what will actually be stored, so there is no
 * surprise later about what a preset does and does not capture.
 */
export function SavePreset({
  model,
  values,
}: {
  model: ModelDefinition
  values: Record<string, unknown>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const storable = presetableValues(model, values)
  const count = Object.keys(storable).length
  const excluded = Object.keys(values).length - count

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, model: model.slug, params: storable }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error ?? 'Could not save the preset.')

      setSaved(data.preset.name)
      setName('')
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  if (saved) {
    return (
      <p className="text-xs text-(--color-ink-muted)">
        Saved as <span className="text-(--color-ink)">{saved}</span> ·{' '}
        <Link href="/presets" className="underline hover:text-(--color-ink)">
          all presets
        </Link>{' '}
        ·{' '}
        <button
          type="button"
          onClick={() => setSaved(null)}
          className="underline hover:text-(--color-ink)"
        >
          save another
        </button>
      </p>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={count === 0}
        title={count === 0 ? 'Nothing to save yet.' : undefined}
        className="text-xs text-(--color-ink-muted) underline transition hover:text-(--color-ink) disabled:cursor-not-allowed disabled:opacity-40"
      >
        Save as preset
      </button>
    )
  }

  return (
    <div className="w-full space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') setOpen(false)
          }}
          autoFocus
          placeholder="Preset name"
          className="min-w-48 flex-1 rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-sm outline-none transition focus:border-(--color-accent)"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving || !name.trim()}
          className="rounded-md border border-(--color-accent) px-3 py-1.5 text-xs transition hover:bg-(--color-accent)/10 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-(--color-border) px-3 py-1.5 text-xs text-(--color-ink-muted) transition hover:border-(--color-ink-muted)"
        >
          Cancel
        </button>
      </div>

      <p className="text-[11px] text-(--color-ink-muted)">
        {count} parameter{count === 1 ? '' : 's'} will be saved
        {excluded > 0 && (
          <>
            {' '}
            — {excluded} asset field{excluded === 1 ? '' : 's'} excluded, because
            uploaded URLs expire after about a day
          </>
        )}
        .
      </p>
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  )
}
