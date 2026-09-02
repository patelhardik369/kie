import Link from 'next/link'

import { GalleryFilters } from '@/components/gallery/GalleryFilters.tsx'
import { GenerationCard } from '@/components/gallery/GenerationCard.tsx'
import { galleryHref, parseGalleryFilter } from '@/lib/gallery/filters.ts'
import { getGalleryFacets, listGenerations } from '@/lib/gallery/queries.ts'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Gallery — Kie Studio' }

/**
 * Everything ever generated, newest first.
 *
 * A server component reading straight from SQLite, driven entirely by
 * searchParams. No API route sits in between because there is no second
 * consumer, and the filter state lives in the URL rather than in a store — so
 * a filtered view is a link you can send yourself.
 */
export default async function GalleryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const filter = parseGalleryFilter(await searchParams)
  const [page, facets] = await Promise.all([
    listGenerations(filter),
    getGalleryFacets(),
  ])

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <header className="border-b border-(--color-border) pb-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <Link href="/" className="text-sm text-(--color-ink-muted) hover:underline">
              ← Kie Studio
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">Gallery</h1>
          </div>
          <Link
            href="/generate"
            className="rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-black transition hover:opacity-90"
          >
            New generation
          </Link>
        </div>
      </header>

      <div className="mt-5">
        <GalleryFilters
          filter={filter}
          models={facets.models}
          total={facets.total}
          shown={page.total}
        />
      </div>

      {page.items.length === 0 ? (
        <EmptyState hasAny={facets.total > 0} />
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {page.items.map(({ generation, thumbnail, assetCount }) => (
            <li key={generation.id}>
              <GenerationCard
                assetCount={assetCount}
                thumbnail={
                  thumbnail && {
                    kind: thumbnail.kind,
                    localPath: thumbnail.localPath,
                    width: thumbnail.width,
                    height: thumbnail.height,
                  }
                }
                generation={{
                  id: generation.id,
                  modelSlug: generation.modelSlug,
                  family: generation.family,
                  state: generation.state,
                  favorite: generation.favorite,
                  failCode: generation.failCode,
                  failMsg: generation.failMsg,
                  createdAt: generation.createdAt,
                  input: safeParse(generation.inputJson),
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {page.pageCount > 1 && (
        <nav
          className="mt-8 flex items-center justify-center gap-3"
          aria-label="Pagination"
        >
          <PageLink
            href={galleryHref({ ...filter, page: filter.page - 1 })}
            disabled={filter.page <= 1}
          >
            ← Newer
          </PageLink>
          <span className="font-mono text-xs text-(--color-ink-muted)">
            page {page.page} of {page.pageCount}
          </span>
          <PageLink
            href={galleryHref({ ...filter, page: filter.page + 1 })}
            disabled={filter.page >= page.pageCount}
          >
            Older →
          </PageLink>
        </nav>
      )}
    </main>
  )
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string
  disabled: boolean
  children: React.ReactNode
}) {
  if (disabled) {
    return (
      <span className="rounded-md border border-(--color-border) px-3 py-1.5 text-xs opacity-40">
        {children}
      </span>
    )
  }
  return (
    <Link
      href={href}
      className="rounded-md border border-(--color-border) px-3 py-1.5 text-xs text-(--color-ink-muted) transition hover:border-(--color-ink-muted) hover:text-(--color-ink)"
    >
      {children}
    </Link>
  )
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="mt-16 flex flex-col items-center gap-3 text-center">
      <p className="text-sm text-(--color-ink-muted)">
        {hasAny
          ? 'No generation matches these filters.'
          : 'Nothing generated yet.'}
      </p>
      {hasAny ? (
        <Link href="/gallery" className="text-sm text-(--color-accent) hover:underline">
          Clear filters
        </Link>
      ) : (
        <Link
          href="/generate"
          className="rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-black transition hover:opacity-90"
        >
          Choose a model
        </Link>
      )}
    </div>
  )
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}
