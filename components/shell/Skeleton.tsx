/**
 * The shapes a route shows while its server render is in flight.
 *
 * These exist for one reason, and it is not decoration. In the App Router a
 * navigation to a dynamic route blocks on the server response before anything
 * changes — the URL does not move, the old page stays put, and the click reads
 * as ignored. People click again. A `loading.tsx` turns that into an immediate
 * URL change plus a skeleton, and it is also what lets Next partially prefetch
 * a dynamic route rather than nothing at all.
 *
 * So the goal is not "something pretty while you wait", it is **the layout you
 * are about to get, in the position you are about to get it**. A skeleton whose
 * proportions differ from the real content trades a dead click for a visible
 * jolt, which is not obviously a better trade.
 *
 * Server components, deliberately: they cost no client JavaScript, and the
 * whole point is to paint before any of ours has run.
 */

/** One shimmering block. `animate-pulse` is Tailwind's, so no custom CSS. */
export function Bar({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-pulse rounded-md bg-(--color-surface-hover) ${className}`}
    />
  )
}

/**
 * The masthead, matched to `PageHeader`: a 22px title and one line of
 * description, with the same `pb-5`.
 */
export function HeaderSkeleton({ withActions = false }: { withActions?: boolean }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pb-5">
      <div className="min-w-0 flex-1">
        <Bar className="h-[22px] w-48" />
        <Bar className="mt-2 h-3.5 w-full max-w-lg" />
      </div>
      {withActions ? <Bar className="h-8 w-28 shrink-0" /> : null}
    </div>
  )
}

/**
 * A grid of media tiles, at the gallery's own breakpoints.
 *
 * `aspect-square` rather than a fixed height so the tiles reflow with the grid
 * exactly as the real cards do.
 */
export function GridSkeleton({ count = 12 }: { count?: number }) {
  return (
    <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {Array.from({ length: count }, (_, i) => (
        <li key={i}>
          <div className="overflow-hidden rounded-lg border border-(--color-border)">
            <Bar className="aspect-square w-full rounded-none" />
            <div className="space-y-1.5 p-2.5">
              <Bar className="h-3 w-3/4" />
              <Bar className="h-2.5 w-1/2" />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** A stack of rows, for the list-shaped screens: models, presets, prompts. */
export function ListSkeleton({ count = 8 }: { count?: number }) {
  return (
    <ul className="panel-flush mt-4 divide-y divide-(--color-border)">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex items-center gap-3 px-3.5 py-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Bar className="h-3.5 w-1/3" />
            <Bar className="h-2.5 w-2/3" />
          </div>
          <Bar className="h-3 w-10 shrink-0" />
        </li>
      ))}
    </ul>
  )
}

/** A row of stat tiles, as Settings and the home page use. */
export function StatsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid-divided grid-cols-2 sm:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="px-3.5 py-3">
          <Bar className="h-2.5 w-16" />
          <Bar className="mt-2 h-6 w-20" />
        </div>
      ))}
    </div>
  )
}

/** A titled block, matched to `Section`'s spacing. */
export function SectionSkeleton({
  children,
  className = 'mt-8',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      <Bar className="mb-2.5 h-3.5 w-32" />
      {children}
    </section>
  )
}
