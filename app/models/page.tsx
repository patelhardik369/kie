import Link from 'next/link'

import { TrapList } from '@/components/library/TrapList.tsx'
import { ALL_MODELS, FAMILIES, capabilitiesOf } from '@/lib/kie/registry/index.ts'
import type { Capability, Family } from '@/lib/kie/registry/types.ts'
import { assetInputs, searchModels } from '@/lib/models/search.ts'
import { differentiator, findTraps } from '@/lib/models/traps.ts'

export const metadata = { title: 'Models — Kie Studio' }

const FAMILY_LABEL: Record<Family, string> = {
  kling: 'Kling',
  bytedance: 'ByteDance',
  wan: 'Wan',
}

/**
 * The catalog, browsable.
 *
 * Its job is to answer "which model do I want?" without opening docs.kie.ai
 * (docs/PRD.md F9). Two things do that work:
 *
 *   - **A differentiator on every row.** The capability alone does not
 *     distinguish nine Kling text-to-video models; resolution, duration and
 *     audio support do.
 *   - **The traps, up front.** That `duration` is a string on most Kling models
 *     and an integer on Omni is the kind of thing that costs an hour and a 422
 *     the first time you meet it.
 *
 * A server component with searchParams-driven filtering — same rule as the
 * gallery: the URL is the state.
 */
export default async function ModelsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const one = (key: string) => {
    const value = params[key]
    const single = Array.isArray(value) ? value[0] : value
    return single?.trim() || undefined
  }

  const q = one('q')
  const family = FAMILIES.includes(one('family') as Family)
    ? (one('family') as Family)
    : undefined

  const matches = searchModels(ALL_MODELS, { q, family })
  const traps = findTraps(ALL_MODELS)
  const derived = traps.filter((t) => t.kind !== 'note')

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="border-b border-(--color-border) pb-5">
        <Link href="/" className="text-sm text-(--color-ink-muted) hover:underline">
          ← Kie Studio
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Models</h1>
        <p className="mt-1.5 text-sm text-(--color-ink-muted)">
          {ALL_MODELS.length} models. Every parameter of every one is editable.
        </p>
      </header>

      <section className="mt-6">
        <h2 className="text-sm font-medium">
          Traps
          <span className="ml-2 rounded-full border border-amber-400/50 bg-amber-400/10 px-2 py-0.5 font-mono text-xs text-amber-300">
            {derived.length}
          </span>
        </h2>
        <p className="mt-0.5 text-xs text-(--color-ink-muted)">
          Derived from the registry, so they cannot go stale. These are the
          differences that read as a <code className="font-mono">422</code> naming
          a field but not a reason.
        </p>
        <div className="mt-3">
          <TrapList traps={derived} />
        </div>
      </section>

      <form className="mt-8 flex flex-wrap items-center gap-2" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search slugs, labels, parameters, notes…"
          aria-label="Search models"
          className="min-w-56 flex-1 rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm outline-none transition focus:border-(--color-accent)"
        />
        <select
          name="family"
          defaultValue={family ?? ''}
          aria-label="Family"
          className="rounded-md border border-(--color-border) bg-(--color-surface) px-3 py-2 text-sm outline-none transition focus:border-(--color-accent)"
        >
          <option value="">All families</option>
          {FAMILIES.map((f) => (
            <option key={f} value={f}>
              {FAMILY_LABEL[f]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-md border border-(--color-border) px-3 py-2 text-sm transition hover:border-(--color-ink-muted)"
        >
          Search
        </button>
        {(q || family) && (
          <Link
            href="/models"
            className="rounded-md border border-(--color-border) px-3 py-2 text-sm text-(--color-ink-muted) transition hover:border-(--color-ink-muted)"
          >
            Clear
          </Link>
        )}
        <span className="ml-auto font-mono text-xs text-(--color-ink-muted)">
          {matches.length} of {ALL_MODELS.length}
        </span>
      </form>

      {matches.length === 0 ? (
        <p className="mt-10 text-center text-sm text-(--color-ink-muted)">
          Nothing matches. Note the catalog is deliberately three families only —
          Veo, Runway, Sora and the rest are out of scope.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-(--color-border) overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface-raised)">
          {matches.map((model) => {
            const inputs = assetInputs(model)
            return (
              <li key={model.slug}>
                <Link
                  href={`/models/${model.slug}`}
                  className="block px-4 py-3 transition hover:bg-(--color-accent)/10"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-sm font-medium">{model.label}</span>
                    {/* Verbatim, always — this is what you would paste into the docs. */}
                    <code className="font-mono text-xs text-(--color-ink-muted)">
                      {model.slug}
                    </code>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-(--color-ink-muted)">
                    <span>{capabilitiesOf(model).join(' · ')}</span>
                    {differentiator(model) && (
                      <span className="text-(--color-ink)">{differentiator(model)}</span>
                    )}
                    <span className="font-mono">{model.params.length} params</span>
                  </div>
                  {inputs.length > 0 && (
                    <div className="mt-1 font-mono text-[11px] text-(--color-ink-muted)">
                      takes {inputs.join(', ')}
                    </div>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
