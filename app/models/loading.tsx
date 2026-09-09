import { HeaderSkeleton, ListSkeleton } from '@/components/shell/Skeleton.tsx'

export default function Loading() {
  return (
    <main className="mx-auto max-w-5xl px-4 pt-6 pb-16">
      <HeaderSkeleton />
      <ListSkeleton count={12} />
    </main>
  )
}
