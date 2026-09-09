import Link from 'next/link'

import { GenerationCard } from '@/components/gallery/GenerationCard.tsx'
import { PinnedModels, PinsHydrator } from '@/components/models/PinnedModels.tsx'
import { PageHeader, Section } from '@/components/shell/PageHeader.tsx'
import { ChevronRight } from '@/components/shell/icons.tsx'
import { currentWorkspace } from '@/lib/auth/workspace.ts'
import { getGalleryFacets, recentGenerations } from '@/lib/gallery/queries.ts'
import { listPins } from '@/lib/library/pins.ts'
import { readUsage, format as formatBytes } from '@/lib/storage/quota.ts'
import { getEnv } from '@/lib/env'
import { ALL_MODELS, FAMILIES, modelsByFamily } from '@/lib/kie/registry/index.ts'
import { FAMILY_BLURB, FAMILY_LABEL } from '@/lib/models/labels.ts'

export const dynamic = 'force-dynamic'

/** What the facets look like before a browser has generated anything. */
const EMPTY_FACETS = {
  families: [],
  capabilities: [],
  models: [],
  states: [],
  total: 0,
  favorites: 0,
  nsfw: 0,
} as const

/**
 * The landing screen: where to start, and what happened recently.
 *
 * A workspace, not a landing page. There is no hero, because a hero on the
 * screen you see fifty times a day is fifty wasted screenfuls — the counters
 * and the recent grid are the reason to open this route at all, so they are
 * above the fold. Generation is slow and asynchronous, and you should not have
 * to navigate somewhere to find out whether your video is done
 * (docs/UX-SPEC.md).
 */
