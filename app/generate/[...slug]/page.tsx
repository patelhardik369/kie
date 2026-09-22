import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PinStar } from '@/components/models/PinStar.tsx'
import { ParamForm } from '@/components/param-form/ParamForm.tsx'
import { ApiKeyGate } from '@/components/setup/ApiKeyGate.tsx'
import { BackLink } from '@/components/shell/PageHeader.tsx'
import { InfoTip } from '@/components/shell/InfoTip.tsx'
import { ExternalLink } from '@/components/shell/icons.tsx'
import { ALL_MODELS, capabilitiesOf, getModel } from '@/lib/kie/registry/index.ts'

/**
 * Pre-render every model page — the registry is static.
 *
 * Production only, deliberately. In dev Next renders on demand, so enumerating
 * all 97 slugs buys nothing and costs a worker pass over the whole registry on
 * every navigation to this route. That pass is what fails as
 * "Failed to generate static paths for /generate/[...slug]", which surfaces to
 * the browser as the opaque "Jest worker encountered N child process
 * exceptions" — a message about the worker that died, never about why.
 *
 * `dynamicParams` defaults to true, so returning nothing here changes only when
 * a page is rendered, never whether it can be.
 */
export function generateStaticParams() {
  if (process.env.NODE_ENV !== 'production') return []
  return ALL_MODELS.map((model) => ({ slug: model.slug.split('/') }))
}

export default async function GeneratePage({
  params,
}: {
  params: Promise<{ slug: string[] }>
}) {
  const { slug } = await params
  const model = getModel(slug.join('/'))
  if (!model) notFound()

  const paramCount = model.params.length
  const nested = model.params.reduce((sum, p) => sum + (p.fields?.length ?? 0), 0)

  return (
    <main className="mx-auto max-w-3xl px-4 pt-5 pb-20">
      <BackLink href="/generate">All models</BackLink>

      <header className="mt-4 border-b border-(--color-border) pb-4">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
          <h1 className="h-page">{model.label}</h1>
          <nav className="flex shrink-0 items-center gap-3 pt-1">
            {/* The star lives with the model, not with the pin bar — the moment
                you know a model is worth keeping is the moment you have just
                used it. */}
            <PinStar
              slug={model.slug}
              label={model.label}
              family={model.family}
              capability={model.capability}
              showLabel
            />
            <Link
              href={`/models/${model.slug}`}
              className="text-xs text-(--color-ink-muted) transition-colors duration-(--dur-fast) hover:text-(--color-ink)"
            >
              Reference
            </Link>
            <Link
              href={`/gallery?model=${encodeURIComponent(model.slug)}`}
              className="text-xs text-(--color-ink-muted) transition-colors duration-(--dur-fast) hover:text-(--color-ink)"
            >
              Past runs
            </Link>
            <a
              href={model.docUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-(--color-ink-muted) transition-colors duration-(--dur-fast) hover:text-(--color-ink)"
            >
              Docs
              <ExternalLink size={11} />
            </a>
          </nav>
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
          <span className="chip">
            {paramCount} params{nested > 0 ? ` · ${nested} nested` : ''}
          </span>
          {model.notes && <InfoTip id="model-notes">{model.notes}</InfoTip>}
        </div>
      </header>

      {/*
        The gate blocks nothing until this exact point — the screen where credits
        are about to be spent. Someone who has just arrived can read the whole
        catalogue and every parameter of every model before being asked for
        anything, which is the difference between a tool and a signup wall.
      */}
      <div className="mt-6">
        <ApiKeyGate>
          <ParamForm model={model} />
        </ApiKeyGate>
      </div>
    </main>
  )
}
