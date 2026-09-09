'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { hasApiKey } from '@/lib/client/credentials.ts'
import { ApiKeyForm } from './ApiKeyForm.tsx'

/**
 * The prompt shown on the generate screen when this browser has no key yet.
 *
 * Deliberately **not** a modal over the whole app. Someone who has just arrived
 * should be able to read the model catalogue, look at what the studio does and
 * decide whether it is worth signing up for anything — a full-screen wall
 * demanding a credential before showing a single pixel is how a tool loses
 * people who would have used it. So the block lands only where a key is actually
 * required: the moment before spending credits.
 *
 * It renders nothing until mounted. `hasApiKey` reads `localStorage`, which does
 * not exist during the server render — checking it before mount would either
 * flash the gate at people who have a key, or hydrate into a mismatch.
 */

export function ApiKeyGate({ children }: { children?: React.ReactNode }) {
  const [state, setState] = useState<'unknown' | 'missing' | 'present'>('unknown')

  useEffect(() => {
    setState(hasApiKey() ? 'present' : 'missing')
  }, [])

  if (state === 'unknown') return null
  if (state === 'present') return <>{children}</>

  return (
    <section className="rounded-lg border border-(--color-accent-line) bg-(--color-accent-softer) p-4">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-(--color-ink)">
        Add your Kie API key to generate
      </h2>
      <p className="mt-1.5 max-w-prose text-[13px] leading-relaxed text-(--color-ink-muted)">
        This studio has no key of its own — you bring yours, it is saved in this
        browser, and generations are billed to your own Kie account. Nothing is
        stored on the server except while a job is running.
      </p>

      <div className="mt-3">
        <ApiKeyForm autoFocus allowRemove={false} onSaved={() => setState('present')} />
      </div>

      <p className="mt-3 text-[13px] text-(--color-ink-muted)">
        Don&apos;t have one yet?{' '}
        <Link
          href="/welcome"
          className="text-(--color-accent-strong) underline decoration-dotted underline-offset-2"
        >
          Here is how to create one
        </Link>{' '}
        — it takes about two minutes.
      </p>
    </section>
  )
}
