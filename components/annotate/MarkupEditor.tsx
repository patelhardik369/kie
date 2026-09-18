'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Close } from '@/components/shell/icons.tsx'
import { errorMessage, studioFetch } from '@/lib/client/api.ts'
import { uploadInput } from '@/lib/client/upload.ts'
import {
  DEFAULT_COLOR,
  DEFAULT_WIDTH,
  buildLegend,
  emptyDoc,
  parseDoc,
  serializeDoc,
  type AnnotationDoc,
  type MarkerColor,
  type Shape,
} from '@/lib/annotate/doc.ts'
import { flatten } from './flatten.ts'
import { isTypingTarget } from './keys.ts'
import { Inspector } from './Inspector.tsx'
import { Surface, type Tool } from './Surface.tsx'
import { TOOLS, Toolbar } from './Toolbar.tsx'

/**
 * Mark up an input image so the model knows exactly what to change.
 *
 * The whole feature exists because no endpoint in scope accepts a mask — checked
 * against the registry and the live docs, and `gpt-image-2-5-flare-image-to-image`
 * takes only `prompt`, `input_urls`, `aspect_ratio` and `resolution`. So the
 * marks are drawn into a copy of the image and explained in the prompt, which is
 * the technique the model vendors document anyway, and which works on all 52
 * in-scope models that take an image and a prompt rather than on one.
 *
 * What this component owns: the document, the undo history, the legend, and the
 * save. Drawing is `Surface`, and the geometry is `lib/annotate/doc.ts`.
 */

export interface MarkupResult {
  /** The flattened, marked-up image. Replaces the field's value. */
  fileUrl: string
  /** The unmarked original, when the user asked for it to be sent too. */
  cleanUrl: string | null
  /** Prompt text describing the marks. Empty when there is nothing to say. */
  legend: string
  /** Set when the export had to change format to fit the storage ceiling. */
  note?: string
}

interface Context {
  stored: boolean
  annotationJson: string | null
  base: { assetId: string | null; mime: string | null }
  clean: { assetId: string | null; fileUrl: string | null }
  inputAssetId: string | null
}

/** How many steps back the history keeps. Long enough to cover a bad idea. */
const HISTORY_LIMIT = 60

