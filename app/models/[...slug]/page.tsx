import Link from 'next/link'
import { notFound } from 'next/navigation'

import { TrapList } from '@/components/library/TrapList.tsx'
import {
  ALL_MODELS,
  capabilitiesOf,
  getModel,
} from '@/lib/kie/registry/index.ts'
import type { Constraint, ParamDef } from '@/lib/kie/registry/types.ts'
import { assetInputs } from '@/lib/models/search.ts'
import { differentiator, findTraps, trapsForModel } from '@/lib/models/traps.ts'

/** Pre-render every model page in production; dev renders on demand. */
export function generateStaticParams() {
  if (process.env.NODE_ENV !== 'production') return []
  return ALL_MODELS.map((model) => ({ slug: model.slug.split('/') }))
}

/**
 * One model, in full: what it takes, what it accepts, and what it will trip you
 * on. The reference table without the round trip to docs.kie.ai.
 */
export default async function ModelPage({
  params,
}: {
  params: Promise<{ slug: string[] }>
}) {
  const { slug } = await params
  const model = getModel(slug.join('/'))
  if (!model) notFound()

  const traps = trapsForModel(model.slug, findTraps(ALL_MODELS))
  const inputs = assetInputs(model)
  const siblings = ALL_MODELS.filter(
    (m) => m.slug !== model.slug && m.family === model.family && m.capability === model.capability,
  )

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="border-b border-(--color-border) pb-5">
        <Link href="/models" className="text-sm text-(--color-ink-muted) hover:underline">
          ← Models
        </Link>

        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{model.label}</h1>
          <Link
            href={`/generate/${model.slug}`}
            className="rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-black transition hover:opacity-90"
          >
            Generate with this
          </Link>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-(--color-ink-muted)">
          <code>{model.slug}</code>
          <span>{capabilitiesOf(model).join(' · ')}</span>
          <span>outputs {model.outputKind}</span>
          <a
            href={model.docUrl}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-(--color-ink)"
          >
            docs.kie.ai
          </a>
          <Link
            href={`/gallery?model=${encodeURIComponent(model.slug)}`}
            className="underline hover:text-(--color-ink)"
          >
            past runs
          </Link>
        </div>

        {differentiator(model) && (
          <p className="mt-3 text-sm">{differentiator(model)}</p>
        )}

        {model.notes && (
          <p className="mt-3 rounded border-l-2 border-(--color-accent) bg-(--color-accent)/10 px-3 py-2 text-sm leading-relaxed text-(--color-ink-muted)">
            {model.notes}
          </p>
        )}
      </header>

      {traps.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-medium">Traps that apply to this model</h2>
          <div className="mt-3">
            <TrapList traps={traps} />
          </div>
        </section>
      )}

      {inputs.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium">Asset inputs</h2>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {inputs.map((input) => (
              <li
                key={input}
                className="rounded border border-(--color-border) px-2 py-1 font-mono text-xs text-(--color-ink-muted)"
              >
                {input}
              </li>
            ))}
          </ul>
        </section>
      )}

      {model.constraints && model.constraints.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-medium">Constraints</h2>
          <p className="mt-0.5 text-xs text-(--color-ink-muted)">
            The form enforces these up front — it disables the conflicting control
            rather than letting you submit and reading back a 422.
          </p>
          <ul className="mt-3 space-y-2">
            {model.constraints.map((constraint, index) => (
              <li
                key={index}
                className="rounded-md border border-(--color-border) bg-(--color-surface-raised) px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded border border-(--color-border) px-1.5 py-0.5 font-mono text-[11px] text-(--color-ink-muted)">
                    {constraint.kind}
                  </code>
                  <span className="font-mono text-[11px] text-(--color-ink-muted)">
                    {constraintKeys(constraint).join(', ')}
                  </span>
                </div>
                <p className="mt-1 text-sm text-(--color-ink-muted)">{constraint.message}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-medium">
          Parameters
          <span className="ml-2 font-mono text-xs text-(--color-ink-muted)">
            {model.params.length}
          </span>
        </h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-(--color-border)">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-(--color-border) bg-(--color-surface) text-xs text-(--color-ink-muted)">
                <th className="px-3 py-2 font-medium">Field</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Accepts</th>
                <th className="px-3 py-2 font-medium">Default</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-border)">
              {model.params.map((param) => (
                <ParamRow key={param.key} param={param} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {siblings.length > 0 && (
        <section className="mt-8 border-t border-(--color-border) pt-6">
          <h2 className="text-sm font-medium">
            Siblings — same family, same capability
          </h2>
          <p className="mt-0.5 text-xs text-(--color-ink-muted)">
            The models most easily confused with this one.
          </p>
          <ul className="mt-3 divide-y divide-(--color-border) overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface-raised)">
            {siblings.map((sibling) => (
              <li key={sibling.slug}>
                <Link
                  href={`/models/${sibling.slug}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2 transition hover:bg-(--color-accent)/10"
                >
                  <span className="text-sm">{sibling.label}</span>
                  <span className="text-xs text-(--color-ink-muted)">
                    {differentiator(sibling)}
                  </span>
                  <code className="font-mono text-[11px] text-(--color-ink-muted)">
                    {sibling.slug}
                  </code>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

function ParamRow({ param }: { param: ParamDef }) {
  return (
    <tr className="align-top">
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <code className="font-mono text-xs">{param.key}</code>
          {param.required && (
            <span className="rounded border border-(--color-accent)/50 px-1 py-0.5 text-[10px] text-(--color-accent)">
              required
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-snug text-(--color-ink-muted)">
          {param.describe}
        </p>
      </td>
      <td className="px-3 py-2 font-mono text-xs text-(--color-ink-muted)">{param.type}</td>
      <td className="px-3 py-2 text-xs text-(--color-ink-muted)">
        {param.enum ? (
          <span className="font-mono">{param.enum.join(' | ')}</span>
        ) : (
          <span className="font-mono">{bounds(param) || '—'}</span>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-xs">
        {param.default === undefined ? (
          <span className="text-(--color-ink-muted)">—</span>
        ) : (
          JSON.stringify(param.default)
        )}
      </td>
    </tr>
  )
}

/** Ranges, lengths and item counts — everything the doc states as a limit. */
function bounds(param: ParamDef): string {
  const parts: string[] = []
  if (param.min !== undefined || param.max !== undefined) {
    parts.push(`${param.min ?? '−∞'}…${param.max ?? '∞'}`)
  }
  if (param.step !== undefined) parts.push(`step ${param.step}`)
  if (param.minLength !== undefined || param.maxLength !== undefined) {
    parts.push(`${param.minLength ?? 0}…${param.maxLength ?? '∞'} chars`)
  }
  if (param.minItems !== undefined || param.maxItems !== undefined) {
    parts.push(`${param.minItems ?? 0}…${param.maxItems ?? '∞'} items`)
  }
  if (param.accept?.length) parts.push(param.accept.join('/'))
  return parts.join(', ')
}

function constraintKeys(constraint: Constraint): string[] {
  if ('keys' in constraint) return constraint.keys
  if ('groups' in constraint) return constraint.groups.flat()
  return []
}
