import {
  Bar,
  HeaderSkeleton,
  SectionSkeleton,
  StatsSkeleton,
} from '@/components/shell/Skeleton.tsx'

/**
 * Settings is the slowest page in the app — it reads spend, library counts,
 * input assets, storage usage and the parked-job counts — so it is the one where
 * an instant paint matters most.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-4xl px-4 pt-6 pb-16">
      <HeaderSkeleton />

      <SectionSkeleton className="mt-2">
        <Bar className="h-10 w-full" />
      </SectionSkeleton>

      <SectionSkeleton>
        <Bar className="h-10 w-full" />
      </SectionSkeleton>

      <SectionSkeleton>
        <Bar className="h-2 w-full rounded-full" />
        <Bar className="mt-2 h-3 w-64" />
        <div className="mt-4">
          <StatsSkeleton />
        </div>
      </SectionSkeleton>

      <SectionSkeleton>
        <StatsSkeleton count={3} />
      </SectionSkeleton>
    </main>
  )
}
