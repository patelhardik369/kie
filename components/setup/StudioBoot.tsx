'use client'

import { useEffect } from 'react'

import { getApiKey, getWorkspaceId } from '@/lib/client/credentials.ts'

/**
 * Two things that must be true before anything else in the browser runs.
 *
 * 1. **A workspace id exists.** `getWorkspaceId` mints and persists one on first
 *    call. Doing it here, once, at the top of the tree, means no component ever
 *    has to wonder whether it is the first — and the cookie is written early
 *    enough that the next navigation renders server-side with rows in it rather
 *    than empty.
 *
 * 2. **Every `/api` call carries the credentials.** This installs a `fetch`
 *    wrapper that attaches `X-Studio-Workspace` and `X-Kie-Key` to same-origin
 *    API requests.
 *
 * Patching `fetch` is a big hammer and worth defending. There are two dozen call
 * sites across the components, written when the server held the only key and a
 * bare `fetch` was correct. Editing each one would work right up until the next
 * component is added with a plain `fetch` in it, and that omission fails as a
 * confusing 401 in one flow rather than as anything a reviewer would catch. A
 * wrapper cannot be forgotten.
 *
 * It is deliberately narrow: same-origin `/api/` paths only, and it never
 * overwrites a header the caller set. Anything else — a Supabase signed URL, a
 * third-party request — passes through untouched, which matters because sending
 * a Kie key to an origin that did not ask for it is exactly the leak this whole
 * design exists to avoid.
 */

/** Marks a patched fetch so a hot reload cannot wrap the wrapper. */
const PATCHED = Symbol.for('kie-studio.fetch-patched')

type PatchedFetch = typeof fetch & { [PATCHED]?: true }

function isStudioApi(input: RequestInfo | URL): boolean {
  try {
    const raw =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url

    const url = new URL(raw, window.location.origin)
    return url.origin === window.location.origin && url.pathname.startsWith('/api/')
  } catch {
    return false
  }
}

function installFetchInterceptor(): void {
  const current = window.fetch as PatchedFetch
  if (current[PATCHED]) return

  const original = current.bind(window)

  const patched = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!isStudioApi(input)) return original(input, init)

    // A Request object carries its own headers, so they are merged in first —
    // otherwise `fetch(new Request(...))` would silently lose its content-type.
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    )

    if (!headers.has('x-studio-workspace')) {
      headers.set('x-studio-workspace', getWorkspaceId())
    }

    const apiKey = getApiKey()
    // Absent rather than empty when there is no key: a deployment with a
    // server-side KIE_API_KEY falls back to it, and an empty header would read
    // as a caller insisting on a key that cannot work.
    if (apiKey && !headers.has('x-kie-key')) headers.set('x-kie-key', apiKey)

    return original(input, { ...init, headers })
  }) as PatchedFetch

  patched[PATCHED] = true
  window.fetch = patched
}

/*
 * Installed at module scope, NOT in an effect.
 *
 * React runs child effects before parent effects, so a component deeper in the
 * tree that fetches from its own `useEffect` would fire before this one had
 * patched anything — and that request, the very first one on a cold load, would
 * be the one to go out without credentials. Module scope runs when the chunk
 * loads, which is before any effect anywhere.
 */
if (typeof window !== 'undefined') installFetchInterceptor()

export function StudioBoot() {
  // The id itself is minted lazily by the interceptor, so this only exists to
  // get the cookie written on a first visit — early enough that the NEXT
  // navigation renders server-side with this workspace's rows already in it.
  useEffect(() => {
    getWorkspaceId()
  }, [])

  return null
}
