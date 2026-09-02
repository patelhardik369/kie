'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { Close } from '@/components/shell/icons.tsx'
import {
  formatBytes,
  formatDuration,
  isInFlight,
  isResumable,
  stateLabel,
  stateTone,
} from '@/lib/gallery/display.ts'

/**
 * Live view of one submitted generation.
 *
 * Polls `GET /api/kie/task/[id]` for DISPLAY ONLY. The server-side runner owns
 * the real poll loop, so this component starting, stopping, or being duplicated
 * across tabs changes nothing about the job — closing the browser does not stop
 * it, and opening it twice does not double the rate against Kie.
 */

export interface TaskAsset {
  id: string
  kind: 'image' | 'video' | 'audio'
  url: string
  localPath: string
  mime: string | null
  bytes: number | null
  width: number | null
  height: number | null
  durationMs: number | null
}

export interface TaskView {
  id: string
  state: string
  modelSlug: string
  failCode: string | null
  failMsg: string | null
  creditsConsumed: number | null
  costTimeMs: number | null
  pollAttempts: number
  createdAt: number
  submittedAt: number | null
  completedAt: number | null
  assets: TaskAsset[]
}

/**
 * Nothing more will happen without someone asking for it. The labels, tones and
 * these predicates all live in lib/gallery/display.ts so a state reads the same
 * here, on a gallery tile, and on the detail page.
 */
const settledState = (state: string) => !isInFlight(state)

const POLL_INTERVAL_MS = 2_000

export function GenerationStatus({
  id,
  onDismiss,
}: {
  id: string
  onDismiss?: (id: string) => void
}) {
  const [task, setTask] = useState<TaskView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resuming, setResuming] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const load = useCallback(async () => {
    const response = await fetch(`/api/kie/task/${id}`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Could not read generation ${id}.`)
    return (await response.json()) as TaskView
  }, [id])

  useEffect(() => {
    let cancelled = false

    const tick = async () => {
      try {
        const next = await load()
        if (cancelled) return
        setTask(next)
        setError(null)
        // Stop when the server has nothing further to report; a resume restarts it.
        if (!settledState(next.state)) {
          timer.current = setTimeout(tick, POLL_INTERVAL_MS)
        }
      } catch (cause) {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : String(cause))
        timer.current = setTimeout(tick, POLL_INTERVAL_MS * 3)
      }
    }

    void tick()
    return () => {
      cancelled = true
      clearTimeout(timer.current)
    }
    // `resuming` is in the deps so a successful resume restarts the poll loop.
  }, [load, resuming])

  const resume = async () => {
    setResuming(true)
    try {
      await fetch(`/api/kie/task/${id}`, { method: 'POST' })
      const next = await load()
      setTask(next)
    } finally {
      setResuming(false)
    }
  }

  const state = task?.state ?? 'waiting'
  const settled = settledState(state)

  return (
    <article className="panel-flush">
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-(--color-border) px-3.5 py-2.5">
        <span className={stateTone(state)}>{stateLabel(state)}
        </span>

        <code className="font-mono text-xs text-(--color-ink-muted)">{id.slice(0, 8)}</code>

        {task && <Timing task={task} />}

        <span className="ml-auto flex items-center gap-3">
          {isResumable(state) && (
            <button
              type="button"
              onClick={resume}
              disabled={resuming}
              className="btn btn-ghost btn-sm text-xs"
            >
              {resuming ? 'Resuming…' : 'Check again'}
            </button>
          )}
          {onDismiss && settled && (
            <button
              type="button"
              onClick={() => onDismiss(id)}
              className="text-xs text-(--color-ink-muted) transition hover:text-(--color-ink)"
              aria-label="Dismiss"
            >
              <Close size={12} />
            </button>
          )}
        </span>
      </header>

      <div className="space-y-3 px-4 py-3">
        {error && <p className="text-sm text-(--color-bad)">{error}</p>}

        {task?.failMsg && (
          <div className="rounded border-l-2 border-(--color-bad) bg-(--color-bad)/10 px-3 py-2">
            {task.failCode && (
              <code className="font-mono text-xs text-(--color-bad)">{task.failCode}</code>
            )}
            {/*
              Verbatim, never paraphrased: a moderation message is the only clue
              to what tripped it, and rewording one makes it useless.
            */}
            <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-(--color-ink-muted)">
              {task.failMsg}
            </p>
          </div>
        )}

        {task && task.assets.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {task.assets.map((asset) => (
              <AssetPreview key={asset.id} asset={asset} />
            ))}
          </div>
        )}

        {task && !settled && task.assets.length === 0 && (
          <p className="text-sm text-(--color-ink-muted)">
            {state === 'downloading'
              ? 'Kie finished. Writing the files to disk — a generation is not complete until its bytes are local.'
              : 'Running on Kie. This keeps going if you close the tab.'}
          </p>
        )}
      </div>
    </article>
  )
}

function Timing({ task }: { task: TaskView }) {
  const parts: string[] = []
  if (task.costTimeMs) parts.push(formatDuration(task.costTimeMs))
  if (task.creditsConsumed) parts.push(`${task.creditsConsumed} credits`)
  if (task.pollAttempts) parts.push(`${task.pollAttempts} polls`)

  if (parts.length === 0) return null
  return (
    <span className="font-mono text-xs text-(--color-ink-muted)">{parts.join(' · ')}</span>
  )
}

function AssetPreview({ asset }: { asset: TaskAsset }) {
  return (
    <figure className="overflow-hidden rounded-lg border border-(--color-border) bg-(--color-bg-deep)">
      {asset.kind === 'video' ? (
        <video src={asset.url} controls playsInline className="w-full bg-(--color-bg-deep)" />
      ) : asset.kind === 'audio' ? (
        <audio src={asset.url} controls className="w-full p-3" />
      ) : (
        // A plain <img>, not next/image: these are local files served by our own
        // route, and re-encoding a generation output would misrepresent it.
        <img src={asset.url} alt="" className="w-full bg-(--color-bg-deep) object-contain" />
      )}
      <figcaption className="flex flex-wrap items-center gap-x-2 border-t border-(--color-border) px-2 py-1.5 font-mono text-[11px] text-(--color-ink-muted)">
        <a href={asset.url} target="_blank" rel="noreferrer" className="underline">
          open
        </a>
        {asset.width && asset.height && <span>{asset.width}×{asset.height}</span>}
        {asset.durationMs && <span>{formatDuration(asset.durationMs)}</span>}
        {asset.bytes && <span>{formatBytes(asset.bytes)}</span>}
        <span className="ml-auto truncate" title={asset.localPath}>
          {asset.localPath}
        </span>
      </figcaption>
    </figure>
  )
}
