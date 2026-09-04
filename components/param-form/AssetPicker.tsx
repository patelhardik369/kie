'use client'

import { useEffect, useRef, useState } from 'react'

import { Film, Image as ImageIcon, Layers, Wave } from '@/components/shell/icons.tsx'
import { formatBytes, formatDuration, formatTimestamp } from '@/lib/gallery/display.ts'
import type { AssetKind, ParamDef } from '@/lib/kie/registry/types.ts'

/**
 * Pick something you already have as this field's input.
 *
 * The gap it closes: the studio's natural loop is make an image, animate it,
 * upscale that — and every hop used to mean opening the output folder, finding
 * the file and uploading it by hand. Again the next day, because Kie's upload
 * URLs live about 24 hours.
 *
 * Two sources, because they are genuinely different things and a single merged
 * list would bury the one you meant:
 *
 *   - **Outputs** — what this studio has generated. Picking one uploads the
 *     local file once and caches the URL; the same output picked again inside a
 *     day costs nothing at all.
 *   - **Uploads** — the input library, everything ever put into a field here.
 *     Expired entries are not broken: the local copy is kept and re-uploads
 *     transparently.
 *
 * Filtered by the ParamDef's own `accept`, so a video field never offers a PNG.
 * Like every other control in this folder, it knows nothing about which model it
 * is rendering.
 */

interface OutputItem {
  assetId: string
  generationId: string
  modelSlug: string
  kind: 'image' | 'video' | 'audio'
  prompt: string | null
  bytes: number | null
  width: number | null
  height: number | null
  durationMs: number | null
  createdAt: number
  nsfw: boolean
  /** Non-null when a live Kie URL for these exact bytes already exists. */
  fileUrl: string | null
  /** Local URL for the thumbnail, carrying a capability token when private. */
  href: string
}

interface UploadItem {
  id: string
  kind: string
  label: string | null
  bytes: number | null
  createdAt: number
  live: boolean
}

/** The output kinds a parameter will accept. Empty means "no restriction". */
function acceptedKinds(param: ParamDef): ('image' | 'video' | 'audio')[] {
  const accept: AssetKind[] = param.accept ?? []
  // `file` is a document field with no output equivalent — it does not narrow
  // anything, so a param that accepts it is treated as accepting everything.
  if (accept.length === 0 || accept.includes('file')) return []
  return accept.filter((kind): kind is 'image' | 'video' | 'audio' => kind !== 'file')
}

