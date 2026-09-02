import { notFound } from 'next/navigation'

import { GenerationActions } from '@/components/gallery/GenerationActions.tsx'
import { Lineage } from '@/components/gallery/Lineage.tsx'
import { ParamProvenance } from '@/components/gallery/ParamProvenance.tsx'
import { GenerationStatus } from '@/components/queue/GenerationStatus.tsx'
import { BackLink } from '@/components/shell/PageHeader.tsx'
import { ChevronRight, ExternalLink } from '@/components/shell/icons.tsx'
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
    <main className="mx-auto max-w-5xl px-4 pt-5 pb-16">
      <BackLink href="/gallery">Gallery</BackLink>

      <header className="mt-4 border-b border-(--color-border) pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`${stateTone(generation.state)} px-2.5 text-xs`}>
            {stateLabel(generation.state)}
          </span>
          <h1 className="text-lg font-semibold tracking-[-0.022em]">
            {model?.label ?? generation.modelSlug}
          </h1>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <code className="chip font-mono">{generation.modelSlug}</code>
          <span className="chip chip-accent">{generation.capability}</span>
          {model ? (
            <a
              href={model.docUrl}
              target="_blank"
              rel="noreferrer"
              className="chip transition-colors duration-(--dur-fast) hover:border-(--color-accent-line) hover:text-(--color-accent)"
            >
              docs
              <ExternalLink size={10} />
            </a>
          ) : (
            <span
              title="This model is no longer in the registry. The record below is unchanged."
              className="chip chip-warn"
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
        <section className="mt-5">
          <GenerationStatus id={generation.id} />
        </section>
      )}

      {assets.length > 0 && (
        <section className="mt-5 space-y-3">
          {assets.map((asset) => (
            <figure key={asset.id} className="panel-flush">
              <Media
                kind={asset.kind}
                src={assetHref(asset.localPath, assetTokenFor(asset.localPath, generation.nsfw))}
                layerMeta={asset.layerMeta}
              />
              <figcaption className="mono flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-(--color-border) px-3.5 py-2 text-(--color-ink-faint)">
                <a
                  href={assetHref(asset.localPath, assetTokenFor(asset.localPath, generation.nsfw))}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline underline-offset-2 transition-colors duration-(--dur-fast) hover:text-(--color-accent)"
                >
                  open
                  <ExternalLink size={10} />
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
        <section className="note note-bad mt-6 px-4 py-3">
          {generation.failCode && (
            <code className="font-mono text-xs font-medium">{generation.failCode}</code>
          )}
          {/* Verbatim — paraphrasing a moderation message makes it useless. */}
          <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-(--color-ink-muted)">
            {generation.failMsg}
          </p>
        </section>
      )}

      <section className="mt-6">
        <GenerationActions
          id={generation.id}
          modelSlug={generation.modelSlug}
          input={input}
          favorite={generation.favorite}
          nsfw={generation.nsfw}
          notes={generation.notes}
          inFlight={isInFlight(generation.state)}
          fileCount={assets.length}
          fileBytes={assets.reduce((sum, asset) => sum + (asset.bytes ?? 0), 0)}
        />
      </section>

      <section className="mt-7">
        <h2 className="text-[13px] font-medium">Parameters</h2>
        <p className="mt-1 text-xs text-(--color-ink-muted)">
          Exactly what was sent to Kie, stored verbatim.
        </p>
        <div className="mt-2.5">
          <ParamProvenance model={model} input={input} />
        </div>

        <details className="panel-flush group mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3.5 py-2 text-xs text-(--color-ink-muted) transition-colors duration-(--dur-fast) hover:text-(--color-ink)">
            <ChevronRight
              size={12}
              className="text-(--color-ink-faint) transition-transform duration-(--dur) group-open:rotate-90"
            />
            Raw input_json
          </summary>
          <pre className="overflow-x-auto border-t border-(--color-border) bg-(--color-bg-deep) px-3.5 py-3 font-mono text-[11px] leading-relaxed text-(--color-ink-muted)">
            {JSON.stringify(input, null, 2)}
          </pre>
        </details>
      </section>

      <section className="mt-7">
        <h2 className="text-[13px] font-medium">Run</h2>
        <dl className="panel mt-2.5 grid grid-cols-2 gap-x-6 gap-y-3 p-3.5 text-xs sm:grid-cols-3">
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

      <section className="mt-8 border-t border-(--color-border) pt-5">
        <h2 className="text-[13px] font-medium">Lineage</h2>
        <div className="mt-2.5">
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
      <dt className="text-[11px] text-(--color-ink-faint)">{label}</dt>
      <dd className="mono mt-0.5 truncate text-(--color-ink-muted)" title={String(children)}>
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
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-(--color-border) bg-(--color-surface) px-3.5 py-2 text-xs text-(--color-ink-muted)">
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
        <video src={src} controls playsInline className="w-full bg-(--color-bg-deep)" />
      ) : kind === 'audio' ? (
        <audio src={src} controls className="w-full p-4" />
      ) : (
        // A plain <img>: a local file from our own route, and re-encoding a
        // generation output would misrepresent it.
        <img src={src} alt="" className="w-full bg-(--color-bg-deep) object-contain" />
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
