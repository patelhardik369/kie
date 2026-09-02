'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

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
    <article className="overflow-hidden rounded-lg border border-(--color-border) bg-(--color-surface-raised)">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-(--color-border) px-4 py-3">
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
            stateTone(state)
          }`}
        >
          {!settled && (
            <span className="mr-1.5 inline-block animate-pulse" aria-hidden>
              ●
            </span>
          )}
          {stateLabel(state)}
        </span>

        <code className="font-mono text-xs text-(--color-ink-muted)">{id.slice(0, 8)}</code>

        {task && <Timing task={task} />}

        <span className="ml-auto flex items-center gap-3">
          {isResumable(state) && (
            <button
              type="button"
              onClick={resume}
              disabled={resuming}
              className="rounded-md border border-(--color-border) px-2.5 py-1 text-xs transition hover:border-(--color-ink-muted) disabled:opacity-40"
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
              ✕
            </button>
          )}
        </span>
      </header>

      <div className="space-y-3 px-4 py-3">
        {error && <p className="text-sm text-red-400">{error}</p>}

        {task?.failMsg && (
          <div className="rounded border-l-2 border-red-400 bg-red-400/10 px-3 py-2">
            {task.failCode && (
              <code className="font-mono text-xs text-red-300">{task.failCode}</code>
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
    <figure className="overflow-hidden rounded-md border border-(--color-border)">
      {asset.kind === 'video' ? (
        <video src={asset.url} controls playsInline className="w-full bg-black" />
      ) : asset.kind === 'audio' ? (
        <audio src={asset.url} controls className="w-full p-3" />
      ) : (
        // A plain <img>, not next/image: these are local files served by our own
        // route, and re-encoding a generation output would misrepresent it.
        <img src={asset.url} alt="" className="w-full bg-black object-contain" />
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
