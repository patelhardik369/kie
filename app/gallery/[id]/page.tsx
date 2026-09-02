import Link from 'next/link'
import { notFound } from 'next/navigation'

import { GenerationActions } from '@/components/gallery/GenerationActions.tsx'
import { Lineage } from '@/components/gallery/Lineage.tsx'
import { ParamProvenance } from '@/components/gallery/ParamProvenance.tsx'
import { GenerationStatus } from '@/components/queue/GenerationStatus.tsx'
import { assetTokenFor } from '@/lib/gallery/asset-token.ts'
import {
  assetHref,
  formatBytes,
  formatDuration,
  formatTimestamp,
  isInFlight,
  isResumable,
  stateLabel,
  stateTone,
} from '@/lib/gallery/display.ts'
import { getGenerationDetail } from '@/lib/gallery/queries.ts'
import { getModel } from '@/lib/kie/registry/index.ts'

export const dynamic = 'force-dynamic'

/**
 * One generation, in full.
 *
 * The media, every parameter that produced it, what it cost, and its lineage.
 * Nothing here is editable except the favorite flag and the note — the rest is
 * a record of what happened, and a record you can edit is not a record.
 */
export default async function GenerationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const detail = await getGenerationDetail(id)
  if (!detail) notFound()

  const { generation, assets, parent, children, siblings } = detail
  const model = getModel(generation.modelSlug)
  const input = (safeParse(generation.inputJson) ?? {}) as Record<string, unknown>
  const live = isInFlight(generation.state) || isResumable(generation.state)

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="border-b border-(--color-border) pb-5">
        <Link href="/gallery" className="text-sm text-(--color-ink-muted) hover:underline">
          ← Gallery
        </Link>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs ${stateTone(generation.state)}`}
          >
            {stateLabel(generation.state)}
          </span>
          <h1 className="text-xl font-semibold tracking-tight">
            {model?.label ?? generation.modelSlug}
          </h1>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-(--color-ink-muted)">
          <code>{generation.modelSlug}</code>
          <span>{generation.capability}</span>
          {model ? (
            <a
              href={model.docUrl}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-(--color-ink)"
            >
              docs
            </a>
          ) : (
            <span
              title="This model is no longer in the registry. The record below is unchanged."
              className="text-amber-300"
            >
              model not in registry
            </span>
          )}
        </div>
      </header>

      {/*
        While anything is still moving, the live panel drives the view. It polls
        the same task route the Studio does, so a detail page opened on a running
        generation updates itself and can resume a stalled one.
      */}
      {live && (
        <section className="mt-6">
          <GenerationStatus id={generation.id} />
        </section>
      )}

      {assets.length > 0 && (
        <section className="mt-6 space-y-4">
          {assets.map((asset) => (
            <figure
              key={asset.id}
              className="overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface-raised)"
            >
              <Media
                kind={asset.kind}
                src={assetHref(asset.localPath, assetTokenFor(asset.localPath, generation.nsfw))}
                layerMeta={asset.layerMeta}
              />
              <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-(--color-border) px-3 py-2 font-mono text-[11px] text-(--color-ink-muted)">
                <a
                  href={assetHref(asset.localPath, assetTokenFor(asset.localPath, generation.nsfw))}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-(--color-ink)"
                >
                  open
                </a>
                {asset.width && asset.height && (
                  <span>
                    {asset.width}×{asset.height}
                  </span>
                )}
                {asset.durationMs && <span>{formatDuration(asset.durationMs)}</span>}
                <span>{formatBytes(asset.bytes)}</span>
                <span>{asset.mime}</span>
                {/* The local path is the durable truth; the Kie URL is long gone. */}
                <span className="ml-auto truncate" title={asset.localPath}>
                  {asset.localPath}
                </span>
              </figcaption>
            </figure>
          ))}
        </section>
      )}

      {generation.failMsg && (
        <section className="mt-6 rounded-lg border-l-2 border-red-400 bg-red-400/10 px-4 py-3">
          {generation.failCode && (
            <code className="font-mono text-xs text-red-300">{generation.failCode}</code>
          )}
          {/* Verbatim — paraphrasing a moderation message makes it useless. */}
          <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-(--color-ink-muted)">
            {generation.failMsg}
          </p>
        </section>
      )}

      <section className="mt-8">
        <GenerationActions
          id={generation.id}
          modelSlug={generation.modelSlug}
          input={input}
          favorite={generation.favorite}
          nsfw={generation.nsfw}
          notes={generation.notes}
        />
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium">Parameters</h2>
        <p className="mt-0.5 text-xs text-(--color-ink-muted)">
          Exactly what was sent to Kie, stored verbatim.
        </p>
        <div className="mt-3">
          <ParamProvenance model={model} input={input} />
        </div>

        <details className="mt-3 rounded-lg border border-(--color-border) bg-(--color-surface-raised)">
          <summary className="cursor-pointer px-3 py-2 text-xs text-(--color-ink-muted)">
            Raw input_json
          </summary>
          <pre className="overflow-x-auto border-t border-(--color-border) px-3 py-3 font-mono text-xs leading-relaxed">
            {JSON.stringify(input, null, 2)}
          </pre>
        </details>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium">Run</h2>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
          <Fact label="Created">{formatTimestamp(generation.createdAt)}</Fact>
          <Fact label="Submitted">{formatTimestamp(generation.submittedAt)}</Fact>
          <Fact label="Completed">{formatTimestamp(generation.completedAt)}</Fact>
          <Fact label="Credits">{generation.creditsConsumed ?? '—'}</Fact>
          <Fact label="Generation time">{formatDuration(generation.costTimeMs)}</Fact>
          <Fact label="Polls">{generation.pollAttempts}</Fact>
          <Fact label="Kie task">{generation.kieTaskId ?? '—'}</Fact>
          <Fact label="Generation id">{generation.id}</Fact>
          {generation.batchId && (
            <Fact label="Batch">{generation.batchId.slice(0, 8)}</Fact>
          )}
        </dl>
      </section>

      <section className="mt-8 border-t border-(--color-border) pt-6">
        <h2 className="text-sm font-medium">Lineage</h2>
        <div className="mt-3">
          <Lineage
            parent={parent}
            children={children}
            siblings={siblings}
            batchId={generation.batchId}
          />
        </div>
      </section>
    </main>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-(--color-ink-muted)">{label}</dt>
      <dd className="truncate font-mono" title={String(children)}>
        {children}
      </dd>
    </div>
  )
}

function Media({
  kind,
  src,
  layerMeta,
}: {
  kind: string
  src: string
  layerMeta: string | null
}) {
  const layer = layerMeta ? (safeParse(layerMeta) as Record<string, unknown> | null) : null

  return (
    <>
      {layer && (
        // Layer decomposition returns z-ordering and names alongside the URLs;
        // showing the file without them discards what makes it useful.
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-(--color-border) px-3 py-2 text-xs text-(--color-ink-muted)">
          {typeof layer.name === 'string' && (
            <span className="font-medium text-(--color-ink)">{layer.name}</span>
          )}
          {typeof layer.z_index === 'number' && (
            <span className="font-mono">z {layer.z_index}</span>
          )}
          {typeof layer.description === 'string' && <span>{layer.description}</span>}
        </div>
      )}
      {kind === 'video' ? (
        <video src={src} controls playsInline className="w-full bg-black" />
      ) : kind === 'audio' ? (
        <audio src={src} controls className="w-full p-3" />
      ) : (
        // A plain <img>: a local file from our own route, and re-encoding a
        // generation output would misrepresent it.
        <img src={src} alt="" className="w-full bg-black object-contain" />
      )}
    </>
  )
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}
