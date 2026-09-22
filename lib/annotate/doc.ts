/**
 * The annotation document — what a marked-up input image actually is.
 *
 * Pure module. No React, no network, and no DOM beyond a `CanvasRenderingContext2D`
 * the caller passes in, so everything except the drawing itself is unit-testable.
 *
 * ## Why marks are burned into pixels rather than sent as a mask
 *
 * Not one of the 97 in-scope models accepts a mask channel. Checked against the
 * registry, the reference tables and the live doc pages on 2026-09-13:
 * `gpt-image-2-5-flare-image-to-image`, the endpoint behind the feature this
 * imitates, takes exactly `prompt`, `input_urls`, `aspect_ratio` and `resolution`.
 * Inventing a `mask_url` would break the first rule in .claude/CLAUDE.md.
 *
 * So a mark is a coloured shape drawn ONTO a copy of the image, and the prompt
 * names it. That is the technique Nano Banana Pro's own prompting guide
 * prescribes — circle it, arrow it, number it, then refer to the marker in
 * words — and because it happens in pixels it works on every prompt-driven
 * image model instead of one vendor's.
 *
 * ## Two decisions everything else rests on
 *
 * **Geometry is normalized 0–1 against the source image.** Never pixels. The
 * same document therefore renders identically on a 400px preview and on the
 * 4096px flatten that actually gets uploaded, and it stays correct if the image
 * is later re-encoded at a different scale. Stroke widths and text sizes are a
 * fraction of the LONG EDGE, so a mark keeps its visual weight on a panorama
 * and on a square.
 *
 * **Colour is stored as a name, not a hex.** `'red'`, not `'#ff2d2d'`. The name
 * is what the legend says and therefore what the model reads, so it has to
 * survive in the document rather than be reverse-looked-up from a hex that a
 * later palette tweak would orphan.
 */

export const DOC_VERSION = 1

/** A point in the source image's normalized space. Both axes 0–1. */
export interface Pt {
  x: number
  y: number
}

/** A rectangle in normalized space. `w`/`h` are always positive. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * The marker palette.
 *
 * Seven, deliberately: high-contrast against photographic content, and
 * distinguishable from each other in words. A model told "the cyan arrow" has
 * to be able to find exactly one cyan thing, so near-neighbours (two blues, two
 * greens) are worse than useless — they make the legend ambiguous.
 *
 * `ink` is what a numbered pin's digit is drawn in, picked for contrast against
 * that swatch rather than computed, because only two of the seven are light.
 */
export const MARKER_COLORS = [
  { name: 'red', hex: '#ff2d2d', ink: '#ffffff' },
  { name: 'orange', hex: '#ff8c1a', ink: '#1a1000' },
  { name: 'yellow', hex: '#ffd60a', ink: '#1a1400' },
  { name: 'lime', hex: '#3cff5e', ink: '#00220a' },
  { name: 'cyan', hex: '#22d8ff', ink: '#001a22' },
  { name: 'magenta', hex: '#ff3ce0', ink: '#ffffff' },
  { name: 'white', hex: '#ffffff', ink: '#111111' },
] as const

export type MarkerColor = (typeof MARKER_COLORS)[number]['name']

export const DEFAULT_COLOR: MarkerColor = 'red'

/** Hex for a colour name, falling back to red for a document from the future. */
export function hexOf(color: MarkerColor): string {
  return (MARKER_COLORS.find((c) => c.name === color) ?? MARKER_COLORS[0]).hex
}

/** The digit colour for a numbered pin on that swatch. */
export function inkOf(color: MarkerColor): string {
  return (MARKER_COLORS.find((c) => c.name === color) ?? MARKER_COLORS[0]).ink
}

// ------------------------------------------------------------------ shapes

interface ShapeBase {
  id: string
  color: MarkerColor
  /**
   * What this mark means, in the user's words.
   *
   * Optional, and its absence is meaningful: a shape with no note still tells
   * the model "something here matters" and still earns the do-not-render
   * preamble, but it contributes no legend line. Marking without explaining is
   * a legitimate way to work.
   */
  note?: string
}

