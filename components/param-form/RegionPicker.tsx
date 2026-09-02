'use client'

import { useEffect, useRef, useState } from 'react'

import type { ControlProps } from './controls.tsx'

/**
 * `bbox[][]` — edit regions, drawn on the images they apply to.
 *
 * Kie wants one list of boxes per input image, in the same order, each box
 * `[x1, y1, x2, y2]` in that image's own pixels. Typing four integers per box
 * means reading coordinates off a picture you cannot see, so this draws them
 * instead: drag a rectangle on the image, and the pixels come from the drag and
 * the image's natural size.
 *
 * The surfaces ARE the image list, which makes the outer array correct by
 * construction — it cannot drift out of step with `input_urls`, and that
 * mismatch is exactly what the doc warns about.
 *
 * An image that will not load still has to be usable: a URL can be remote,
 * expired, or blocked. That case falls back to four number inputs for the image
 * in question, so the control degrades instead of disappearing.
 */

/** A box in source-image pixels. */
type Box = [number, number, number, number]

/** Fractions of the displayed surface, 0–1, while a drag is in flight. */
interface Draft {
  image: number
  x1: number
  y1: number
  x2: number
  y2: number
}

/** Ignores a click that was not really a drag. */
const MIN_DRAG_FRACTION = 0.02

