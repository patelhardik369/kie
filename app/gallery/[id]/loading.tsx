import { Bar } from '@/components/shell/Skeleton.tsx'

/**
 * One generation, in full.
 *
 * The media block dominates this screen, so the skeleton gives it the same
 * prominence — a short bar where the title goes and a large panel below it.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-4xl px-4 pt-6 pb-16">
      <Bar className="h-3 w-24" />
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <Bar className="h-[22px] w-64" />
          <Bar className="h-3 w-40" />
        </div>
        <Bar className="h-8 w-24 shrink-0" />
      </div>
      <Bar className="mt-5 aspect-video w-full" />
      <div className="mt-5 space-y-2">
        <Bar className="h-3.5 w-28" />
        <Bar className="h-24 w-full" />
      </div>
    </main>
  )
}