/** Freehand. `opacity` below 1 is the highlighter — shade a region, keep it readable. */
export interface StrokeShape extends ShapeBase {
  kind: 'stroke'
  width: number
  opacity: number
  points: Pt[]
}

export interface ArrowShape extends ShapeBase {
  kind: 'arrow'
  width: number
  from: Pt
  to: Pt
}

export interface LineShape extends ShapeBase {
  kind: 'line'
  width: number
  from: Pt
  to: Pt
}

/** `fill` is the interior alpha; 0 leaves it an outline. */
export interface RectShape extends ShapeBase {
  kind: 'rect'
  width: number
  fill: number
  at: Rect
}

export interface EllipseShape extends ShapeBase {
  kind: 'ellipse'
  width: number
  fill: number
  at: Rect
}

/** A typed label. `chip` puts a solid plate behind it so it survives a busy photo. */
export interface TextShape extends ShapeBase {
  kind: 'text'
  size: number
  at: Pt
  text: string
  chip: boolean
}

/**
 * A numbered badge — ①, ②, ③.
 *
 * The most useful marker in the set, because it turns one prompt into a list:
 * "replace ① with a lamp, remove ②, recolour ③". `index` is stored rather than
 * derived from array position so deleting ② does not silently renumber the
 * notes the user already wrote about ③.
 */
export interface PinShape extends ShapeBase {
  kind: 'pin'
  size: number
  at: Pt
  index: number
}

export type Shape =
  | StrokeShape
  | ArrowShape
  | LineShape
  | RectShape
  | EllipseShape
  | TextShape
  | PinShape

export type ShapeKind = Shape['kind']

export interface AnnotationDoc {
  version: typeof DOC_VERSION
  /**
   * The natural size of the image the marks were drawn on.
   *
   * Recorded for provenance and for the aspect check in `parseDoc`. NOT used to
   * scale anything — the geometry is already resolution-independent.
   */
  source: { width: number; height: number }
  shapes: Shape[]
}

// ------------------------------------------------------------- defaults

/** Fractions of the long edge. Tuned so a default mark reads at a glance. */
export const DEFAULT_WIDTH = 0.006
export const DEFAULT_TEXT_SIZE = 0.045
export const DEFAULT_PIN_SIZE = 0.055
export const HIGHLIGHTER_OPACITY = 0.35

export function emptyDoc(width: number, height: number): AnnotationDoc {
  return { version: DOC_VERSION, source: { width, height }, shapes: [] }
}

export function isEmpty(doc: AnnotationDoc): boolean {
  return doc.shapes.length === 0
}

/** The number the next pin should carry — highest in use plus one, never reused. */
export function nextPinIndex(doc: AnnotationDoc): number {
  let highest = 0
  for (const shape of doc.shapes) {
    if (shape.kind === 'pin' && shape.index > highest) highest = shape.index
  }
  return highest + 1
}

export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/** A rectangle from two dragged corners, normalized and always positive-sized. */
export function rectFrom(a: Pt, b: Pt): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

// -------------------------------------------------------------- geometry

/**
 * Every point a shape is anchored by.
 *
 * One helper rather than a switch in each of translate, bounds and hit-test —
 * a new shape kind then has exactly one place to declare its anchors.
 */
function anchorsOf(shape: Shape): Pt[] {
  switch (shape.kind) {
    case 'stroke':
      return shape.points
    case 'arrow':
    case 'line':
      return [shape.from, shape.to]
    case 'rect':
    case 'ellipse':
      return [
        { x: shape.at.x, y: shape.at.y },
        { x: shape.at.x + shape.at.w, y: shape.at.y + shape.at.h },
      ]
    case 'text':
    case 'pin':
      return [shape.at]
  }
}