export function MarkupEditor({
  url,
  canPair,
  onClose,
  onSave,
}: {
  /** The URL currently in the field. */
  url: string
  /** Whether the field has room for the clean original alongside the marked one. */
  canPair: boolean
  onClose: () => void
  onSave: (result: MarkupResult) => void
}) {
  const [context, setContext] = useState<Context | null>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [doc, setDoc] = useState<AnnotationDoc | null>(null)
  /** The undo stack and the cursor into it, as one value. See `commit`. */
  const [history, setHistory] = useState<{ stack: AnnotationDoc[]; at: number }>({
    stack: [],
    at: 0,
  })

  const [tool, setTool] = useState<Tool>('ellipse')
  const [color, setColor] = useState<MarkerColor>(DEFAULT_COLOR)
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH)
  const [fill, setFill] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [legendOverride, setLegendOverride] = useState<string | null>(null)
  const [paired, setPaired] = useState(false)
  const [saving, setSaving] = useState(false)
  /**
   * 0-1 while the flattened image is in transit, null otherwise.
   *
   * A marked-up 4K screenshot is routinely ten megabytes and takes real seconds
   * to upload. Without this the button says "Saving…" and nothing else moves,
   * which is how someone concludes it has hung and presses Cancel on ten minutes
   * of marking.
   */
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const panel = useRef<HTMLDivElement>(null)
  /** What the last commit was coalescing on, so a run of edits is one step. */
  const coalescing = useRef<string | null>(null)

  /*
   * Where the pixels come from.
   *
   * Always our own origin. A Kie URL or a Supabase signed URL would taint the
   * canvas and make `toDataURL` throw at the very end of the interaction, after
   * all the work — see app/api/annotate/source/route.ts.
   */
  const baseSrc = useMemo(() => {
    if (!context) return null
    return context.base.assetId
      ? `/api/annotate/source?assetId=${encodeURIComponent(context.base.assetId)}`
      : `/api/annotate/source?url=${encodeURIComponent(url)}`
  }, [context, url])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await studioFetch<Context>(
          `/api/annotate/context?url=${encodeURIComponent(url)}`,
          { cache: 'no-store' },
        )
        if (!cancelled) setContext(data)
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [url])

  /**
   * The document can only be built once the image's natural size is known — the
   * saved marks are validated against its aspect before they are trusted, and a
   * document that does not match is dropped rather than drawn in the wrong
   * places.
   */
  const onImageReady = useCallback(
    (element: HTMLImageElement) => {
      setImage(element)
      if (doc) return

      const size = { width: element.naturalWidth, height: element.naturalHeight }
      const saved = parseDoc(context?.annotationJson, size)
      if (context?.annotationJson && !saved) {
        setError(
          'The saved marks were drawn on a differently-shaped image, so they were not ' +
            'restored. The picture is untouched — mark it again.',
        )
      }
      const next = saved ?? emptyDoc(size.width, size.height)
      setDoc(next)
      setHistory({ stack: [next], at: 0 })
    },
    [context, doc],
  )

  // ------------------------------------------------------------- history

  /**
   * The stack and the cursor into it are ONE piece of state.
   *
   * Held apart, the only way to push is to call `setHistoryAt` from inside
   * `setHistory`'s updater — a setState inside another updater, which React is
   * free to invoke twice, and which then lands the cursor on the wrong entry.
   * Together, the push is a pure function of the previous value.
   */
  const commit = useCallback((next: AnnotationDoc, coalesce?: string) => {
    /*
     * Consecutive edits to the same mark collapse into one entry.
     *
     * Without this, typing a forty-character note is forty history entries:
     * undo walks back letter by letter, and the 60-entry limit evicts every
     * shape the user actually drew. `coalesce` is the mark's id, so a run of
     * edits to one mark is one step, and drawing anything — or touching a
     * different mark — starts a new one.
     *
     * **Decided here, before the ref is moved on, and never inside the updater
     * below.** React runs an updater at flush time, which is after this function
     * has returned — so an updater reading `coalescing.current` would see the
     * value this very call just wrote, making the FIRST edit to a mark coalesce
     * with whatever preceded it. The visible symptom was one undo deleting both
     * a note and the shape it was attached to.
     */
    const replace = coalesce !== undefined && coalesce === coalescing.current
    coalescing.current = coalesce ?? null

    setDoc(next)
    setHistory(({ stack, at }) => {
      const head = stack.slice(0, replace && stack.length > 0 ? at : at + 1)
      const trimmed = [...head, next]
      const overflow = Math.max(0, trimmed.length - HISTORY_LIMIT)
      const kept = overflow > 0 ? trimmed.slice(overflow) : trimmed
      return { stack: kept, at: kept.length - 1 }
    })
  }, [])

  /** Steps the cursor and republishes the document it points at. */
  const step = useCallback(
    (delta: number) => {
      const at = history.at + delta
      if (at < 0 || at >= history.stack.length) return
      setHistory({ ...history, at })
      setDoc(history.stack[at]!)
      setSelectedId(null)
      coalescing.current = null
    },
    [history],
  )

  const undo = useCallback(() => step(-1), [step])
  const redo = useCallback(() => step(1), [step])

  const updateShape = useCallback(
    (shape: Shape) => {
      if (!doc) return
      commit(
        {
          ...doc,
          shapes: doc.shapes.map((existing) => (existing.id === shape.id ? shape : existing)),
        },
        // Keyed on the mark, so typing its note is one undo step.
        shape.id,
      )
    },
    [doc, commit],
  )

  const deleteShape = useCallback(
    (id: string) => {
      if (!doc) return
      commit({ ...doc, shapes: doc.shapes.filter((shape) => shape.id !== id) })
      setSelectedId(null)
    },
    [doc, commit],
  )

  // -------------------------------------------------------------- legend

  const generated = useMemo(
    () => (doc ? buildLegend(doc, { paired: paired && canPair }) : ''),
    [doc, paired, canPair],
  )
  const legend = legendOverride ?? generated

  // ------------------------------------------------------------ keyboard

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never steal a keystroke from a note the user is typing. The inspector is
      // a text field sitting beside nine single-letter shortcuts, and without
      // this, writing "box" would change the tool three times. The same rule
      // guards the canvas's own zoom keys — see `keys.ts`.
      const typing = isTypingTarget(event.target)

      if (event.key === 'Escape') {
        event.preventDefault()
        if (typing) (event.target as HTMLElement).blur()
        else attemptClose()
        return
      }
      if (typing) return

      const meta = event.metaKey || event.ctrlKey
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) {
        event.preventDefault()
        deleteShape(selectedId)
        return
      }

      const match = TOOLS.find((spec) => spec.key.toLowerCase() === event.key.toLowerCase())
      if (match) {
        event.preventDefault()
        setTool(match.tool)
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  })

  /*
   * Focus moves into the dialog on open and the page behind it stops scrolling.
   * Both are what make this a dialog rather than a panel that happens to be on
   * top: without the first, Tab walks the form underneath; without the second,
   * a touch drag on the canvas scrolls the page.
   */
  useEffect(() => {
    panel.current?.focus()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  const dirty = (doc?.shapes.length ?? 0) > 0 || legendOverride !== null

  function attemptClose() {
    // A misplaced Escape at the end of ten minutes of marking is not something
    // to be quietly obeyed.
    if (dirty && !window.confirm('Discard these marks?')) return
    onClose()
  }

  // ---------------------------------------------------------------- save

  async function save() {
    if (!image || !doc) return
    setSaving(true)
    setProgress(null)
    setError(null)

    try {
      const flattened = await flatten(image, doc, context?.base.mime ?? undefined)

      /*
       * Uploaded through `lib/client/upload.ts` rather than by posting the blob
       * at `/api/upload` directly.
       *
       * This is the call that used to fail. A flattened PNG passes the
       * platform's 4.5 MB request-body cap for any screenshot worth marking up,
       * and the cap is enforced before the route runs — so the browser got a
       * plain-text `Request Entity Too Large` and reported it as a JSON parse
       * error about a stray `R`. The helper sends anything that size straight to
       * the bucket instead, and the function only ever sees the key.
       */
      const uploaded = await uploadInput(flattened.blob, flattened.filename, {
        label: `Marked up · ${doc.shapes.length} mark${doc.shapes.length === 1 ? '' : 's'}`,
        annotation: {
          doc: JSON.parse(serializeDoc(doc)),
          // What the marks were drawn on. When re-editing, that is the ORIGINAL
          // the previous round recorded, never the flattened copy currently in
          // the field — otherwise the chain of originals grows a link per edit.
          sourceAssetId: context?.base.assetId ?? context?.inputAssetId ?? null,
        },
        onProgress: setProgress,
      })

      const cleanUrl = paired && canPair ? await resolveCleanUrl(context, url) : null

      onSave({
        fileUrl: uploaded.fileUrl,
        cleanUrl,
        legend,
        note: flattened.note,
      })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
      setProgress(null)
    }
  }

  // -------------------------------------------------------------- render

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-(--color-bg)/85 backdrop-blur-sm">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Mark up this image"
        tabIndex={-1}
        className="m-auto flex h-full max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-none border-(--color-border) bg-(--color-surface) shadow-[var(--shadow-lg)] outline-none sm:h-[min(92vh,60rem)] sm:rounded-xl sm:border"
      >
        <header className="flex items-center gap-3 border-b border-(--color-border) px-3 py-2">
          <h2 className="text-[13px] font-medium">Mark up this image</h2>
          <p className="hidden min-w-0 flex-1 truncate text-[11px] text-(--color-ink-faint) sm:block">
            The marks are drawn into a copy — your original is untouched.
          </p>
          <button
            type="button"
            onClick={attemptClose}
            className="btn btn-ghost btn-sm btn-icon ml-auto sm:ml-0"
            aria-label="Close"
          >
            <Close size={14} />
          </button>
        </header>

        {doc && (
          <Toolbar
            tool={tool}
            color={color}
            width={width}
            fill={fill}
            canUndo={history.at > 0}
            canRedo={history.at < history.stack.length - 1}
            shapeCount={doc.shapes.length}
            onTool={setTool}
            onColor={setColor}
            onWidth={setWidth}
            onFill={setFill}
            onUndo={undo}
            onRedo={redo}
            onClear={() => {
              commit({ ...doc, shapes: [] })
              setSelectedId(null)
            }}
          />
        )}

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          {baseSrc ? (
            <Surface
              src={baseSrc}
              doc={doc ?? emptyDoc(1, 1)}
              tool={tool}
              color={color}
              width={width}
              fill={fill}
              selectedId={selectedId}
              onImageReady={onImageReady}
              onSelect={setSelectedId}
              onDraft={setDoc}
              onCommit={commit}
              onError={setError}
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-(--color-ink-muted)">
              {error ? 'Could not open that image.' : 'Loading the image…'}
            </div>
          )}

          {doc && (
            <Inspector
              doc={doc}
              selectedId={selectedId}
              legend={legend}
              legendEdited={legendOverride !== null}
              canPair={canPair}
              paired={paired}
              onSelect={setSelectedId}
              onUpdate={updateShape}
              onDelete={deleteShape}
              onLegendChange={setLegendOverride}
              onLegendReset={() => setLegendOverride(null)}
              onPairedChange={setPaired}
            />
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-(--color-border) px-3 py-2">
          {error && (
            <p className="note note-bad w-full px-2 py-1.5 text-[11px]" role="alert">
              {error}
            </p>
          )}
          <p className="hidden text-[11px] text-(--color-ink-faint) sm:block">
            {doc?.shapes.length ?? 0} mark{doc?.shapes.length === 1 ? '' : 's'}
          </p>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={attemptClose} className="btn btn-ghost btn-sm">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving || !image || !doc || doc.shapes.length === 0}
              className="btn btn-sm border-(--color-accent-line) bg-(--color-accent-softer) text-(--color-accent)"
              title={
                doc?.shapes.length === 0
                  ? 'Draw at least one mark first.'
                  : 'Flatten the marks into a new image and use it in this field'
              }
            >
              {saving
                ? progress !== null && progress < 1
                  ? `Uploading ${Math.round(progress * 100)}%`
                  : 'Saving…'
                : 'Use marked-up image'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

/**
 * A live URL for the unmarked original.
 *
 * Three cases, and the middle one is the reason this is not just a field read:
 * the original's Kie upload lasts about a day, so a photo marked up on Monday
 * and re-edited on Wednesday has no live URL left. Our own copy survives, and
 * `POST /api/input-assets/<id>` re-uploads from it — the same path the asset
 * picker already uses for an expired entry.
 */
async function resolveCleanUrl(context: Context | null, fieldUrl: string): Promise<string | null> {
  if (context?.clean.fileUrl) return context.clean.fileUrl

  if (context?.clean.assetId) {
    const data = await studioFetch<{ fileUrl?: string }>(
      `/api/input-assets/${context.clean.assetId}`,
      { method: 'POST' },
    )
    return typeof data.fileUrl === 'string' && data.fileUrl ? data.fileUrl : null
  }

  // First time marking this image up: the field still holds the clean original.
  return fieldUrl
}
