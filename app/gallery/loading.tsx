import { Bar, HeaderSkeleton, GridSkeleton } from '@/components/shell/Skeleton.tsx'

/** Header, filter bar, then the grid — the gallery's own shape. */
export default function Loading() {
  return (
    <main className="mx-auto max-w-[1400px] px-4 pt-6 pb-16">
      <HeaderSkeleton />
      <div className="flex flex-wrap items-center gap-2">
        <Bar className="h-8 w-56" />
        <Bar className="h-8 w-24" />
        <Bar className="h-8 w-24" />
        <Bar className="ml-auto h-8 w-32" />
      </div>
      <GridSkeleton count={18} />
    </main>
  )
}