/** The normalized bounding box of a shape, ignoring stroke width. */
export function boundsOf(shape: Shape): Rect {
  const points = anchorsOf(shape)
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/**
 * Moves a shape by a normalized delta, clamped so it cannot be dragged off the
 * image entirely.
 *
 * The clamp is applied to the WHOLE shape rather than per-point: clamping each
 * point independently would squash a stroke against the edge instead of
 * stopping it, quietly deforming marks the user had already placed.
 */
export function translate(shape: Shape, dx: number, dy: number): Shape {
  const box = boundsOf(shape)
  const ddx = Math.max(-box.x, Math.min(1 - (box.x + box.w), dx))
  const ddy = Math.max(-box.y, Math.min(1 - (box.y + box.h), dy))
  const move = (p: Pt): Pt => ({ x: p.x + ddx, y: p.y + ddy })

  switch (shape.kind) {
    case 'stroke':
      return { ...shape, points: shape.points.map(move) }
    case 'arrow':
    case 'line':
      return { ...shape, from: move(shape.from), to: move(shape.to) }
    case 'rect':
    case 'ellipse':
      return { ...shape, at: { ...shape.at, x: shape.at.x + ddx, y: shape.at.y + ddy } }
    case 'text':
    case 'pin':
      return { ...shape, at: move(shape.at) }
  }
}

/** Pixel distance from `p` to the segment `a`–`b`, all in pixel space. */
function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const lengthSq = vx * vx + vy * vy
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / lengthSq))
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy))
}

/**
 * Which shape is under the pointer, or null.
 *
 * Works in PIXEL space, not normalized space: normalized distance is anisotropic
 * on any non-square image, so a 10px grab radius near a stroke would be generous
 * horizontally and stingy vertically on a 16:9 photo. The caller passes the
 * displayed size and everything is converted first.
 *
 * Searched back to front so the topmost shape — the last one drawn, and the one
 * the user can actually see — wins an overlap.
 */
export function hitTest(
  doc: AnnotationDoc,
  point: Pt,
  size: { w: number; h: number },
  tolerancePx = 6,
): Shape | null {
  const unit = Math.max(size.w, size.h)
  const px = (p: Pt): Pt => ({ x: p.x * size.w, y: p.y * size.h })
  const target = px(point)

  for (let i = doc.shapes.length - 1; i >= 0; i -= 1) {
    const shape = doc.shapes[i]!
    if (hits(shape, target, px, unit, tolerancePx)) return shape
  }
  return null
}

function hits(
  shape: Shape,
  target: Pt,
  px: (p: Pt) => Pt,
  unit: number,
  tolerance: number,
): boolean {
  switch (shape.kind) {
    case 'stroke': {
      const grab = (shape.width * unit) / 2 + tolerance
      const points = shape.points.map(px)
      if (points.length === 1) return Math.hypot(target.x - points[0]!.x, target.y - points[0]!.y) <= grab
      for (let i = 1; i < points.length; i += 1) {
        if (distanceToSegment(target, points[i - 1]!, points[i]!) <= grab) return true
      }
      return false
    }
    case 'arrow':
    case 'line': {
      const grab = (shape.width * unit) / 2 + tolerance
      return distanceToSegment(target, px(shape.from), px(shape.to)) <= grab
    }
    case 'rect':
    case 'ellipse': {
      const a = px({ x: shape.at.x, y: shape.at.y })
      const b = px({ x: shape.at.x + shape.at.w, y: shape.at.y + shape.at.h })
      const grab = (shape.width * unit) / 2 + tolerance
      const inside =
        target.x >= a.x - grab &&
        target.x <= b.x + grab &&
        target.y >= a.y - grab &&
        target.y <= b.y + grab
      if (!inside) return false
      // A filled shape is grabbable anywhere; an outline only on its border,
      // so a box drawn around a subject does not swallow clicks meant for
      // whatever sits inside it.
      if (shape.fill > 0) return true
      const inner =
        target.x >= a.x + grab &&
        target.x <= b.x - grab &&
        target.y >= a.y + grab &&
        target.y <= b.y - grab
      return !inner
    }
    case 'pin': {
      const at = px(shape.at)
      return Math.hypot(target.x - at.x, target.y - at.y) <= (shape.size * unit) / 2 + tolerance
    }
    case 'text': {
      const at = px(shape.at)
      const height = shape.size * unit
      // Approximate: the real advance width needs a measured context, which a
      // pure module does not have. 0.55em per character is close enough for a
      // grab box, and erring wide is the kind side of the error.
      const width = Math.max(1, shape.text.length) * height * 0.55
      return (
        target.x >= at.x - tolerance &&
        target.x <= at.x + width + tolerance &&
        target.y >= at.y - height - tolerance &&
        target.y <= at.y + tolerance
      )
    }
  }
}

