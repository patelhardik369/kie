'use client'

import { useEffect, useState } from 'react'

import { studioFetch, errorMessage, isCredentialProblem } from '@/lib/client/api.ts'
import { hasApiKey } from '@/lib/client/credentials.ts'

/**
 * The Kie credit balance.
 *
 * A client component, and it has to be. The balance belongs to whichever key
 * this browser holds, and the server has no way to know that key at render time
 * — the page is rendered before any request carrying it has been made. The old
 * version read it server-side because there was one key in the environment; with
 * a key per browser, that number would either be wrong or be somebody else's.
 *
 * Spend history stays on the server, because that comes from our own rows and is
 * a property of the workspace rather than of the key.
 */

type State =
  | { status: 'loading' }
  | { status: 'no-key' }
  | { status: 'ok'; credits: number | null }
  | { status: 'failed'; message: string; credentials: boolean }

export function CreditsCard({ fallback }: { fallback: number | null }) {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    if (!hasApiKey()) {
      setState({ status: 'no-key' })
      return
    }

    studioFetch<{ credits: number | null }>('/api/kie/credits', { cache: 'no-store' })
      .then((result) => {
        if (!cancelled) setState({ status: 'ok', credits: result.credits ?? null })
      })
      .catch((error) => {
        if (cancelled) return
        setState({
          status: 'failed',
          message: errorMessage(error),
          credentials: isCredentialProblem(error),
        })
      })

    return () => {
      cancelled = true
    }
  }, [])

  const value =
    state.status === 'ok' && state.credits !== null
      ? state.credits.toLocaleString()
      : state.status === 'loading'
        ? '…'
        : fallback !== null
          ? fallback.toLocaleString()
          : '—'

  return (
    <div>
      <div className="text-2xl font-semibold tracking-[-0.02em] text-(--color-ink)">
        {value}
      </div>
      <div className="mt-0.5 text-[11px] text-(--color-ink-faint)">{hint(state, fallback)}</div>

      {state.status === 'failed' ? (
        <p className="note note-warn mt-2 text-[11px]">
          {state.credentials
            ? 'Kie rejected the key saved in this browser. Replace it above.'
            : `Could not reach Kie: ${state.message}`}
        </p>
      ) : null}
    </div>
  )
}

function hint(state: State, fallback: number | null): string {
  switch (state.status) {
    case 'loading':
      return 'asking Kie…'
    case 'no-key':
      return 'add a key to see your balance'
    case 'ok':
      return 'live from Kie, on your own key'
    case 'failed':
      return fallback !== null ? 'last recorded reading' : 'unavailable'
  }
}
