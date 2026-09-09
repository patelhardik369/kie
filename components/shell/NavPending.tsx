'use client'

import { useLinkStatus } from 'next/link'

/**
 * Marks the link you just clicked as pending.
 *
 * `loading.tsx` covers the substantive gap — the URL changes and a skeleton
 * paints immediately. This covers the sliver before that: the moment between
 * mousedown and the boundary rendering, where a slow connection can still leave
 * the nav looking untouched.
 *
 * It must be rendered as a CHILD of the `<Link>` it reports on — `useLinkStatus`
 * reads the nearest enclosing link, so a sibling would always read `false`.
 *
 * Deliberately a dot rather than a spinner. A spinner in a 48px nav rail is a
 * second thing competing for attention on every single navigation; the point is
 * to answer "did my click register", which one appearing dot does.
 */
export function NavPending() {
  const { pending } = useLinkStatus()

  if (!pending) return null

  return (
    <span
      aria-hidden
      className="ml-0.5 size-1.5 shrink-0 animate-pulse rounded-full bg-(--color-accent)"
    />
  )
}