// ---------------------------------------------------------------- legend

/** ①–⑳, then a plain fallback. U+2460 is ①. */
export function circledNumber(n: number): string {
  if (n >= 1 && n <= 20) return String.fromCodePoint(0x2460 + n - 1)
  return `(${n})`
}

/**
 * How a mark is named in words.
 *
 * These strings are read by a generative model, so they are chosen to be
 * unambiguous rather than precise: "circle" beats "ellipse", "box" beats
 * "rectangle", and a translucent stroke is a "shaded area" because that is what
 * it looks like and what the model has seen described that way.
 */
function phraseOf(shape: Shape): string {
  switch (shape.kind) {
    case 'stroke':
      return shape.opacity < 1 ? `${shape.color} shaded area` : `${shape.color} brush mark`
    case 'arrow':
      return `${shape.color} arrow`
    case 'line':
      return `${shape.color} line`
    case 'rect':
      return shape.fill > 0 ? `${shape.color} filled box` : `${shape.color} box`
    case 'ellipse':
      return shape.fill > 0 ? `${shape.color} filled circle` : `${shape.color} circle`
    case 'text':
      return `"${shape.text}" label`
    case 'pin':
      return circledNumber(shape.index)
  }
}

export interface LegendOptions {
  /**
   * A clean copy of the image is being sent alongside the annotated one.
   *
   * Adds the line that tells the model which is which. Without it the model has
   * two near-identical images and no stated reason for the difference, which is
   * a good way to get the marks treated as content in both.
   */
  paired?: boolean
}

export const LEGEND_PREAMBLE =
  'Annotation guide — the coloured marks on this image are instructions, not content. ' +
  'Do not draw, keep, or reproduce any mark, arrow, number or label in the output.'

const PAIRED_LINE =
  'The second image is the same photo with no marks on it — take all pixel detail from that one.'

/**
 * The prompt text that explains the marks.
 *
 * Assembled here rather than in the editor so it can be tested, and so the
 * do-not-render preamble cannot be lost by a UI refactor — that sentence is the
 * difference between an edited photo and an edited photo with a red circle
 * painted onto it.
 *
 * Returns '' for a document with no shapes: there is nothing to explain, and an
 * unexplained preamble injected into a prompt would be noise.
 */
export function buildLegend(doc: AnnotationDoc, options: LegendOptions = {}): string {
  if (doc.shapes.length === 0) return ''

  const lines: string[] = [LEGEND_PREAMBLE]
  if (options.paired) lines.push(PAIRED_LINE)

  const noted = doc.shapes.filter((shape) => (shape.note ?? '').trim().length > 0)
  if (noted.length > 0) {
    lines.push('')
    // Two marks that read the same in words are useless as references, so
    // duplicates are ordinal-tagged rather than left ambiguous. Pins are exempt
    // — their number already makes them unique.
    const counts = new Map<string, number>()
    for (const shape of noted) {
      const phrase = phraseOf(shape)
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1)
    }
    const seen = new Map<string, number>()

    for (const shape of noted) {
      const phrase = phraseOf(shape)
      let name = phrase
      if ((counts.get(phrase) ?? 0) > 1 && shape.kind !== 'pin') {
        const n = (seen.get(phrase) ?? 0) + 1
        seen.set(phrase, n)
        name = `${phrase} (${ordinal(n)})`
      }
      lines.push(`${name} — ${shape.note!.trim()}`)
    }
  }

  return lines.join('\n')
}

