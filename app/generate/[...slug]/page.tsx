import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ParamForm } from '@/components/param-form/ParamForm.tsx'
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
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="border-b border-(--color-border) pb-6">
        <div className="flex items-center gap-4">
          <Link
            href="/generate"
            className="text-sm text-(--color-ink-muted) hover:underline"
          >
            ← All models
          </Link>
          <Link
            href={`/gallery?model=${encodeURIComponent(model.slug)}`}
            className="text-sm text-(--color-ink-muted) hover:underline"
          >
            Past runs of this model
          </Link>
        </div>

        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{model.label}</h1>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-(--color-ink-muted)">
          <code>{model.slug}</code>
          <span>{capabilitiesOf(model).join(' · ')}</span>
          <span>
            {paramCount} parameters
            {nested > 0 ? ` (+${nested} nested)` : ''}
          </span>
          <a
            href={model.docUrl}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-(--color-ink)"
          >
            docs
          </a>
        </div>

        {model.notes && (
          <p className="mt-4 rounded border-l-2 border-(--color-accent) bg-(--color-accent)/10 px-3 py-2 text-sm leading-relaxed text-(--color-ink-muted)">
            {model.notes}
          </p>
        )}
      </header>

      <div className="mt-8">
        <ParamForm model={model} />
      </div>
    </main>
  )
}
