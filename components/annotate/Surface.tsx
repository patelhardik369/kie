'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  DEFAULT_PIN_SIZE,
  DEFAULT_TEXT_SIZE,
  HIGHLIGHTER_OPACITY,
  boundsOf,
  clamp01,
  hitTest,
  nextPinIndex,
  rectFrom,
  renderTo,
  translate,
  type AnnotationDoc,
  type MarkerColor,
  type Pt,
  type Shape,
} from '@/lib/annotate/doc.ts'

/**
 * The drawing surface.
 *
 * Two things here are lifted directly from `components/param-form/RegionPicker.tsx`,
 * which already paid for both lessons:
 *
 *   1. **The surface shrink-wraps the image.** A letterboxed image inside a
 *      wider box puts every pointer coordinate off by the margin — silently, and
 *      only for images whose aspect differs from the panel's.
 *   2. **Pointer capture on the drag.** Without it a stroke that leaves the
 *      element mid-gesture is never finished, and the next click starts from a
 *      stale draft.
 *
 * The component owns only the in-flight gesture. The document and its history
 * live in the editor, so undo does not have to reach in here and nothing is
 * duplicated between the two.
 */

export type Tool =
  | 'select'
  | 'brush'
  | 'highlighter'
  | 'arrow'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'pin'

/** A click shorter than this in either axis is not a shape, it is a misfire. */
const MIN_DRAG = 0.015

interface Box {
  w: number
  h: number
}

type Gesture =
  | { kind: 'draw'; shape: Shape; start: Pt }
  /**
   * `origin` is the document as it stood when the drag began.
   *
   * The move is always recomputed from it as one total delta, never applied
   * incrementally: incremental translation accumulates float drift, and because
   * `translate` clamps to the image, dragging into an edge and back would
   * otherwise leave the shape stuck there.
   */
  | { kind: 'move'; id: string; start: Pt; origin: AnnotationDoc }
  | null

export function Surface({
  src,
  doc,
  tool,
  color,
  width,
  fill,
  selectedId,
  onImageReady,
  onSelect,
  onDraft,
  onCommit,
  onError,
}: {
  src: string
  doc: AnnotationDoc
  tool: Tool
  color: MarkerColor
  width: number
  fill: number
  selectedId: string | null
  onImageReady: (image: HTMLImageElement) => void
  onSelect: (id: string | null) => void
  /** A document mid-gesture. Does not enter the undo history. */
  onDraft: (doc: AnnotationDoc) => void
  /** A finished edit. Pushes onto the undo history. */
  onCommit: (doc: AnnotationDoc) => void
  onError: (message: string) => void
}) {
  const imageRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [gesture, setGesture] = useState<Gesture>(null)

  /*
   * The displayed size, tracked rather than measured once.
   *
   * It changes without the image changing — the window resizes, the inspector
   * opens, the browser zooms — and a canvas still sized to the old box would
   * draw every mark at the wrong place and scale.
   */
  useEffect(() => {
    const element = imageRef.current
    if (!element) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) setBox({ w: rect.width, h: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [src])

  // ------------------------------------------------------------- painting

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !box) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Backed at device resolution so a hairline outline is not a grey smear on
    // a retina screen, then scaled so all the drawing code stays in CSS pixels.
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(box.w * dpr)
    canvas.height = Math.round(box.h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, box.w, box.h)

    renderTo(ctx, doc, box)

    if (gesture?.kind === 'draw') {
      renderTo(ctx, { ...doc, shapes: [gesture.shape] }, box)
    }

    const selected = doc.shapes.find((shape) => shape.id === selectedId)
    if (selected) drawSelection(ctx, boundsOf(selected), box)
  }, [doc, box, gesture, selectedId])

  // -------------------------------------------------------------- gesture

  const pointFrom = useCallback((event: React.PointerEvent): Pt => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    }
  }, [])

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0 || !box) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const at = pointFrom(event)

    if (tool === 'select') {
      const hit = hitTest(doc, at, box)
      onSelect(hit?.id ?? null)
      if (hit) setGesture({ kind: 'move', id: hit.id, start: at, origin: doc })
      return
    }

    // Placed, not dragged — these two are a single click by nature.
    if (tool === 'pin') {
      const shape: Shape = {
        id: newId(),
        kind: 'pin',
        color,
        size: DEFAULT_PIN_SIZE,
        at,
        index: nextPinIndex(doc),
      }
      onCommit({ ...doc, shapes: [...doc.shapes, shape] })
      onSelect(shape.id)
      return
    }
    if (tool === 'text') {
      const shape: Shape = {
        id: newId(),
        kind: 'text',
        color,
        size: DEFAULT_TEXT_SIZE,
        at,
        text: 'Label',
        chip: true,
      }
      onCommit({ ...doc, shapes: [...doc.shapes, shape] })
      // Selected so the inspector's text field takes focus — typing the label is
      // the actual point of placing one.
      onSelect(shape.id)
      return
    }

    setGesture({ kind: 'draw', shape: seedShape(tool, at, color, width, fill), start: at })
  }

  const onPointerMove = (event: React.PointerEvent) => {
    if (!gesture || !box) return
    const at = pointFrom(event)

    if (gesture.kind === 'move') {
      const original = gesture.origin.shapes.find((shape) => shape.id === gesture.id)
      if (!original) return
      const moved = translate(original, at.x - gesture.start.x, at.y - gesture.start.y)
      onDraft({
        ...gesture.origin,
        shapes: gesture.origin.shapes.map((shape) => (shape.id === gesture.id ? moved : shape)),
      })
      return
    }

    setGesture({ ...gesture, shape: extendShape(gesture.shape, gesture.start, at) })
  }

  const onPointerUp = (event: React.PointerEvent) => {
    if (!gesture) return
    event.currentTarget.releasePointerCapture(event.pointerId)

    if (gesture.kind === 'move') {
      setGesture(null)
      /*
       * `doc` already holds the dragged position from the last draft, so
       * committing it here is what makes the whole drag ONE undo step rather
       * than one per pointermove.
       *
       * Only if it actually moved, though. A plain click to select a shape ends
       * up here too, and committing an unchanged document would put a no-op on
       * the undo stack — so undo would appear to do nothing the first time it
       * was pressed.
       */
      if (doc !== gesture.origin) onCommit(doc)
      return
    }

    const shape = gesture.shape
    setGesture(null)
    if (!isSubstantial(shape)) return
    onCommit({ ...doc, shapes: [...doc.shapes, shape] })
  }

  // --------------------------------------------------------------- render

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/30 p-3">
      <div className="relative w-fit select-none">
        <img
          ref={imageRef}
          src={src}
          alt="The image you are marking up"
          draggable={false}
          className="block max-h-[min(60vh,44rem)] max-w-full"
          onLoad={(event) => onImageReady(event.currentTarget)}
          onError={() =>
            onError(
              'That image could not be loaded for markup. If it is a pasted URL, it may have ' +
                'expired or be unreachable from the server.',
            )
          }
        />
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ width: box?.w, height: box?.h, touchAction: 'none' }}
          className={`absolute inset-0 ${
            tool === 'select' ? 'cursor-default' : 'cursor-crosshair'
          }`}
        />
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ helpers

