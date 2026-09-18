'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Fit, ZoomIn, ZoomOut } from '@/components/shell/icons.tsx'
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
import { isTypingTarget } from './keys.ts'

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
 * The component owns only the in-flight gesture and the viewport. The document
 * and its history live in the editor, so undo does not have to reach in here and
 * nothing is duplicated between the two.
 *
 * ## Zoom
 *
 * The image used to be shown at whatever size fitted, and that was the whole
 * story — which made the feature useless for its most common job. Circling one
 * button on a 4K screenshot means aiming at a target four pixels across, because
 * a 3840px-wide image fitted into a 900px panel is being shown at 23%. Marks
 * placed at that scale are guesses.
 *
 * Zoom costs the drawing code nothing, and that is by design rather than by
 * luck: **every coordinate in the document is normalized to the image**, and
 * every routine that touches one already takes the displayed size as an
 * argument. So zooming is exactly "display the image bigger and tell `renderTo`
 * and `hitTest` the new number". No transform to invert, no second coordinate
 * space, and a mark placed at 800% is stored identically to the same mark placed
 * at 23%.
 *
 * What zoom DID expose is `isSubstantial`, which used to reject a drag shorter
 * than 1.5% of the image. That threshold exists to throw away a click that
 * wobbled — a screen-space accident — so measuring it in image space made the
 * minimum mark eight times larger at 800% than at 100%, and precise marking, the
 * entire point of zooming in, impossible. It is measured in screen pixels now.
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

/**
 * A drag shorter than this, ON SCREEN, is not a shape — it is a click that
 * wobbled. In screen pixels rather than normalized units precisely so that
 * zooming in makes small marks possible instead of proportionally harder.
 */
const MIN_DRAG_PX = 4

/** How far out and in the zoom goes. Absolute, not relative to the fit. */
const MIN_SCALE = 0.05
const MAX_SCALE = 16

/** One press of a zoom button. A fifth larger reads as a step without a jump. */
const ZOOM_STEP = 1.2

interface Box {
  w: number
  h: number
}

/**
 * `null` means "whatever fits", and it is a mode rather than a number so the
 * image keeps fitting when the window resizes or the inspector opens. A number
 * is a scale the user chose, and is left alone.
 */
