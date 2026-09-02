import Link from 'next/link'

import { PresetRow } from '@/components/library/PresetRow.tsx'
import { getModel } from '@/lib/kie/registry/index.ts'
import { listPresets } from '@/lib/library/queries.ts'
import { applyPreset, summarizePreset } from '@/lib/presets/apply.ts'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Presets — Kie Studio' }

/**
 * Saved parameter sets, grouped by model.
 *
 * Drift is resolved here rather than at apply time, so the list can show up
 * front which presets have gone partly stale — and which model has disappeared
 * from the registry entirely — instead of surprising you at the form.
 */
export default async function PresetsPage() {
  const presets = await listPresets()

  const byModel = new Map<string, typeof presets>()
  for (const preset of presets) {
    const list = byModel.get(preset.modelSlug)
    if (list) list.push(preset)
    else byModel.set(preset.modelSlug, [preset])
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="border-b border-(--color-border) pb-5">
        <Link href="/" className="text-sm text-(--color-ink-muted) hover:underline">
          ← Kie Studio
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Presets</h1>
        <p className="mt-1.5 text-sm text-(--color-ink-muted)">
          Model-scoped parameter sets. Applying one is a starting point — every
          field stays editable afterwards.
        </p>
      </header>

      {presets.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-(--color-ink-muted)">
            No presets yet. Save one from the generation form once you have
            parameters worth keeping.
          </p>
          <Link
            href="/generate"
            className="rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-black transition hover:opacity-90"
          >
            Choose a model
          </Link>
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {[...byModel.entries()].map(([slug, items]) => {
            const model = getModel(slug)

            return (
              <section key={slug}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-medium">
                    {model?.label ?? slug}
                    <code className="ml-2 font-mono text-xs text-(--color-ink-muted)">
                      {slug}
                    </code>
                  </h2>
                  {!model && (
                    <span
                      title="This model is no longer in the registry, so these presets cannot be applied."
                      className="rounded border border-amber-400/50 bg-amber-400/10 px-1.5 py-0.5 text-[11px] text-amber-300"
                    >
                      model not in registry
                    </span>
                  )}
                </div>

                <ul className="mt-2 divide-y divide-(--color-border) overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface-raised)">
                  {items.map((preset) => {
                    const stored = safeParse(preset.paramsJson)
                    // Computed here so the list can warn before you apply, not after.
                    const applied = model ? applyPreset(model, stored) : undefined

                    return (
                      <PresetRow
                        key={preset.id}
                        id={preset.id}
                        name={preset.name}
                        modelSlug={preset.modelSlug}
                        summary={summarizePreset(stored)}
                        updatedAt={preset.updatedAt}
                        applicable={Boolean(model)}
                        droppedCount={applied?.dropped.length ?? 0}
                        droppedMessages={applied?.dropped.map((d) => d.message) ?? []}
                      />
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </main>
  )
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}