/**
 * Puts a legend into a prompt, replacing one this feature put there before.
 *
 * Marking an image up twice is the normal case — draw, look at the result,
 * adjust a note — and a plain append would leave the prompt carrying two
 * legends, the stale one first. Contradictory instructions are worse than none,
 * and nobody reads to the bottom of a prompt field to notice.
 *
 * The preamble is the anchor, because it is fixed text this module controls.
 * Anything the user wrote above it survives untouched; anything from the last
 * legend onwards is replaced. An empty legend therefore also REMOVES a previous
 * one, which is what clearing every mark should do.
 */
export function insertLegend(prompt: string, legend: string): string {
  const existing = prompt.lastIndexOf(LEGEND_PREAMBLE)
  const base = (existing >= 0 ? prompt.slice(0, existing) : prompt).trimEnd()
  if (!legend) return base
  return base ? `${base}\n\n${legend}` : legend
}

function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

// ------------------------------------------------------- persist / parse

/**
 * Reads a stored document back, or returns null.
 *
 * Validated against the image it is about to be drawn on by ASPECT RATIO, not
 * by exact pixel size. Normalized geometry is already scale-free, so the same
 * marks apply perfectly to a re-encoded or resized copy; only a crop or a
 * rotation invalidates them, and both change the aspect.
 *
 * Null rather than throwing, and null rather than a partial recovery: marks
 * silently landing in the wrong places is worse than an empty overlay and a
 * message saying the saved marks did not fit this image.
 */
export function parseDoc(
  json: string | null | undefined,
  source?: { width: number; height: number },
): AnnotationDoc | null {
  if (!json) return null

  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }

  if (typeof raw !== 'object' || raw === null) return null
  const doc = raw as Partial<AnnotationDoc>
  if (doc.version !== DOC_VERSION) return null
  if (!Array.isArray(doc.shapes)) return null
  if (
    typeof doc.source !== 'object' ||
    doc.source === null ||
    !(doc.source.width > 0) ||
    !(doc.source.height > 0)
  ) {
    return null
  }

  if (source && !sameAspect(doc.source, source)) return null

  return { version: DOC_VERSION, source: doc.source, shapes: doc.shapes as Shape[] }
}

/** Within 1%, which absorbs rounding from a re-encode without letting a crop through. */
export function sameAspect(
  a: { width: number; height: number },
  b: { width: number; height: number },
): boolean {
  const ra = a.width / a.height
  const rb = b.width / b.height
  return Math.abs(ra - rb) / Math.max(ra, rb) < 0.01
}

export function serializeDoc(doc: AnnotationDoc): string {
  return JSON.stringify(doc)
}

// --------------------------------------------------------------- drawing

/**
 * Draws every shape onto a context sized `size`, in order.
 *
 * The one impure-ish export, and the only one without unit tests — asserting on
 * canvas output needs a real canvas. It is exercised in the browser instead, by
 * the editor preview and the flatten, which run the SAME function at two very
 * different scales. That is the check that matters: if the preview and the
 * uploaded image agree, the normalized geometry is right.
 */