type Zoom = number | null

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
  /** Dragging the picture around under a fixed viewport. */
  | { kind: 'pan'; clientX: number; clientY: number }
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
  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [natural, setNatural] = useState<Box | null>(null)
  const [viewport, setViewport] = useState<Box | null>(null)
  const [zoom, setZoom] = useState<Zoom>(null)
  const [gesture, setGesture] = useState<Gesture>(null)
  /** Space held: the pointer pans instead of drawing, whatever tool is active. */
  const [spaceHeld, setSpaceHeld] = useState(false)

  /*
   * The viewport's size, tracked rather than measured once.
   *
   * It changes without the image changing — the window resizes, the inspector
   * opens, the phone turns — and the fit scale is a function of it, so a stale
   * measurement means an image that no longer fits the box it is in.
   */
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) setViewport({ w: rect.width, h: rect.height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  /**
   * The scale at which the whole image is visible.
   *
   * Capped at 1. A 200px icon blown up to fill a 900px panel is four times its
   * own resolution and looks broken; someone who wants it that size can zoom in
   * and will then know they asked for it.
   */
  const padding = 24
  const fitScale =
    natural && viewport
      ? Math.max(
          MIN_SCALE,
          Math.min(
            1,
            (viewport.w - padding) / natural.w,
            (viewport.h - padding) / natural.h,
          ),
        )
      : 1

  const scale = zoom ?? fitScale
  const box: Box | null = natural
    ? { w: Math.max(1, Math.round(natural.w * scale)), h: Math.max(1, Math.round(natural.h * scale)) }
    : null

  // ----------------------------------------------------------------- zooming

  /**
   * Where to put the scroll after a zoom, as a point of the IMAGE that must stay
   * under a point of the SCREEN.
   *
   * Held in a ref and applied in a layout effect because the correction can only
   * be computed once the browser has laid the bigger image out. Without it,
   * zooming always grows away from the top-left corner: the thing being examined
   * slides off the panel exactly when it gets big enough to see.
   */
  const anchor = useRef<{ nx: number; ny: number; clientX: number; clientY: number } | null>(null)

  useLayoutEffect(() => {
    const target = anchor.current
    anchor.current = null
    const element = imageRef.current
    const view = viewportRef.current
    if (!target || !element || !view) return

    const rect = element.getBoundingClientRect()
    view.scrollLeft += rect.left + target.nx * rect.width - target.clientX
    view.scrollTop += rect.top + target.ny * rect.height - target.clientY
  }, [scale])

  /*
   * The current scale, mirrored into a ref, and every zoom entry point reads it.
   *
   * Two zoom events inside one React batch — four fast clicks on `+`, or the
   * stream of events a trackpad pinch produces — otherwise all read the same
   * captured `scale` and all compute the same result, so four presses zoom once.
   * Assigned during render because it mirrors a value derived entirely from
   * state and props, and again inside `zoomTo` so that a batch compounds.
   */
  const scaleRef = useRef(scale)
  scaleRef.current = scale

  /** Applies a new scale, keeping `at` (a client point) over the same pixel. */
  const zoomTo = useCallback(
    (next: number, at?: { clientX: number; clientY: number }) => {
      const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next))
      const element = imageRef.current
      const view = viewportRef.current

      if (element && view) {
        const rect = element.getBoundingClientRect()
        // Absent a pointer — the toolbar buttons, the keyboard — the centre of
        // the viewport is what the user is looking at.
        const viewRect = view.getBoundingClientRect()
        const clientX = at?.clientX ?? viewRect.left + viewRect.width / 2
        const clientY = at?.clientY ?? viewRect.top + viewRect.height / 2
        anchor.current = {
          nx: rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5,
          ny: rect.height > 0 ? (clientY - rect.top) / rect.height : 0.5,
          clientX,
          clientY,
        }
      }
      // Written before the state update, not after it: a second zoom inside the
      // same React batch reads this ref, and a ref that only caught up at the
      // next render would hand it the value the first one had already replaced.
      scaleRef.current = clamped
      setZoom(clamped)
    },
    [],
  )

  const zoomBy = useCallback(
    (factor: number, at?: { clientX: number; clientY: number }) =>
      zoomTo(scaleRef.current * factor, at),
    [zoomTo],
  )

  /*
   * Ctrl/⌘ + wheel zooms; a bare wheel scrolls.
   *
   * That is the convention every image tool and every browser already uses, and
   * a trackpad pinch arrives as exactly this event. Registered by hand rather
   * than through the `onWheel` prop because React attaches its listeners
   * passively, and a passive listener may not call `preventDefault` — so the
   * browser would zoom the whole page at the same time as the canvas.
   */
  useEffect(() => {
    const element = viewportRef.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      // The delta is a continuum on a trackpad and a notch on a mouse; treating
      // it as an exponent gives both a smooth, symmetric response.
      zoomBy(Math.exp(-event.deltaY / 240), event)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  /*
   * Space to pan, and the usual zoom keys.
   *
   * The editor owns the tool shortcuts and guards them against a note being
   * typed; this guards its own the same way rather than routing four more keys
   * up through a prop, and `isTypingTarget` is the shared rule both use.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (event.code === 'Space') {
        event.preventDefault()
        setSpaceHeld(true)
        return
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        zoomBy(ZOOM_STEP)
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        zoomBy(1 / ZOOM_STEP)
      } else if (event.key === '0') {
        event.preventDefault()
        setZoom(null)
      } else if (event.key === '1') {
        event.preventDefault()
        zoomTo(1)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false)
    }
    // Cleared on blur as well: a space held while the window loses focus never
    // sees its keyup, and the surface would stay stuck in pan mode.
    const onBlur = () => setSpaceHeld(false)

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [zoomBy, zoomTo])

  // ------------------------------------------------------------------ pinch

  /**
   * Every pointer currently down, by id.
   *
   * Only needed for the two-finger case. `touch-action: none` is what makes
   * drawing with a finger work at all, and it also takes the browser's own pinch
   * zoom away — so on the device where zoom matters most, the surface has to
   * provide it itself.
   */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; scale: number } | null>(null)

  const beginPinch = useCallback(() => {
    const [a, b] = [...pointers.current.values()]
    if (!a || !b) return
    pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: scaleRef.current }
  }, [])

  // ---------------------------------------------------------------- painting

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
  }, [doc, box?.w, box?.h, gesture, selectedId])

  // -------------------------------------------------------------- gesture

  const pointFrom = useCallback((event: React.PointerEvent): Pt => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    }
  }, [])

  /** Space, the middle button, or the panning that a second finger implies. */
  const wantsPan = (event: React.PointerEvent) =>
    spaceHeld || event.button === 1 || pointers.current.size > 1

  const onPointerDown = (event: React.PointerEvent) => {
    if (!box) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (pointers.current.size === 2) {
      // A second finger turns whatever was happening into a pinch. The in-flight
      // shape is abandoned rather than committed: it was the first half of a
      // two-finger gesture, not a mark.
      setGesture(null)
      beginPinch()
      return
    }

    if (wantsPan(event)) {
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      setGesture({ kind: 'pan', clientX: event.clientX, clientY: event.clientY })
      return
    }

    if (event.button !== 0) return
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
    if (pointers.current.has(event.pointerId)) {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    }

    // Two fingers: scale by how far apart they are relative to where they began,
    // anchored on the point between them so the picture grows out of the pinch.
    if (pointers.current.size > 1 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      if (!a || !b) return
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      if (pinch.current.distance > 0) {
        zoomTo(pinch.current.scale * (distance / pinch.current.distance), {
          clientX: (a.x + b.x) / 2,
          clientY: (a.y + b.y) / 2,
        })
      }
      return
    }

    if (!gesture || !box) return

    if (gesture.kind === 'pan') {
      const view = viewportRef.current
      if (view) {
        view.scrollLeft -= event.clientX - gesture.clientX
        view.scrollTop -= event.clientY - gesture.clientY
      }
      setGesture({ kind: 'pan', clientX: event.clientX, clientY: event.clientY })
      return
    }

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
    pointers.current.delete(event.pointerId)
    if (pointers.current.size < 2) pinch.current = null

    if (!gesture) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    if (gesture.kind === 'pan') {
      setGesture(null)
      return
    }

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
    if (!box || !isSubstantial(shape, box)) return
    onCommit({ ...doc, shapes: [...doc.shapes, shape] })
  }

  // --------------------------------------------------------------- render

  const panning = spaceHeld || gesture?.kind === 'pan'

  return (
    /*
     * `min-w-0` on both, and it is not cosmetic. A flex item's default minimum
     * size is its CONTENT, so a scroller holding a 1280px image at 100% claims
     * 1280px of the row and pushes the inspector off the dialog entirely. The
     * override is what lets the panel keep its share and the image scroll inside
     * whatever is left.
     */
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div
        ref={viewportRef}
        className="min-h-0 min-w-0 flex-1 overflow-auto bg-black/30"
        /*
         * `overscroll-contain` keeps a scroll that reaches the edge of the image
         * from continuing into the page behind the dialog — which on a trackpad
         * is how the whole modal ends up scrolled sideways mid-stroke.
         */
        style={{ overscrollBehavior: 'contain' }}
      >
        {/*
          The sizer, and the reason it is not just `items-center` on the scroll
          container itself: a flex child centred inside a box SMALLER than it is
          gets its leading edge clipped, and the clipped part cannot be scrolled
          back to. At 800% that is most of the picture. A wrapper that is at
          least as large as the viewport and grows with its content centres the
          small case without ever having to clip the large one.
        */}
        <div className="flex min-h-full min-w-full items-center justify-center p-3">
          <div className="relative w-fit shrink-0 select-none">
            <img
              ref={imageRef}
              src={src}
              alt="The image you are marking up"
              draggable={false}
              /*
               * `max-w-none` matters: without it the image is capped at the
               * width of its container, and zooming past the fit would stretch
               * the canvas over a picture that had stopped growing — every mark
               * landing somewhere other than where it was drawn.
               */
              className="block max-w-none"
              style={box ? { width: box.w, height: box.h } : undefined}
              onLoad={(event) => {
                const element = event.currentTarget
                setNatural({ w: element.naturalWidth, h: element.naturalHeight })
                onImageReady(element)
              }}
              onError={() =>
                onError(
                  'That image could not be loaded for markup. If it is a pasted URL, it may ' +
                    'have expired or be unreachable from the server.',
                )
              }
            />
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onContextMenu={(event) => {
                // Otherwise a middle-click pan on some platforms opens a menu
                // over the canvas and the pointer-up never arrives.
                if (panning) event.preventDefault()
              }}
              style={{ width: box?.w, height: box?.h, touchAction: 'none' }}
              className={`absolute inset-0 ${
                panning
                  ? gesture?.kind === 'pan'
                    ? 'cursor-grabbing'
                    : 'cursor-grab'
                  : tool === 'select'
                    ? 'cursor-default'
                    : 'cursor-crosshair'
              }`}
            />
          </div>
        </div>
      </div>

      {/*
        Outside the scroller, not inside it. A control that scrolls away with the
        picture is one you have to chase to the bottom of an 8000px image to
        press.
      */}
      <ZoomBar
        scale={scale}
        fitted={zoom === null}
        onIn={() => zoomBy(ZOOM_STEP)}
        onOut={() => zoomBy(1 / ZOOM_STEP)}
        onFit={() => setZoom(null)}
        onActual={() => zoomTo(1)}
      />
    </div>
  )
}

