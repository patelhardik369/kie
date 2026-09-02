import Link from 'next/link'

import { GalleryFilters } from '@/components/gallery/GalleryFilters.tsx'
import { GenerationCard } from '@/components/gallery/GenerationCard.tsx'
import { PageHeader } from '@/components/shell/PageHeader.tsx'
import { ArrowLeft, ArrowRight } from '@/components/shell/icons.tsx'
import { assetTokenFor } from '@/lib/gallery/asset-token.ts'
import { galleryHref, parseGalleryFilter } from '@/lib/gallery/filters.ts'
import { getGalleryFacets, listGenerations } from '@/lib/gallery/queries.ts'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Gallery' }

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
    <main className="mx-auto max-w-[1400px] px-4 pt-6 pb-16">
      <PageHeader
        title="Gallery"
        description="Everything ever generated, newest first. Filters live in the URL, so a filtered view is a link you can keep."
      />

      <div>
        <GalleryFilters
          filter={filter}
          models={facets.models}
          total={facets.total}
          shown={page.total}
          nsfwCount={facets.nsfw}
        />
      </div>

      {page.items.length === 0 ? (
        <EmptyState hasAny={facets.total > 0} />
      ) : (
        <ul className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
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
                    // Only a grid that asked for private work can render it.
                    token: assetTokenFor(thumbnail.localPath, generation.nsfw),
                  }
                }
                generation={{
                  id: generation.id,
                  modelSlug: generation.modelSlug,
                  family: generation.family,
                  state: generation.state,
                  favorite: generation.favorite,
                  nsfw: generation.nsfw,
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
          className="mt-8 flex items-center justify-center gap-2"
          aria-label="Pagination"
        >
          <PageLink
            href={galleryHref({ ...filter, page: filter.page - 1 })}
            disabled={filter.page <= 1}
          >
            <ArrowLeft size={12} />
            Newer
          </PageLink>
          <span className="mono text-(--color-ink-faint)">
            {page.page} / {page.pageCount}
          </span>
          <PageLink
            href={galleryHref({ ...filter, page: filter.page + 1 })}
            disabled={filter.page >= page.pageCount}
          >
            Older
            <ArrowRight size={12} />
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
      <span className="btn btn-ghost btn-sm text-xs opacity-40">{children}</span>
    )
  }
  return (
    <Link href={href} className="btn btn-ghost btn-sm text-xs">
      {children}
    </Link>
  )
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="mt-6 rounded-xl border border-dashed border-(--color-border) px-6 py-16 text-center">
      <p className="text-[13px] text-(--color-ink-muted)">
        {hasAny
          ? 'No generation matches these filters.'
          : 'Nothing generated yet.'}
      </p>
      {hasAny ? (
        <Link href="/gallery" className="btn btn-ghost btn-sm mt-4">
          Clear filters
        </Link>
      ) : (
        <Link href="/generate" className="btn btn-primary btn-sm mt-4">
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
