import Link from 'next/link'

import { GenerationCard } from '@/components/gallery/GenerationCard.tsx'
import { getGalleryFacets, recentGenerations } from '@/lib/gallery/queries.ts'
import { getEnv } from '@/lib/env'
import { ALL_MODELS, modelsByFamily } from '@/lib/kie/registry/index.ts'

export const dynamic = 'force-dynamic'

/**
 * The landing screen: where to start, and what happened recently.
 *
 * Generation is slow and asynchronous, so the most recent runs are on the front
 * page — you should not have to navigate somewhere to find out whether your
 * video is done (docs/UX-SPEC.md).
 */
export default async function Home() {
  const env = getEnv()
  const [recent, facets] = await Promise.all([
    recentGenerations(10),
    getGalleryFacets(),
  ])

  const running = facets.states
    .filter((s) => ['waiting', 'queuing', 'generating', 'downloading'].includes(s.value))
    .reduce((sum, s) => sum + s.count, 0)

  const problems = facets.states
    .filter((s) => ['failed', 'needs_retry', 'stalled', 'orphaned'].includes(s.value))
    .reduce((sum, s) => sum + s.count, 0)

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-(--color-border) pb-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Kie Studio</h1>
          <p className="mt-2 text-(--color-ink-muted)">
            {ALL_MODELS.length} models across Kling, ByteDance and Wan. Every
            parameter exposed.
          </p>
        </div>
        <nav className="flex flex-wrap gap-2">
          {[
            ['/gallery', 'Gallery'],
            ['/models', 'Models'],
            ['/presets', 'Presets'],
            ['/prompts', 'Prompts'],
            ['/settings', 'Settings'],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href!}
              className="rounded-md border border-(--color-border) px-3 py-2 text-sm transition hover:border-(--color-ink-muted)"
            >
              {label}
            </Link>
          ))}
          <Link
            href="/generate"
            className="rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-black transition hover:opacity-90"
          >
            New generation
          </Link>
        </nav>
      </header>

      <div className="mt-6 flex flex-wrap gap-3">
        <Stat label="Generations" value={facets.total} href="/gallery" />
        <Stat label="Running" value={running} href="/gallery?state=running" accent={running > 0} />
        <Stat
          label="Needs attention"
          value={problems}
          href="/gallery?state=problem"
          warn={problems > 0}
        />
        <Stat label="Favorites" value={facets.favorites} href="/gallery?favorite=1" />
      </div>

      <section className="mt-10">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-medium tracking-wider text-(--color-ink-muted) uppercase">
            Recent
          </h2>
          {facets.total > recent.length && (
            <Link href="/gallery" className="text-sm text-(--color-accent) hover:underline">
              See all {facets.total} →
            </Link>
          )}
        </div>

        {recent.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-(--color-border) px-4 py-10 text-center text-sm text-(--color-ink-muted)">
            Nothing generated yet.{' '}
            <Link href="/generate" className="text-(--color-accent) hover:underline">
              Choose a model
            </Link>{' '}
            to start.
          </p>
        ) : (
          <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {recent.map(({ generation, thumbnail, assetCount }) => (
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
      </section>

      <details className="mt-12 rounded-lg border border-(--color-border) bg-(--color-surface-raised)">
        <summary className="cursor-pointer px-4 py-3 text-sm text-(--color-ink-muted)">
          Environment
        </summary>
        <dl className="divide-y divide-(--color-border) border-t border-(--color-border)">
          {/* Never the key itself — only whether one is configured. */}
          <Row label="API key" value={env.kieApiKey ? 'configured' : 'missing'} />
          <Row label="Database" value={env.databaseFile} />
          <Row label="Output directory" value={env.outputDir} />
          <Row
            label="Webhooks"
            value={
              env.publicUrl
                ? `enabled — ${env.publicUrl}/api/kie/webhook`
                : 'disabled (polling only)'
            }
          />
          <Row label="Kling" value={`${modelsByFamily('kling').length} models`} />
          <Row label="ByteDance" value={`${modelsByFamily('bytedance').length} models`} />
          <Row label="Wan" value={`${modelsByFamily('wan').length} models`} />
        </dl>
      </details>
    </main>
  )
}

function Stat({
  label,
  value,
  href,
  accent,
  warn,
}: {
  label: string
  value: number
  href: string
  accent?: boolean
  warn?: boolean
}) {
  return (
    <Link
      href={href}
      className={`rounded-lg border px-4 py-3 transition hover:border-(--color-ink-muted) ${
        warn
          ? 'border-amber-400/50 bg-amber-400/10'
          : accent
            ? 'border-(--color-accent)/50 bg-(--color-accent)/10'
            : 'border-(--color-border) bg-(--color-surface-raised)'
      }`}
    >
      <div className="font-mono text-xl">{value}</div>
      <div className="text-xs text-(--color-ink-muted)">{label}</div>
    </Link>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 px-4 py-3">
      <dt className="text-sm text-(--color-ink-muted)">{label}</dt>
      <dd className="truncate font-mono text-sm">{value}</dd>
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