/**
 * The zoom control, floating over the picture rather than sitting in the toolbar.
 *
 * The toolbar above already carries nine tools, seven colours, a weight and a
 * fill, and wraps to three rows on a phone. Zoom belongs to the canvas anyway —
 * it is where the user's attention is, and it is the corner every image tool
 * puts it in.
 */
function ZoomBar({
  scale,
  fitted,
  onIn,
  onOut,
  onFit,
  onActual,
}: {
  scale: number
  fitted: boolean
  onIn: () => void
  onOut: () => void
  onFit: () => void
  onActual: () => void
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-(--color-border) bg-(--color-surface)/95 px-1 py-1 shadow-[var(--shadow-lg)] backdrop-blur-sm">
        <button
          type="button"
          onClick={onOut}
          disabled={scale <= MIN_SCALE}
          title="Zoom out (−)"
          aria-label="Zoom out"
          className="btn btn-ghost btn-sm btn-icon"
        >
          <ZoomOut size={14} />
        </button>
        <button
          type="button"
          onClick={onActual}
          title="Show at 100% (1)"
          aria-label="Show at actual size"
          className="btn btn-ghost btn-sm min-w-[3.25rem] justify-center px-1 text-[11px] tabular-nums"
        >
          {formatScale(scale)}
        </button>
        <button
          type="button"
          onClick={onIn}
          disabled={scale >= MAX_SCALE}
          title="Zoom in (+)"
          aria-label="Zoom in"
          className="btn btn-ghost btn-sm btn-icon"
        >
          <ZoomIn size={14} />
        </button>
        <span className="mx-0.5 h-4 w-px bg-(--color-border)" aria-hidden />
        <button
          type="button"
          onClick={onFit}
          aria-pressed={fitted}
          title="Fit the whole image (0) — drag with space held, or scroll, to move around"
          aria-label="Fit the whole image"
          className={`btn btn-sm btn-icon ${
            fitted
              ? 'border-(--color-accent-line) bg-(--color-accent-softer) text-(--color-accent)'
              : 'btn-ghost'
          }`}
        >
          <Fit size={14} />
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ helpers

/** Percentages, with a decimal only where whole numbers would all read "0%". */
function formatScale(scale: number): string {
  const percent = scale * 100
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`
}

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

/**
 * Whether a finished gesture was a mark or a stray click.
 *
 * Measured against the DISPLAYED size, so the bar is a constant few pixels of
 * screen at every zoom level. In normalized units it was a constant fraction of
 * the image instead, which made the smallest possible mark grow in lockstep with
 * the magnification — the opposite of what zooming in is for.
 */
function isSubstantial(shape: Shape, box: Box): boolean {
  const px = (dx: number, dy: number) => Math.hypot(dx * box.w, dy * box.h)

  switch (shape.kind) {
    case 'stroke':
      // A deliberate dot is legitimate; a click that registered one point while
      // the pointer never moved is not distinguishable from it, so two points
      // is the bar.
      return shape.points.length > 1
    case 'arrow':
    case 'line':
      return px(shape.to.x - shape.from.x, shape.to.y - shape.from.y) > MIN_DRAG_PX
    case 'rect':
    case 'ellipse':
      return shape.at.w * box.w > MIN_DRAG_PX && shape.at.h * box.h > MIN_DRAG_PX
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
