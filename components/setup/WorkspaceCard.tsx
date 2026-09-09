'use client'

import { useEffect, useState } from 'react'

import { adoptWorkspaceId, getWorkspaceId, isWorkspaceId } from '@/lib/client/credentials.ts'

/**
 * Showing, copying and adopting a workspace id.
 *
 * The workspace id is the whole of "which generations are mine". There is no
 * account to recover it from, so this card is the recovery mechanism: copy the
 * string, keep it somewhere, paste it into another browser to see the same
 * studio there.
 *
 * The consequence of it being a bearer secret is stated plainly rather than
 * buried. Someone who is handed this string gets the gallery — that is what it
 * is for, and it is also exactly why it should not be pasted into a group chat.
 *
 * Adopting one reloads the page rather than updating state. Server components
 * read the workspace from a cookie at render time, so everything already on
 * screen belongs to the old workspace; re-rendering only the parts React knows
 * about would leave a gallery showing one studio and a sidebar counting another.
 */

export function WorkspaceCard() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<'idle' | 'importing'>('idle')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setWorkspaceId(getWorkspaceId())
  }, [])

  async function copy() {
    if (!workspaceId) return
    try {
      await navigator.clipboard.writeText(workspaceId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setError('The clipboard is blocked here — select the id and copy it by hand.')
    }
  }

  function adopt() {
    const value = draft.trim()
    if (!isWorkspaceId(value)) {
      setError('That is not a workspace id. They look like wk_ followed by 32 hex characters.')
      return
    }
    if (!adoptWorkspaceId(value)) {
      setError('Could not save that id — this browser may be blocking site data.')
      return
    }
    window.location.reload()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2">
        <span className="text-[11px] uppercase tracking-wide text-(--color-ink-faint)">
          This workspace
        </span>
        <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-(--color-ink)">
          {workspaceId ?? '…'}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          disabled={!workspaceId}
          className="shrink-0 text-[11px] text-(--color-ink-muted) underline decoration-dotted hover:text-(--color-ink) disabled:opacity-40"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>

      <p className="max-w-prose text-[13px] leading-relaxed text-(--color-ink-muted)">
        Your gallery, presets and prompts belong to this id. It was generated in
        this browser and exists nowhere else, so{' '}
        <strong className="text-(--color-ink)">
          keep a copy if you care about the work
        </strong>{' '}
        — clearing site data without one leaves the generations in the database
        with nothing able to find them. Anyone you give the string to sees the
        same studio, so treat it like a password, not a username.
      </p>

      {mode === 'idle' ? (
        <button
          type="button"
          onClick={() => {
            setMode('importing')
            setError(null)
          }}
          className="text-[13px] text-(--color-ink-muted) underline decoration-dotted hover:text-(--color-ink)"
        >
          Use a workspace id from another browser
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={draft}
              autoFocus
              onChange={(e) => {
                setDraft(e.target.value)
                setError(null)
              }}
              placeholder="wk_…"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 font-mono text-sm outline-none transition focus:border-(--color-accent)"
            />
            <button
              type="button"
              onClick={adopt}
              className="shrink-0 rounded-md border border-(--color-border) px-4 py-2 text-[13px] text-(--color-ink)"
            >
              Switch
            </button>
          </div>
          <p className="text-[12px] text-(--color-ink-faint)">
            Switching does not delete anything. The current workspace stays in the
            database — paste its id back in to return to it.
          </p>
        </div>
      )}

      {error ? <p className="text-[13px] text-(--color-bad-ink)">{error}</p> : null}
    </div>
  )
}