function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

/** The shape a drag starts as, before it has any extent. */
function seedShape(
  tool: Tool,
  at: Pt,
  color: MarkerColor,
  width: number,
  fill: number,
): Shape {
  const id = newId()
  switch (tool) {
    case 'brush':
      return { id, kind: 'stroke', color, width, opacity: 1, points: [at] }
    case 'highlighter':
      // Fatter as well as translucent: a highlighter that is the same width as
      // the pen reads as a faded pen rather than as a shaded region.
      return {
        id,
        kind: 'stroke',
        color,
        width: width * 4,
        opacity: HIGHLIGHTER_OPACITY,
        points: [at],
      }
    case 'arrow':
      return { id, kind: 'arrow', color, width, from: at, to: at }
    case 'line':
      return { id, kind: 'line', color, width, from: at, to: at }
    case 'ellipse':
      return { id, kind: 'ellipse', color, width, fill, at: rectFrom(at, at) }
    default:
      return { id, kind: 'rect', color, width, fill, at: rectFrom(at, at) }
  }
}

/** Applies the current pointer position to an in-flight shape. */
function extendShape(shape: Shape, start: Pt, at: Pt): Shape {
  switch (shape.kind) {
    case 'stroke':
      return { ...shape, points: [...shape.points, at] }
    case 'arrow':
    case 'line':
      return { ...shape, to: at }
    case 'rect':
    case 'ellipse':
      return { ...shape, at: rectFrom(start, at) }
    default:
      return shape
  }
}

/** Whether a finished gesture was a mark or a stray click. */
function isSubstantial(shape: Shape): boolean {
  switch (shape.kind) {
    case 'stroke':
      // A deliberate dot is legitimate; a click that registered one point while
      // the pointer never moved is not distinguishable from it, so two points
      // is the bar.
      return shape.points.length > 1
    case 'arrow':
    case 'line':
      return Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y) > MIN_DRAG
    case 'rect':
    case 'ellipse':
      return shape.at.w > MIN_DRAG && shape.at.h > MIN_DRAG
    default:
      return true
  }
}

/**
 * The selection marker.
 *
 * Drawn as a two-tone dashed box — dark under light — so it stays visible on a
 * white sky and on a black shadow without picking a colour that could be
 * mistaken for one of the marker colours the legend names.
 */
function drawSelection(
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; w: number; h: number },
  box: Box,
): void {
  const pad = 4
  const x = bounds.x * box.w - pad
  const y = bounds.y * box.h - pad
  const w = bounds.w * box.w + pad * 2
  const h = bounds.h * box.h + pad * 2

  ctx.save()
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(0,0,0,0.75)'
  ctx.setLineDash([5, 4])
  ctx.strokeRect(x, y, w, h)
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.lineDashOffset = 5
  ctx.strokeRect(x, y, w, h)
  ctx.restore()
}
