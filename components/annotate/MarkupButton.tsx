'use client'

import { useEffect, useState } from 'react'

import { Pen } from '@/components/shell/icons.tsx'
import { MarkupEditor, type MarkupResult } from './MarkupEditor.tsx'

/**
 * The affordance on an image row: draw on this picture instead of describing it.
 *
 * Sits beside Reuse and Upload, and appears wherever the registry says it can —
 * any image-accepting field on a model that has a prompt to name the marks in.
 * `components/param-form/controls.tsx` decides that from `lib/annotate/targets.ts`;
 * nothing here knows which model it is rendering.
 *
 * Disabled with no URL, because there is nothing to draw on yet. Saying so in
 * the tooltip rather than hiding the button keeps the affordance discoverable —
 * otherwise it only ever appears after you have already solved the problem it
 * exists to help with.
 */
export function MarkupButton({
  url,
  disabled,
  canPair,
  onResult,
}: {
  url: string
  disabled?: boolean
  /** Whether this field has room to also carry the clean original. */
  canPair: boolean
  onResult: (result: MarkupResult) => void
}) {
  const [open, setOpen] = useState(false)
  const [marked, setMarked] = useState(false)

  const ready = url.trim().length > 0

  /*
   * Whether the image in this field already carries marks.
   *
   * Worth one small request: "Edit marks" and "Mark up" are different promises,
   * and an image whose pixels already have a red circle burned into them is
   * something you want to know before you send it somewhere.
   *
   * Debounced, because this URL changes on every keystroke while somebody
   * pastes one, and `cancelled` guards the race where a slow first answer
   * arrives after a fast second one.
   */
  useEffect(() => {
    if (!ready || !/^https?:\/\//i.test(url.trim())) {
      setMarked(false)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch(
            `/api/annotate/context?url=${encodeURIComponent(url.trim())}`,
            { cache: 'no-store' },
          )
          const data = await response.json()
          if (!cancelled) setMarked(response.ok && Boolean(data?.annotationJson))
        } catch {
          if (!cancelled) setMarked(false)
        }
      })()
    }, 400)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [url, ready])

  return (
    <>
      <button
        type="button"
        disabled={disabled || !ready}
        onClick={() => setOpen(true)}
        title={
          !ready
            ? 'Add an image first, then draw on it to show the model exactly what to change'
            : marked
              ? 'This image already carries marks — reopen and adjust them'
              : 'Draw on this image to show the model exactly what to change'
        }
        className={`btn btn-sm shrink-0 text-xs ${
          marked ? 'border-(--color-accent-line) text-(--color-accent)' : 'btn-ghost'
        }`}
      >
        <Pen size={12} />
        {marked ? 'Edit marks' : 'Mark up'}
      </button>

      {open && (
        <MarkupEditor
          url={url.trim()}
          canPair={canPair}
          onClose={() => setOpen(false)}
          onSave={(result) => {
            setOpen(false)
            setMarked(true)
            onResult(result)
          }}
        />
      )}
    </>
  )
}
