'use client'

import { useEffect, useState } from 'react'

import { studioFetch, errorMessage } from '@/lib/client/api.ts'
import {
  getApiKey,
  looksLikeKieKey,
  maskKey,
  setApiKey,
} from '@/lib/client/credentials.ts'

/**
 * Entering, testing, replacing and removing the Kie API key.
 *
 * Two decisions worth naming:
 *
 *   - **It tests the key before saving it.** A key is only ever wrong in one
 *     way — it does not work — and finding that out here, against the credits
 *     endpoint, costs one request and no credits. Finding it out the other way
 *     means a generation that sits in `waiting` and then fails with a 401 the
 *     user has to go and interpret.
 *   - **A saved key is never redisplayed by default.** It shows as a mask, with
 *     a reveal for the moment you need to check which key it is. The value is in
 *     this browser and readable from the console by anyone who has the machine;
 *     what the mask prevents is the ordinary case — read over a shoulder, or
 *     captured in a screen share.
 */

export interface ApiKeyFormProps {
  /** Called after a key is saved, so a gate can close itself. */
  onSaved?: () => void
  allowRemove?: boolean
  autoFocus?: boolean
}

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'ok'; credits: number | null }
  | { status: 'failed'; message: string }

const inputClass =
  'w-full rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 font-mono text-sm ' +
  'outline-none transition focus:border-(--color-accent)'

export function ApiKeyForm({
  onSaved,
  allowRemove = true,
  autoFocus = false,
}: ApiKeyFormProps) {
  const [saved, setSaved] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  const [reveal, setReveal] = useState(false)

  // Read in an effect, not in the initial state: `localStorage` does not exist
  // during the server render, and reading it there is a hydration mismatch.
  useEffect(() => {
    setSaved(getApiKey())
  }, [])

  const trimmed = draft.trim().replace(/^Bearer\s+/i, '')
  const plausible = trimmed.length > 0 && looksLikeKieKey(trimmed)

  async function save(andTest: boolean) {
    if (!plausible) return

    if (andTest) {
      setTest({ status: 'testing' })
      try {
        // Sent explicitly rather than left to the interceptor: the key being
        // tested is the one in the box, which is not yet the one in storage.
        const result = await studioFetch<{ credits: number | null }>(
          '/api/kie/credits',
          { headers: { 'x-kie-key': trimmed }, cache: 'no-store' },
        )
        setTest({ status: 'ok', credits: result.credits ?? null })
      } catch (error) {
        setTest({ status: 'failed', message: errorMessage(error) })
        return
      }
    }

    if (!setApiKey(trimmed)) {
      setTest({ status: 'failed', message: 'That does not look like an API key.' })
      return
    }
    setSaved(trimmed)
    setDraft('')
    onSaved?.()
  }

  return (
    <div className="space-y-3">
      {saved ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2">
          <span className="text-[11px] uppercase tracking-wide text-(--color-ink-faint)">
            Saved in this browser
          </span>
          <code className="font-mono text-[13px] text-(--color-ink)">
            {reveal ? saved : maskKey(saved)}
          </code>
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            className="text-[11px] text-(--color-ink-muted) underline decoration-dotted hover:text-(--color-ink)"
          >
            {reveal ? 'hide' : 'reveal'}
          </button>
          {allowRemove ? (
            <button
              type="button"
              onClick={() => {
                setApiKey(null)
                setSaved(null)
                setTest({ status: 'idle' })
              }}
              className="ml-auto text-[11px] text-(--color-bad-ink) underline decoration-dotted"
            >
              Remove
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="password"
          value={draft}
          autoFocus={autoFocus}
          onChange={(e) => {
            setDraft(e.target.value)
            setTest({ status: 'idle' })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && plausible) void save(true)
          }}
          placeholder={saved ? 'Replace with a different key…' : 'Paste your Kie API key'}
          spellCheck={false}
          autoComplete="off"
          className={`min-w-0 flex-1 ${inputClass}`}
        />
        <button
          type="button"
          disabled={!plausible || test.status === 'testing'}
          onClick={() => void save(true)}
          className="shrink-0 rounded-md bg-(--color-accent) px-4 py-2 text-[13px] font-medium text-(--color-accent-ink) transition disabled:opacity-40"
        >
          {test.status === 'testing' ? 'Checking…' : 'Test & save'}
        </button>
      </div>

      {trimmed.length > 0 && !plausible ? (
        <p className="text-[13px] text-(--color-bad-ink)">
          That does not look like a key — it should be one unbroken string with no
          spaces. Check you copied all of it.
        </p>
      ) : null}

      {test.status === 'failed' ? (
        <div className="space-y-2 rounded-md border border-(--color-bad)/40 bg-(--color-bad)/8 px-3 py-2">
          <p className="text-[13px] text-(--color-bad-ink)">{test.message}</p>
          <button
            type="button"
            onClick={() => void save(false)}
            className="text-[11px] text-(--color-ink-muted) underline decoration-dotted hover:text-(--color-ink)"
          >
            Save it anyway
          </button>
        </div>
      ) : null}

      {test.status === 'ok' ? (
        <p className="text-[13px] text-(--color-ok-ink)">
          Key works
          {test.credits !== null
            ? ` — ${test.credits.toLocaleString()} credits available.`
            : '.'}
        </p>
      ) : null}
    </div>
  )
}