export default async function Home() {
  const env = getEnv()
  const workspaceId = await currentWorkspace()

  // Everything below is workspace-scoped, and a first-time visitor has no
  // workspace yet. Rather than branching the whole page, the empty shapes stand
  // in — the counters read zero and the grid shows its own empty state, which
  // is exactly what a brand-new studio should look like.
  const [recent, facets, pins, usage] = workspaceId
    ? await Promise.all([
        recentGenerations(workspaceId, 12),
        getGalleryFacets(workspaceId),
        listPins(workspaceId),
        readUsage(workspaceId),
      ])
    : [[], EMPTY_FACETS, [], null]

  const running = facets.states
    .filter((s) => ['waiting', 'queuing', 'generating', 'downloading'].includes(s.value))
    .reduce((sum, s) => sum + s.count, 0)

  const problems = facets.states
    .filter((s) => ['failed', 'needs_retry', 'stalled', 'orphaned'].includes(s.value))
    .reduce((sum, s) => sum + s.count, 0)

  const families = FAMILIES.map((key) => ({
    key,
    label: FAMILY_LABEL[key],
    blurb: FAMILY_BLURB[key],
  }))

  return (
    <main className="mx-auto max-w-[1400px] px-4 pt-6 pb-16">
      <PinsHydrator pins={pins} />

      <PageHeader
        title="Studio"
        description={`${ALL_MODELS.length} models across Kling, ByteDance and Wan. Every parameter of every one is editable.`}
      />

      {/* One instrument, four readings — hairlines instead of a gapped row of
          floating cards. */}
      <div className="grid-divided grid-cols-2 sm:grid-cols-4">
        <Stat label="Generations" value={facets.total} href="/gallery" />
        <Stat label="Running" value={running} href="/gallery?state=running" live={running > 0} />
        <Stat
          label="Needs attention"
          value={problems}
          href="/gallery?state=problem"
          tone={problems > 0 ? 'bad' : undefined}
        />
        <Stat label="Favorites" value={facets.favorites} href="/gallery?favorite=1" />
      </div>

      {/* Two columns from `lg`: the work on the left, the ways into it on the
          right. A single centred column is what made this page read as a
          brochure — content on a tool should fill the width it is given. */}
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_268px]">
        <Section
          title="Recent"
          right={
            facets.total > recent.length ? (
              <Link
                href="/gallery"
                className="group inline-flex items-center gap-1 text-xs text-(--color-ink-muted) transition-colors duration-(--dur-fast) hover:text-(--color-ink)"
              >
                All {facets.total}
                <ChevronRight
                  size={12}
                  className="transition-transform duration-(--dur-fast) group-hover:translate-x-0.5"
                />
              </Link>
            ) : undefined
          }
        >
          {recent.length === 0 ? (
            <Empty />
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {recent.map(({ generation, thumbnail, assetCount }) => (
                <li key={generation.id}>
                  <GenerationCard
                    assetCount={assetCount}
                    thumbnail={
                      // Null when the output was too large to store; the card
                      // shows its placeholder rather than a broken image.
                      thumbnail?.storagePath
                        ? {
                            kind: thumbnail.kind,
                            storagePath: thumbnail.storagePath,
                            width: thumbnail.width,
                            height: thumbnail.height,
                          }
                        : undefined
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
        </Section>

        <div className="space-y-8">
          {/* Above Families: the shortlist answers "start the thing I always
              start", the family list answers "find something new". It owns its
              own heading so both vanish together when the last pin goes. */}
          <PinnedModels variant="compact" heading="Pinned" />

          <Section title="Families">
            <ul className="panel-flush divide-y divide-(--color-border)">
              {families.map((family) => (
                <li key={family.key}>
                  <Link
                    href={`/models?family=${family.key}`}
                    className="row group flex items-center gap-3 px-3 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">{family.label}</span>
                      <span className="mt-0.5 block truncate text-[11px] text-(--color-ink-faint)">
                        {family.blurb}
                      </span>
                    </span>
                    <span className="mono shrink-0 text-(--color-ink-faint)">
                      {modelsByFamily(family.key).length}
                    </span>
                    <ChevronRight
                      size={13}
                      className="shrink-0 text-(--color-ink-faint) transition-transform duration-(--dur-fast) group-hover:translate-x-0.5"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Environment">
            <dl className="panel-flush divide-y divide-(--color-border)">
              {/*
                Never a key itself, and no longer a claim about "the" key: each
                browser brings its own, so what the server can honestly report is
                only whether a fallback exists. Whether YOU have one is a
                question only the browser can answer — Settings does that.
              */}
              <Row
                label="Server key"
                value={env.kieApiKey ? 'fallback set' : 'bring your own'}
              />
              {usage ? (
                <Row
                  label="Storage"
                  value={`${formatBytes(usage.totalBytes)} of ${formatBytes(usage.quotaBytes)}`}
                  tone={usage.full ? 'bad' : usage.warn ? undefined : 'ok'}
                />
              ) : null}
              <Row
                label="Webhooks"
                value={env.publicUrl ? 'enabled' : 'ticks only'}
              />
            </dl>
            <Link
              href="/settings"
              className="mt-2 inline-flex items-center gap-1 text-xs text-(--color-ink-muted) transition-colors duration-(--dur-fast) hover:text-(--color-ink)"
            >
              All settings
              <ChevronRight size={12} />
            </Link>
          </Section>
        </div>
      </div>
    </main>
  )
}

function Stat({
  label,
  value,
  href,
  tone,
  live,
}: {
  label: string
  value: number
  href: string
  tone?: 'bad'
  /** Work in flight — the cell grows a moving rule along its bottom edge. */
  live?: boolean
}) {
  return (
    <Link href={href} className="relative px-3.5 py-3">
      <div
        className={`num text-[22px] leading-none font-semibold tracking-[-0.03em] ${
          tone === 'bad' && value > 0
            ? 'text-(--color-bad-ink)'
            : live
              ? 'text-(--color-accent)'
              : ''
        }`}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11px] text-(--color-ink-muted)">{label}</div>
      {live && (
        <span className="bar-indeterminate absolute inset-x-0 bottom-0 h-px" aria-hidden />
      )}
    </Link>
  )
}

function Row({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'ok' | 'bad'
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <dt className="shrink-0 text-[11px] text-(--color-ink-muted)">{label}</dt>
      <dd
        className={`mono truncate ${
          tone === 'ok'
            ? 'text-(--color-ok-ink)'
            : tone === 'bad'
              ? 'text-(--color-bad-ink)'
              : 'text-(--color-ink-muted)'
        }`}
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}

function Empty() {
  return (
    <div className="rounded-xl border border-dashed border-(--color-border) px-6 py-14 text-center">
      <p className="text-[13px] text-(--color-ink-muted)">Nothing generated yet.</p>
      <Link href="/generate" className="btn btn-ghost btn-sm mt-3">
        Choose a model
      </Link>
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
