import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ParamForm } from '@/components/param-form/ParamForm.tsx'
import { BackLink } from '@/components/shell/PageHeader.tsx'
import { ExternalLink } from '@/components/shell/icons.tsx'
import { ALL_MODELS, capabilitiesOf, getModel } from '@/lib/kie/registry/index.ts'

/**
 * Pre-render every model page — the registry is static.
 *
 * Production only, deliberately. In dev Next renders on demand, so enumerating
 * all 59 slugs buys nothing and costs a worker pass over the whole registry on
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

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <code className="chip font-mono">{model.slug}</code>
          {capabilitiesOf(model).map((capability) => (
            <span key={capability} className="chip chip-accent">
              {capability}
            </span>
          ))}
          <span className="chip">
            {paramCount} params{nested > 0 ? ` · ${nested} nested` : ''}
          </span>
        </div>

        {model.notes && <p className="note mt-3">{model.notes}</p>}
      </header>

      <div className="mt-6">
        <ParamForm model={model} />
      </div>
    </main>
  )
}
