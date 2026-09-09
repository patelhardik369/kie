import Link from 'next/link'
import { notFound } from 'next/navigation'

import { TrapList } from '@/components/library/TrapList.tsx'
import { PinStar } from '@/components/models/PinStar.tsx'
import { BackLink } from '@/components/shell/PageHeader.tsx'
import { InfoTip } from '@/components/shell/InfoTip.tsx'
import { ExternalLink } from '@/components/shell/icons.tsx'
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
    <main className="mx-auto max-w-4xl px-4 pt-5 pb-16">
      <BackLink href="/models">Models</BackLink>

      <header className="mt-4 border-b border-(--color-border) pb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="h-page">{model.label}</h1>
          <div className="flex shrink-0 items-center gap-2">
            <PinStar
              slug={model.slug}
              label={model.label}
              family={model.family}
              capability={model.capability}
              showLabel
            />
            <Link href={`/generate/${model.slug}`} className="btn btn-primary">
              Generate with this
            </Link>
          </div>
        </div>

        {/* `relative` positions the InfoTip panel against this row — see its
            own file for why it anchors here rather than to the icon. */}
        <div className="relative mt-2.5 flex flex-wrap items-center gap-1.5">
          <code className="chip font-mono">{model.slug}</code>
          {capabilitiesOf(model).map((capability) => (
            <span key={capability} className="chip chip-accent">
              {capability}
            </span>
          ))}
          <span className="chip">outputs {model.outputKind}</span>
          <a
            href={model.docUrl}
            target="_blank"
            rel="noreferrer"
            className="chip transition-colors duration-(--dur-fast) hover:border-(--color-accent-line) hover:text-(--color-accent)"
          >
            docs.kie.ai
            <ExternalLink size={10} />
          </a>
          <Link
            href={`/gallery?model=${encodeURIComponent(model.slug)}`}
            className="chip transition-colors duration-(--dur-fast) hover:border-(--color-accent-line) hover:text-(--color-accent)"
          >
            past runs
          </Link>
          {model.notes && <InfoTip id="model-notes">{model.notes}</InfoTip>}
        </div>

        {differentiator(model) && (
          <p className="mt-3 text-[13px] text-(--color-ink-muted)">{differentiator(model)}</p>
        )}

      </header>

      {traps.length > 0 && (
        <section className="mt-7">
          <h2 className="text-[13px] font-medium">Traps that apply to this model</h2>
          <div className="mt-3">
            <TrapList traps={traps} />
          </div>
        </section>
      )}

      {inputs.length > 0 && (
        <section className="mt-7">
          <h2 className="text-[13px] font-medium">Asset inputs</h2>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {inputs.map((input) => (
              <li
                key={input}
                className="chip font-mono"
              >
                {input}
              </li>
            ))}
          </ul>
        </section>
      )}

      {model.constraints && model.constraints.length > 0 && (
        <section className="mt-7">
          <h2 className="text-[13px] font-medium">Constraints</h2>
          <p className="mt-0.5 text-xs text-(--color-ink-muted)">
            The form enforces these up front — it disables the conflicting control
            rather than letting you submit and reading back a 422.
          </p>
          <ul className="mt-3 space-y-2">
            {model.constraints.map((constraint, index) => (
              <li
                key={index}
                className="panel px-3.5 py-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <code className="chip font-mono">{constraint.kind}</code>
                  <span className="font-mono text-[11px] text-(--color-ink-muted)">
                    {constraintKeys(constraint).join(', ')}
                  </span>
                </div>
                <p className="mt-1 text-xs text-(--color-ink-muted)">{constraint.message}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-7">
        <h2 className="text-[13px] font-medium">
          Parameters
          <span className="mono ml-2 text-(--color-ink-faint)">{model.params.length}</span>
        </h2>
        <div className="panel-flush table-scroll mt-3 overflow-x-auto">
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
        <section className="mt-8 border-t border-(--color-border) pt-5">
          <h2 className="text-[13px] font-medium">Siblings — same family, same capability</h2>
          <p className="mt-0.5 text-xs text-(--color-ink-muted)">
            The models most easily confused with this one.
          </p>
          <ul className="panel-flush mt-3 divide-y divide-(--color-border)">
            {siblings.map((sibling) => (
              <li key={sibling.slug}>
                <Link
                  href={`/models/${sibling.slug}`}
                  className="row flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3.5 py-2.5"
                >
                  <span className="text-[13px]">{sibling.label}</span>
                  <span className="text-xs text-(--color-ink-muted)">
                    {differentiator(sibling)}
                  </span>
                  <code className="mono text-(--color-ink-faint)">{sibling.slug}</code>
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
    <tr className="align-top transition-colors duration-(--dur-fast) hover:bg-(--color-surface-hover)">
      <td className="px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <code className="mono text-(--color-ink)">{param.key}</code>
          {param.required && (
            <span className="chip chip-accent text-[10px]">required</span>
          )}
        </div>
        <p className="mt-1 text-[11px] leading-snug text-(--color-ink-faint)">
          {param.describe}
        </p>
      </td>
      <td className="mono px-3 py-2 text-(--color-ink-muted)">{param.type}</td>
      <td className="px-3 py-2 text-xs text-(--color-ink-muted)">
        {param.enum ? (
          <span className="font-mono">{param.enum.join(' | ')}</span>
        ) : (
          <span className="font-mono">{bounds(param) || '—'}</span>
        )}
      </td>
      <td className="mono px-3 py-2">
        {param.default === undefined ? (
          <span className="text-(--color-ink-faint)">—</span>
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