export function AssetPicker({
  param,
  disabled,
  align = 'right',
  onPick,
}: {
  param: ParamDef
  disabled?: boolean
  /**
   * Which edge the panel hangs from.
   *
   * The panel is far wider than its button, so the side matters: a picker at the
   * right end of a row opens leftward, and one at the left end opens rightward.
   * The wrong choice puts 480px of popover outside the form it belongs to.
   */
  align?: 'left' | 'right'
  /** Receives a URL the model can fetch — never a local path. */
  onPick: (fileUrl: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'outputs' | 'uploads'>('outputs')
  const [outputs, setOutputs] = useState<OutputItem[] | null>(null)
  const [uploads, setUploads] = useState<UploadItem[] | null>(null)
  const [query, setQuery] = useState('')
  const [includePrivate, setIncludePrivate] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  const kinds = acceptedKinds(param)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  /*
   * Refetched on every input that changes the answer, debounced so typing a
   * prompt fragment is one query rather than nine. `cancelled` guards the race:
   * a slow first request must not overwrite a fast second one.
   */
  useEffect(() => {
    if (!open || tab !== 'outputs') return
    let cancelled = false

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams()
          if (kinds.length > 0) params.set('kinds', kinds.join(','))
          if (query.trim()) params.set('q', query.trim())
          if (includePrivate) params.set('nsfw', '1')

          const response = await fetch(`/api/outputs?${params}`, { cache: 'no-store' })
          const data = await response.json()
          if (!cancelled) setOutputs(data.outputs ?? [])
        } catch {
          if (!cancelled) setOutputs([])
        }
      })()
    }, outputs === null ? 0 : 220)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // `kinds` is derived from the ParamDef and joined so the dependency is a
    // string rather than a new array identity on every render.
  }, [open, tab, query, includePrivate, kinds.join(',')])

  useEffect(() => {
    if (!open || tab !== 'uploads') return
    let cancelled = false

    void (async () => {
      try {
        // One request, filtered here: the library is small, and the route takes
        // a single kind where a param can accept two.
        const response = await fetch('/api/input-assets', { cache: 'no-store' })
        const data = await response.json()
        if (cancelled) return
        const all: UploadItem[] = data.assets ?? []
        setUploads(
          kinds.length === 0 ? all : all.filter((a) => kinds.includes(a.kind as never)),
        )
      } catch {
        if (!cancelled) setUploads([])
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, tab, kinds.join(',')])

  /** Resolves a choice to a fetchable URL, then hands it to the field. */
  const choose = async (
    id: string,
    request: () => Promise<Response>,
  ) => {
    setBusy(id)
    setError(null)
    setWarning(null)
    try {
      const response = await request()
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error ?? 'That could not be prepared.')
      if (typeof data.fileUrl !== 'string' || !data.fileUrl) {
        throw new Error('It was prepared but came back without a URL.')
      }

      onPick(data.fileUrl)
      // A warning is about the URL that was just accepted, so the picker stays
      // open to show it rather than closing over the top of it.
      if (data.warning) setWarning(data.warning)
      else setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(null)
    }
  }

  const pickOutput = (item: OutputItem) =>
    choose(item.assetId, () =>
      fetch('/api/outputs/reuse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: item.assetId }),
      }),
    )

  const pickUpload = (item: UploadItem) =>
    choose(item.id, () => fetch(`/api/input-assets/${item.id}`, { method: 'POST' }))

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-expanded={open}
        title="Use something you have already generated or uploaded"
        className={`btn btn-sm shrink-0 text-xs ${
          open ? 'border-(--color-accent-line) text-(--color-accent)' : 'btn-ghost'
        }`}
      >
        <Layers size={12} />
        Reuse
      </button>

      {open && (
        <div
          className={`pop absolute z-30 mt-1 w-[min(30rem,calc(100vw-2rem))] rounded-lg border border-(--color-border) bg-(--color-surface-raised) shadow-[var(--shadow-lg)] ${
            align === 'left' ? 'left-0' : 'right-0'
          }`}
          /* Inline, not a utility: `.pop` sets transform-origin unlayered, and
             an unlayered rule beats anything in Tailwind's utilities layer. */
          style={{ transformOrigin: align === 'left' ? 'top left' : 'top right' }}
        >
          <div className="flex items-center gap-1 border-b border-(--color-border) px-2 py-1.5">
            <Tab active={tab === 'outputs'} onClick={() => setTab('outputs')}>
              Outputs
            </Tab>
            <Tab active={tab === 'uploads'} onClick={() => setTab('uploads')}>
              Uploads
            </Tab>
            <span className="mono ml-auto pr-1 text-(--color-ink-faint)">
              {kinds.length > 0 ? kinds.join(' / ') : 'any file'}
            </span>
          </div>

          {tab === 'outputs' && (
            <div className="flex items-center gap-2 border-b border-(--color-border) px-2 py-1.5">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search prompts and models…"
                aria-label="Search outputs"
                className="input py-1 text-xs"
              />
              <label
                className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] text-(--color-ink-muted)"
                title="Generations marked private are hidden by default, here as everywhere."
              >
                <input
                  type="checkbox"
                  checked={includePrivate}
                  onChange={(e) => setIncludePrivate(e.target.checked)}
                  className="check-private"
                />
                Private
              </label>
            </div>
          )}

          {error && (
            <p className="note note-bad m-2 px-2 py-1.5 text-[11px]" role="alert">
              {error}
            </p>
          )}
          {warning && (
            <p className="note note-warn m-2 px-2 py-1.5 text-[11px]">
              {warning}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-2 underline underline-offset-2"
              >
                Close
              </button>
            </p>
          )}

          <div className="max-h-80 overflow-y-auto p-2">
            {tab === 'outputs' ? (
              outputs === null ? (
                <Loading />
              ) : outputs.length === 0 ? (
                <Empty>
                  {query
                    ? 'No output matches that.'
                    : `Nothing generated yet that this field accepts${
                        kinds.length > 0 ? ` (${kinds.join(' or ')})` : ''
                      }.`}
                </Empty>
              ) : (
                <ul className="grid grid-cols-3 gap-2">
                  {outputs.map((item) => (
                    <li key={item.assetId}>
                      <button
                        type="button"
                        onClick={() => void pickOutput(item)}
                        disabled={busy !== null}
                        title={`${item.modelSlug}\n${item.prompt ?? ''}`}
                        className="group block w-full overflow-hidden rounded-md border border-(--color-border) bg-(--color-bg-deep) text-left transition-colors duration-(--dur-fast) hover:border-(--color-accent-line) disabled:opacity-50"
                      >
                        <span className="relative block aspect-square">
                          <Thumb item={item} />
                          {busy === item.assetId && (
                            <span className="absolute inset-0 flex items-center justify-center bg-(--color-bg)/70 text-[11px] text-(--color-ink)">
                              Preparing…
                            </span>
                          )}
                          {/* A live cached URL means picking this costs nothing.
                              Worth saying: it is the difference between instant
                              and a 40 MB upload. */}
                          {item.fileUrl && busy !== item.assetId && (
                            <span
                              className="absolute top-1 right-1 rounded bg-(--color-bg)/80 px-1 text-[10px] text-(--color-ok-ink)"
                              title="Already uploaded and still live — no round trip."
                            >
                              ready
                            </span>
                          )}
                        </span>
                        <span className="block border-t border-(--color-border) px-1.5 py-1">
                          <span className="mono block truncate text-[10px] text-(--color-ink-faint)">
                            {item.modelSlug}
                          </span>
                          <span className="block truncate text-[10px] text-(--color-ink-muted)">
                            {item.prompt ?? formatTimestamp(item.createdAt)}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : uploads === null ? (
              <Loading />
            ) : uploads.length === 0 ? (
              <Empty>Nothing uploaded yet that this field accepts.</Empty>
            ) : (
              <ul className="divide-y divide-(--color-border)">
                {uploads.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => void pickUpload(item)}
                      disabled={busy !== null}
                      className="flex w-full items-center gap-2 px-1.5 py-2 text-left transition-colors duration-(--dur-fast) hover:bg-(--color-accent-softer) disabled:opacity-50"
                    >
                      <KindIcon kind={item.kind} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs">
                          {item.label ?? 'Uploaded file'}
                        </span>
                        <span className="mono block text-(--color-ink-faint)">
                          {item.kind} · {formatBytes(item.bytes)} ·{' '}
                          {formatTimestamp(item.createdAt)}
                        </span>
                      </span>
                      <span
                        className={`chip shrink-0 ${item.live ? 'chip-ok' : 'chip-warn'}`}
                        title={
                          item.live
                            ? 'The cached Kie URL is still valid — reuse costs no upload.'
                            : 'Expired. The local copy is kept, so picking it re-uploads transparently.'
                        }
                      >
                        {busy === item.id ? '…' : item.live ? 'live' : 'expired'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`btn btn-sm text-xs ${
        active ? 'bg-(--color-surface-hover) text-(--color-ink)' : 'btn-quiet'
      }`}
    >
      {children}
    </button>
  )
}

function Thumb({ item }: { item: OutputItem }) {
  if (item.kind === 'image') {
    return (
      <img
        src={item.href}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
      />
    )
  }
  if (item.kind === 'video') {
    return (
      // Metadata only: a picker that autoloads twelve videos would pull hundreds
      // of megabytes off disk to draw twelve first frames.
      <video
        src={item.href}
        preload="metadata"
        muted
        playsInline
        className="h-full w-full object-cover"
      />
    )
  }
  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-(--color-ink-faint)">
      <Wave size={18} />
      <span className="mono">{formatDuration(item.durationMs)}</span>
    </span>
  )
}

function KindIcon({ kind }: { kind: string }) {
  const className = 'shrink-0 text-(--color-ink-faint)'
  if (kind === 'video') return <Film size={14} className={className} />
  if (kind === 'audio') return <Wave size={14} className={className} />
  return <ImageIcon size={14} className={className} />
}

function Loading() {
  return <p className="px-1.5 py-6 text-center text-xs text-(--color-ink-muted)">Loading…</p>
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 py-6 text-center text-xs leading-relaxed text-(--color-ink-muted)">
      {children}
    </p>
  )
}
