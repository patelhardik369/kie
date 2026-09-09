import { currentWorkspace } from '@/lib/auth/workspace.ts'
import Link from 'next/link'

import { PresetRow } from '@/components/library/PresetRow.tsx'
import { PageHeader } from '@/components/shell/PageHeader.tsx'
import { getModel } from '@/lib/kie/registry/index.ts'
import { listPresets } from '@/lib/library/queries.ts'
import { applyPreset, summarizePreset } from '@/lib/presets/apply.ts'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Presets' }

/**
 * Saved parameter sets, grouped by model.
 *
 * Drift is resolved here rather than at apply time, so the list can show up
 * front which presets have gone partly stale — and which model has disappeared
 * from the registry entirely — instead of surprising you at the form.
 */
export default async function PresetsPage() {
  const workspaceId = await currentWorkspace()
  const presets = workspaceId ? await listPresets(workspaceId) : []

  const byModel = new Map<string, typeof presets>()
  for (const preset of presets) {
    const list = byModel.get(preset.modelSlug)
    if (list) list.push(preset)
    else byModel.set(preset.modelSlug, [preset])
  }

  return (
    <main className="mx-auto max-w-4xl px-4 pt-6 pb-16">
      <PageHeader
        title="Presets"
        description="Model-scoped parameter sets. Applying one is a starting point — every field stays editable afterwards."
      />

      {presets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-(--color-border) px-6 py-16 text-center">
          <p className="text-[13px] text-(--color-ink-muted)">
            No presets yet. Save one from the generation form once you have
            parameters worth keeping.
          </p>
          <Link href="/generate" className="btn btn-ghost btn-sm mt-4">
            Choose a model
          </Link>
        </div>
      ) : (
        <div className="space-y-7">
          {[...byModel.entries()].map(([slug, items]) => {
            const model = getModel(slug)

            return (
              <section key={slug}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-[13px] font-medium">
                    {model?.label ?? slug}
                    <code className="mono ml-2 text-(--color-ink-faint)">{slug}</code>
                  </h2>
                  {!model && (
                    <span
                      title="This model is no longer in the registry, so these presets cannot be applied."
                      className="chip chip-warn"
                    >
                      model not in registry
                    </span>
                  )}
                </div>

                <ul className="panel-flush mt-2.5 divide-y divide-(--color-border)">
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
                        nsfw={preset.nsfw}
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
