import Link from 'next/link'

import { PinStar } from '@/components/models/PinStar.tsx'
import { PinsHydrator } from '@/components/models/PinnedModels.tsx'
import { TrapList } from '@/components/library/TrapList.tsx'
import { PageHeader } from '@/components/shell/PageHeader.tsx'
import { ALL_MODELS, FAMILIES, capabilitiesOf } from '@/lib/kie/registry/index.ts'
import type { Capability, Family } from '@/lib/kie/registry/types.ts'
import { FAMILY_LABEL } from '@/lib/models/labels.ts'
import { listPins } from '@/lib/library/pins.ts'
import { assetInputs, searchModels } from '@/lib/models/search.ts'
import { differentiator, findTraps } from '@/lib/models/traps.ts'

export const metadata = { title: 'Models' }

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
  const pins = await listPins()
  const traps = findTraps(ALL_MODELS)
  const derived = traps.filter((t) => t.kind !== 'note')

  return (
    <main className="mx-auto max-w-5xl px-4 pt-6 pb-16">
      <PinsHydrator pins={pins} />

      <PageHeader
        title="Models"
        description={`${ALL_MODELS.length} models across Kling, ByteDance and Wan. Every parameter of every one is editable.`}
      />

      <section>
        <h2 className="flex items-center gap-2 text-[13px] font-medium">
          Traps
          <span className="chip chip-warn font-mono">{derived.length}</span>
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-(--color-ink-muted)">
          Derived from the registry, so they cannot go stale. These are the
          differences that read as a <code className="font-mono">422</code> naming
          a field but not a reason.
        </p>
        <div className="mt-2.5">
          <TrapList traps={derived} />
        </div>
      </section>

      <form className="mt-7 flex flex-wrap items-center gap-2" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search slugs, labels, parameters, notes…"
          aria-label="Search models"
          className="input min-w-56 flex-1"
        />
        <select
          name="family"
          defaultValue={family ?? ''}
          aria-label="Family"
          className="select-field input w-auto"
        >
          <option value="">All families</option>
          {FAMILIES.map((f) => (
            <option key={f} value={f}>
              {FAMILY_LABEL[f]}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-ghost">
          Search
        </button>
        {(q || family) && (
          <Link href="/models" className="btn btn-quiet">
            Clear
          </Link>
        )}
        <span className="mono ml-auto text-(--color-ink-faint)">
          {matches.length} / {ALL_MODELS.length}
        </span>
      </form>

      {matches.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-(--color-border) px-6 py-14 text-center text-sm text-(--color-ink-muted)">
          Nothing matches. Note the catalog is deliberately three families only —
          Veo, Runway, Sora and the rest are out of scope.
        </p>
      ) : (
        <ul className="panel-flush mt-4 divide-y divide-(--color-border)">
          {matches.map((model) => {
            const inputs = assetInputs(model)
            return (
              /* The star is a sibling of the row link, never a child of it:
                 a <button> inside an <a> is invalid, and clicking it navigates. */
              <li key={model.slug} className="flex items-center gap-1 pr-2">
                <Link
                  href={`/models/${model.slug}`}
                  className="row group min-w-0 flex-1 px-3.5 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-[13px] font-medium">{model.label}</span>
                    {/* Verbatim, always — this is what you would paste into the docs. */}
                    <code className="mono text-(--color-ink-faint)">{model.slug}</code>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-(--color-ink-faint)">
                    <span>{capabilitiesOf(model).join(' · ')}</span>
                    {differentiator(model) && (
                      <span className="text-(--color-ink-muted)">{differentiator(model)}</span>
                    )}
                    <span className="mono">{model.params.length}p</span>
                    {inputs.length > 0 && <span className="mono">takes {inputs.join(', ')}</span>}
                  </div>
                </Link>
                <PinStar
                  slug={model.slug}
                  label={model.label}
                  family={model.family}
                  capability={model.capability}
                />
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