export function BboxListControl({
  param,
  value,
  onChange,
  disabled,
  sourceUrls,
}: ControlProps) {
  const images = sourceUrls ?? []
  const perImage = param.maxItems ?? 2
  const stored = Array.isArray(value) ? (value as Box[][]) : []

  /**
   * Always exactly as long as the image list. Kie requires the two to match, so
   * the value is shaped to the images rather than trusted from storage — an
   * image removed after a box was drawn would otherwise leave a stale entry.
   */
  const boxes: Box[][] = images.map((_, index) =>
    Array.isArray(stored[index]) ? stored[index]! : [],
  )

  const [draft, setDraft] = useState<Draft | null>(null)
  const [natural, setNatural] = useState<Record<number, { w: number; h: number }>>({})
  const [broken, setBroken] = useState<Record<number, boolean>>({})
  const surfaces = useRef<Record<number, HTMLDivElement | null>>({})

  const drawn = boxes.some((list) => list.length > 0)

  /**
   * Re-aligns the stored value when the image list changes length.
   *
   * Only when it actually differs, and only when something is drawn — an unused
   * `bbox_list` should stay absent from the payload rather than appear as
   * `[[], []]`.
   */
  useEffect(() => {
    if (!drawn) {
      if (stored.length > 0) onChange(undefined)
      return
    }
    if (stored.length !== images.length) onChange(boxes)
  })

  const commit = (next: Box[][]) => {
    onChange(next.some((list) => list.length > 0) ? next : undefined)
  }

  const addBox = (image: number, box: Box) => {
    if (boxes[image]!.length >= perImage) return
    commit(boxes.map((list, i) => (i === image ? [...list, box] : list)))
  }

  const removeBox = (image: number, index: number) => {
    commit(boxes.map((list, i) => (i === image ? list.filter((_, b) => b !== index) : list)))
  }

  const setAxis = (image: number, index: number, axis: number, n: number) => {
    commit(
      boxes.map((list, i) =>
        i === image
          ? list.map((box, b) => {
              if (b !== index) return box
              const next = [...box] as Box
              next[axis] = n
              return next
            })
          : list,
      ),
    )
  }

  // ------------------------------------------------------------- drawing

  const pointFrom = (image: number, event: React.PointerEvent) => {
    const rect = surfaces.current[image]!.getBoundingClientRect()
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    }
  }

  const onPointerDown = (image: number) => (event: React.PointerEvent) => {
    if (disabled || broken[image] || boxes[image]!.length >= perImage) return
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const { x, y } = pointFrom(image, event)
    setDraft({ image, x1: x, y1: y, x2: x, y2: y })
  }

  const onPointerMove = (image: number) => (event: React.PointerEvent) => {
    if (!draft || draft.image !== image) return
    const { x, y } = pointFrom(image, event)
    setDraft({ ...draft, x2: x, y2: y })
  }

  const onPointerUp = (image: number) => (event: React.PointerEvent) => {
    if (!draft || draft.image !== image) return
    event.currentTarget.releasePointerCapture(event.pointerId)

    const size = natural[image]
    const width = Math.abs(draft.x2 - draft.x1)
    const height = Math.abs(draft.y2 - draft.y1)
    setDraft(null)

    // A stray click is not a region.
    if (!size || width < MIN_DRAG_FRACTION || height < MIN_DRAG_FRACTION) return

    addBox(image, [
      Math.round(Math.min(draft.x1, draft.x2) * size.w),
      Math.round(Math.min(draft.y1, draft.y2) * size.h),
      Math.round(Math.max(draft.x1, draft.x2) * size.w),
      Math.round(Math.max(draft.y1, draft.y2) * size.h),
    ])
  }

  // -------------------------------------------------------------- render

  if (images.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-(--color-border) px-3 py-4 text-center text-xs text-(--color-ink-muted)">
        Regions are drawn on the images you are editing. Add an input image above
        and it will appear here to draw on.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {images.map((url, image) => {
        const list = boxes[image]!
        const size = natural[image]
        const full = list.length >= perImage

        return (
          <div
            key={`${url}-${image}`}
            className="overflow-hidden rounded-md border border-(--color-border) bg-(--color-surface)"
          >
            <div className="flex items-center gap-2 border-b border-(--color-border) px-3 py-1.5">
              <span className="font-mono text-[11px] text-(--color-ink-muted)">
                image {image + 1}
              </span>
              {size && (
                <span className="font-mono text-[11px] text-(--color-ink-muted)">
                  {size.w}×{size.h}
                </span>
              )}
              <span className="ml-auto font-mono text-[11px] text-(--color-ink-muted)">
                {list.length} / {perImage}
              </span>
            </div>

            {broken[image] ? (
              <BrokenImage
                url={url}
                list={list}
                perImage={perImage}
                disabled={disabled}
                onAdd={() => addBox(image, [0, 0, 100, 100])}
                onRemove={(index) => removeBox(image, index)}
                onSet={(index, axis, n) => setAxis(image, index, axis, n)}
              />
            ) : (
              /*
               * The surface shrink-wraps the image rather than filling the row.
               * A letterboxed image would put painted pixels somewhere inside a
               * wider box, and every coordinate taken from the container's rect
               * would be off by the margin — silently, and only for images whose
               * aspect ratio differs from the panel's.
               */
              <div className="flex justify-center bg-black/20 p-2">
                <div
                  ref={(node) => {
                    surfaces.current[image] = node
                  }}
                  onPointerDown={onPointerDown(image)}
                  onPointerMove={onPointerMove(image)}
                  onPointerUp={onPointerUp(image)}
                  className={`relative w-fit select-none ${
                    disabled || full ? 'cursor-default' : 'cursor-crosshair'
                  }`}
                >
                <img
                  src={url}
                  alt={`Input image ${image + 1}`}
                  draggable={false}
                  className="block max-h-96 max-w-full"
                  onLoad={(event) => {
                    const el = event.currentTarget
                    setNatural((prev) => ({
                      ...prev,
                      [image]: { w: el.naturalWidth, h: el.naturalHeight },
                    }))
                  }}
                  onError={() => setBroken((prev) => ({ ...prev, [image]: true }))}
                />

                {size &&
                  list.map((box, index) => (
                    <div
                      key={index}
                      className="absolute border-2 border-(--color-accent) bg-(--color-accent)/15"
                      style={{
                        left: `${(box[0] / size.w) * 100}%`,
                        top: `${(box[1] / size.h) * 100}%`,
                        width: `${((box[2] - box[0]) / size.w) * 100}%`,
                        height: `${((box[3] - box[1]) / size.h) * 100}%`,
                      }}
                    >
                      <button
                        type="button"
                        disabled={disabled}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={() => removeBox(image, index)}
                        className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-(--color-accent) text-xs leading-none font-medium text-black"
                        aria-label={`Remove region ${index + 1} on image ${image + 1}`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}

                {draft?.image === image && (
                  <div
                    className="pointer-events-none absolute border-2 border-dashed border-(--color-accent)"
                    style={{
                      left: `${Math.min(draft.x1, draft.x2) * 100}%`,
                      top: `${Math.min(draft.y1, draft.y2) * 100}%`,
                      width: `${Math.abs(draft.x2 - draft.x1) * 100}%`,
                      height: `${Math.abs(draft.y2 - draft.y1) * 100}%`,
                    }}
                  />
                )}
                </div>
              </div>
            )}

            <div className="border-t border-(--color-border) px-3 py-1.5">
              {list.length === 0 ? (
                <p className="text-[11px] text-(--color-ink-muted)">
                  {broken[image]
                    ? 'Image could not be displayed — enter coordinates instead.'
                    : `Drag on the image to mark a region to edit. Up to ${perImage}.`}
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {list.map((box, index) => (
                    <li key={index} className="font-mono text-[11px] text-(--color-ink-muted)">
                      [{box.join(', ')}]
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * The degraded path: an image the browser could not fetch.
 *
 * A remote URL can be blocked, expired, or simply wrong, and losing the whole
 * control to that would be worse than the numbers it replaces.
 */
function BrokenImage({
  url,
  list,
  perImage,
  disabled,
  onAdd,
  onRemove,
  onSet,
}: {
  url: string
  list: Box[]
  perImage: number
  disabled?: boolean
  onAdd: () => void
  onRemove: (index: number) => void
  onSet: (index: number, axis: number, n: number) => void
}) {
  return (
    <div className="space-y-2 px-3 py-3">
      <p className="truncate font-mono text-[11px] text-(--color-ink-muted)" title={url}>
        could not load {url}
      </p>
      {list.map((box, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          {(['x1', 'y1', 'x2', 'y2'] as const).map((axis, axisIndex) => (
            <label key={axis} className="flex items-center gap-1">
              <span className="font-mono text-xs text-(--color-ink-muted)">{axis}</span>
              <input
                type="number"
                value={box[axisIndex]}
                disabled={disabled}
                onChange={(event) =>
                  onSet(index, axisIndex, Math.round(Number(event.target.value)))
                }
                className="w-20 rounded-md border border-(--color-border) bg-(--color-surface) px-2 py-1 font-mono text-sm outline-none transition focus:border-(--color-accent) disabled:opacity-40"
              />
            </label>
          ))}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRemove(index)}
            className="rounded-md border border-(--color-border) px-2 py-1 text-sm text-(--color-ink-muted) transition hover:border-red-400 hover:text-red-400 disabled:opacity-40"
            aria-label="Remove region"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={disabled || list.length >= perImage}
        onClick={onAdd}
        className="rounded-md border border-dashed border-(--color-border) px-3 py-1.5 text-xs text-(--color-ink-muted) transition hover:border-(--color-ink-muted) disabled:cursor-not-allowed disabled:opacity-40"
      >
        + Region
      </button>
    </div>
  )
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}
