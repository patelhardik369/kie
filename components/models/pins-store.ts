'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'

import { move, type PinnedModel } from '@/lib/models/favorites.ts'

/**
 * The pinned-model list, shared by every star and every pin bar on the page.
 *
 * A module-level store rather than a context provider, for one reason: the stars
 * are rendered by SERVER components (the picker's 82 rows, the model page
 * header, the nav), and a provider would force each of those trees to become a
 * client component just to carry state through. A module singleton crosses those
 * boundaries without touching them — the only shared thing is the import.
 *
 * It survives client-side navigation, so moving between /generate, /models and a
 * model page costs one fetch for the whole session, not one per screen.
 *
 * Every mutation is optimistic and then RECONCILED against the server's answer,
 * which is always the complete list. The optimistic step is what makes a star
 * feel like a checkbox; the reconciliation is what stops two tabs drifting.
 */

export interface PinsSnapshot {
  /** null until the first load lands. Distinct from "loaded, and empty". */
  pins: PinnedModel[] | null
  /** The last failed write, surfaced rather than swallowed. */
  error: string | null
}

const EMPTY: PinsSnapshot = { pins: null, error: null }

let snapshot: PinsSnapshot = EMPTY
let loaded = false
let inFlight: Promise<void> | null = null

const listeners = new Set<() => void>()

function publish(next: PinsSnapshot) {
  snapshot = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * The server render always sees "not loaded yet".
 *
 * It must be the SAME object every call — React compares snapshots by identity
 * and a fresh literal here is an infinite render loop, not a re-render.
 */
function serverSnapshot(): PinsSnapshot {
  return EMPTY
}

function readSnapshot(): PinsSnapshot {
  return snapshot
}

async function send(
  path: string,
  init: RequestInit,
  previous: PinnedModel[] | null,
): Promise<void> {
  try {
    const response = await fetch(path, { cache: 'no-store', ...init })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data?.error ?? 'Could not save that pin.')
    loaded = true
    publish({ pins: data.favorites ?? [], error: null })
  } catch (cause) {
    // Reverted to what was on screen before the click, with the reason attached.
    // A pin that silently springs back is indistinguishable from a misclick.
    publish({
      pins: previous,
      error: cause instanceof Error ? cause.message : String(cause),
    })
  }
}

/** Loads once per page load. Concurrent callers share the one request. */
function ensureLoaded(): Promise<void> {
  if (loaded) return Promise.resolve()
  inFlight ??= (async () => {
    try {
      const response = await fetch('/api/favorite-models', { cache: 'no-store' })
      const data = await response.json()
      loaded = true
      publish({ pins: data.favorites ?? [], error: null })
    } catch {
      // A failed LOAD is not worth a message: nothing was lost, the stars simply
      // stay neutral, and the next mutation reports its own failure properly.
      loaded = true
      publish({ pins: [], error: null })
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

/**
 * Seeds the store from a server render, so the first paint is already correct.
 *
 * Deliberately does NOT notify listeners: it is called from a component body
 * during render, and publishing there would be a state update inside someone
 * else's render. Assigning the snapshot is enough — anything rendered after the
 * hydrator reads the new value in the same pass, and React re-checks the
 * snapshot after commit for anything rendered before it.
 *
 * First writer wins. A page that arrives by client-side navigation with a stale
 * server payload must not overwrite pins the user has changed since.
 */
export function hydratePins(pins: PinnedModel[]): void {
  // Never on the server. This module is a singleton per PROCESS there, shared by
  // every request, and `useSyncExternalStore` reads `serverSnapshot()` during SSR
  // regardless — so writing here would only leave one request's pins sitting in
  // server memory for the life of the process, doing nothing.
  if (typeof window === 'undefined') return
  if (loaded) return
  loaded = true
  snapshot = { pins, error: null }
}

/** What a star knows about the model it sits beside, for the optimistic insert. */
export interface PinHint {
  slug: string
  label?: string
  family?: string | null
  capability?: string | null
}

function optimistic(pins: PinnedModel[], hint: PinHint): PinnedModel[] {
  return [
    ...pins,
    {
      slug: hint.slug,
      label: hint.label ?? hint.slug,
      family: (hint.family ?? null) as PinnedModel['family'],
      capability: (hint.capability ?? null) as PinnedModel['capability'],
      position: pins.length,
      missing: false,
    },
  ]
}

export function usePins() {
  const state = useSyncExternalStore(subscribe, readSnapshot, serverSnapshot)

  useEffect(() => {
    void ensureLoaded()
  }, [])

  const pins = state.pins

  const isPinned = useCallback(
    (slug: string) => Boolean(pins?.some((pin) => pin.slug === slug)),
    [pins],
  )

  const toggle = useCallback(
    (hint: PinHint) => {
      const current = snapshot.pins
      if (!current) return
      const pinned = current.some((pin) => pin.slug === hint.slug)

      if (pinned) {
        publish({ pins: current.filter((pin) => pin.slug !== hint.slug), error: null })
        void send(
          `/api/favorite-models?slug=${encodeURIComponent(hint.slug)}`,
          { method: 'DELETE' },
          current,
        )
      } else {
        publish({ pins: optimistic(current, hint), error: null })
        void send(
          '/api/favorite-models',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug: hint.slug }),
          },
          current,
        )
      }
    },
    [],
  )

  const reorder = useCallback((slug: string, delta: -1 | 1) => {
    const current = snapshot.pins
    if (!current) return

    const order = move(
      current.map((pin) => pin.slug),
      slug,
      delta,
    )
    // Unchanged means the move ran off an end — no request, no repaint.
    if (order.every((s, i) => s === current[i]?.slug)) return

    const byslug = new Map(current.map((pin) => [pin.slug, pin]))
    publish({
      pins: order.map((s, position) => ({ ...byslug.get(s)!, position })),
      error: null,
    })
    void send(
      '/api/favorite-models',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order }),
      },
      current,
    )
  }, [])

  return {
    /** null while the first load is in flight — render neutral, not "unpinned". */
    pins,
    ready: pins !== null,
    error: state.error,
    isPinned,
    toggle,
    reorder,
  }
}
