import { HeaderSkeleton, GridSkeleton } from '@/components/shell/Skeleton.tsx'

/**
 * The root loading boundary.
 *
 * A catch-all for any route without its own. Its real job is the one thing every
 * `loading.tsx` does: make the URL change the instant a link is clicked, instead
 * of after the server render finishes.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-[1400px] px-4 pt-6 pb-16">
      <HeaderSkeleton withActions />
      <GridSkeleton count={6} />
    </main>
  )
}