export function renderTo(
  ctx: CanvasRenderingContext2D,
  doc: AnnotationDoc,
  size: { w: number; h: number },
): void {
  const unit = Math.max(size.w, size.h)
  const px = (p: Pt): Pt => ({ x: p.x * size.w, y: p.y * size.h })

  for (const shape of doc.shapes) {
    ctx.save()
    const hex = hexOf(shape.color)
    ctx.strokeStyle = hex
    ctx.fillStyle = hex
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    switch (shape.kind) {
      case 'stroke': {
        ctx.globalAlpha = shape.opacity
        ctx.lineWidth = shape.width * unit
        ctx.beginPath()
        shape.points.forEach((point, index) => {
          const p = px(point)
          if (index === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        })
        // A single tap is a dot, not nothing.
        if (shape.points.length === 1) {
          const p = px(shape.points[0]!)
          ctx.lineTo(p.x + 0.01, p.y)
        }
        ctx.stroke()
        break
      }
      case 'line': {
        ctx.lineWidth = shape.width * unit
        const a = px(shape.from)
        const b = px(shape.to)
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
        break
      }
      case 'arrow': {
        const w = shape.width * unit
        ctx.lineWidth = w
        const a = px(shape.from)
        const b = px(shape.to)
        const angle = Math.atan2(b.y - a.y, b.x - a.x)
        // Proportional to the stroke, so a thin arrow does not get a huge head.
        const head = Math.max(w * 3.5, unit * 0.018)
        // The shaft stops short of the tip so the head reads as solid rather
        // than as a line with a triangle laid over it.
        const shaftX = b.x - Math.cos(angle) * head * 0.8
        const shaftY = b.y - Math.sin(angle) * head * 0.8
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(shaftX, shaftY)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(b.x, b.y)
        ctx.lineTo(
          b.x - Math.cos(angle - Math.PI / 7) * head,
          b.y - Math.sin(angle - Math.PI / 7) * head,
        )
        ctx.lineTo(
          b.x - Math.cos(angle + Math.PI / 7) * head,
          b.y - Math.sin(angle + Math.PI / 7) * head,
        )
        ctx.closePath()
        ctx.fill()
        break
      }
      case 'rect': {
        const a = px({ x: shape.at.x, y: shape.at.y })
        const w = shape.at.w * size.w
        const h = shape.at.h * size.h
        if (shape.fill > 0) {
          ctx.globalAlpha = shape.fill
          ctx.fillRect(a.x, a.y, w, h)
          ctx.globalAlpha = 1
        }
        ctx.lineWidth = shape.width * unit
        ctx.strokeRect(a.x, a.y, w, h)
        break
      }
      case 'ellipse': {
        const cx = (shape.at.x + shape.at.w / 2) * size.w
        const cy = (shape.at.y + shape.at.h / 2) * size.h
        const rx = (shape.at.w / 2) * size.w
        const ry = (shape.at.h / 2) * size.h
        ctx.beginPath()
        ctx.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2)
        if (shape.fill > 0) {
          ctx.globalAlpha = shape.fill
          ctx.fill()
          ctx.globalAlpha = 1
        }
        ctx.lineWidth = shape.width * unit
        ctx.stroke()
        break
      }
      case 'text': {
        const at = px(shape.at)
        const height = shape.size * unit
        ctx.font = `600 ${height}px system-ui, -apple-system, "Segoe UI", sans-serif`
        ctx.textBaseline = 'alphabetic'
        if (shape.chip) {
          const pad = height * 0.28
          const width = ctx.measureText(shape.text).width
          ctx.globalAlpha = 0.85
          ctx.fillStyle = hex
          ctx.fillRect(at.x - pad, at.y - height + pad * 0.2, width + pad * 2, height + pad * 0.6)
          ctx.globalAlpha = 1
          ctx.fillStyle = inkOf(shape.color)
        }
        ctx.fillText(shape.text, at.x, at.y)
        break
      }
      case 'pin': {
        const at = px(shape.at)
        const r = (shape.size * unit) / 2
        ctx.beginPath()
        ctx.arc(at.x, at.y, r, 0, Math.PI * 2)
        ctx.fill()
        // A ring in the pin's own ink, so a pale badge still separates from a
        // pale background.
        ctx.lineWidth = Math.max(1, r * 0.12)
        ctx.strokeStyle = inkOf(shape.color)
        ctx.stroke()
        ctx.fillStyle = inkOf(shape.color)
        ctx.font = `700 ${r * 1.25}px system-ui, -apple-system, "Segoe UI", sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(String(shape.index), at.x, at.y + r * 0.04)
        break
      }
    }
    ctx.restore()
  }
}
