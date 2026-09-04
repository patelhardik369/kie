'use client'

import { useState } from 'react'

import { Check, Layers } from '@/components/shell/icons.tsx'

/**
 * Hand this output to the next generation, as a URL.
 *
 * The counterpart to the picker in the parameter form: that one is for "I am
 * filling a field and want something I already have", this one is for "I am
 * looking at the thing I want and know where it is going next". Both end at the
 * same place — `POST /api/outputs/reuse`, one upload, cached for a day.
 *
 * What lands on the clipboard is a Kie `fileUrl`, NOT the local `/api/assets`
 * link beside it. The local link is for a browser on this machine; a model needs
 * a URL Kie's servers can fetch, and pasting the wrong one produces a generation
 * that fails minutes later with a download error.
 */
export function UseAsInput({ assetId }: { assetId: string }) {
  const [state, setState] = useState<'idle' | 'working' | 'done'>('idle')
  const [url, setUrl] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setState('working')
    setError(null)
    setNote(null)
    try {
      const response = await fetch('/api/outputs/reuse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error ?? 'Could not prepare this output.')

      setUrl(data.fileUrl)
      setState('done')
      setNote(
        data.warning ??
          (data.reused
            ? 'Already uploaded and still live — no round trip was spent.'
            : 'Uploaded to Kie. The URL is good for about a day, and re-using it before then costs nothing.'),
      )

      try {
        await navigator.clipboard.writeText(data.fileUrl)
      } catch {
        // Clipboard permission can be refused. The URL is shown below either
        // way, so the copy is a convenience and never the only path.
        setNote('Copied to the box below — the clipboard was not available.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setState('idle')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void run()}
        disabled={state === 'working'}
        title="Upload this output to Kie and copy a URL a model can read"
        className="btn btn-ghost btn-sm text-xs"
      >
        {state === 'done' ? <Check size={11} /> : <Layers size={11} />}
        {state === 'working' ? 'Preparing…' : state === 'done' ? 'Copied' : 'Use as input'}
      </button>

      {(url || error) && (
        <span className="basis-full pt-1.5">
          {error ? (
            <span className="note note-bad block px-2 py-1.5 text-[11px]">{error}</span>
          ) : (
            <>
              <input
                readOnly
                value={url ?? ''}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Input URL for this output"
                className="input py-1 font-mono text-[11px]"
              />
              {note && (
                <span className="mt-1 block text-[11px] text-(--color-ink-muted)">{note}</span>
              )}
            </>
          )}
        </span>
      )}
    </>
  )
}
