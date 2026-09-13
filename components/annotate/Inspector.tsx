'use client'

import { useEffect, useRef } from 'react'

import { Close, Repeat } from '@/components/shell/icons.tsx'
import {
  MARKER_COLORS,
  circledNumber,
  hexOf,
  type AnnotationDoc,
  type MarkerColor,
  type Shape,
} from '@/lib/annotate/doc.ts'

/**
 * The right-hand column: what each mark means, and the prompt text that says so.
 *
 * This panel is the half of the feature that makes the other half work. A red
 * circle on its own tells a model that something is different about that area;
 * it does not say what to do about it. The note attached to the circle becomes a
 * legend line, the legend goes into the prompt, and only then does the mark
 * carry an instruction.
 *
 * The legend is shown as editable text rather than generated at submit time on
 * purpose. `input_json` is stored verbatim and has to be exactly reproducible,
 * so nothing may quietly append to a prompt on the way out — what the user reads
 * here is what gets written into the prompt field they can see.
 */

export function Inspector({
  doc,
  selectedId,
  legend,
  legendEdited,
  canPair,
  paired,
  onSelect,
  onUpdate,
  onDelete,
  onLegendChange,
  onLegendReset,
  onPairedChange,
}: {
  doc: AnnotationDoc
  selectedId: string | null
  legend: string
  /** True once the user has typed over the generated text. */
  legendEdited: boolean
  /** Whether a clean copy of the image can be sent alongside the marked one. */
  canPair: boolean
  paired: boolean
  onSelect: (id: string | null) => void
  onUpdate: (shape: Shape) => void
  onDelete: (id: string) => void
  onLegendChange: (text: string) => void
  onLegendReset: () => void
  onPairedChange: (paired: boolean) => void
}) {
  const selected = doc.shapes.find((shape) => shape.id === selectedId) ?? null

  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-t border-(--color-border) p-3 md:w-80 md:border-t-0 md:border-l">
      <section>
        <h3 className="mb-1.5 text-[13px] font-medium">Marks</h3>
        {doc.shapes.length === 0 ? (
          <p className="text-[11px] leading-relaxed text-(--color-ink-faint)">
            Nothing marked yet. Circle, arrow or shade the part of the picture you want
            changed, then say what should happen to it — the model reads both.
          </p>
        ) : (
          <ul className="space-y-1">
            {doc.shapes.map((shape) => (
              <li key={shape.id}>
                <button
                  type="button"
                  onClick={() => onSelect(shape.id)}
                  className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors duration-(--dur-fast) ${
                    shape.id === selectedId
                      ? 'border-(--color-accent-line) bg-(--color-accent-softer)'
                      : 'border-transparent hover:bg-(--color-surface-hover)'
                  }`}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border border-(--color-border)"
                    style={{ backgroundColor: hexOf(shape.color) }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px]">{describe(shape)}</span>
                    {shape.note && (
                      <span className="block truncate text-[10px] text-(--color-ink-faint)">
                        {shape.note}
                      </span>
                    )}
                  </span>
                  {/*
                    A mark with no note contributes nothing to the legend. Said
                    here rather than left to be discovered when the output comes
                    back edited in the wrong way.
                  */}
                  {!shape.note && shape.kind !== 'text' && (
                    <span className="chip chip-warn shrink-0" title="This mark has no instruction attached, so the legend will not mention it.">
                      no note
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selected && <SelectedShape shape={selected} onUpdate={onUpdate} onDelete={onDelete} />}

      <section className="mt-auto">
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-medium">Prompt legend</h3>
          {legendEdited && (
            <button
              type="button"
              onClick={onLegendReset}
              className="btn btn-quiet btn-sm text-[11px]"
              title="Rebuild this from the marks, discarding your edits"
            >
              <Repeat size={11} />
              Rebuild
            </button>
          )}
        </div>

        {canPair && (
          <label
            className="mb-2 flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed text-(--color-ink-muted)"
            title="Sends the unmarked photo as a second image, so the model has clean pixels for everything your marks cover."
          >
            <input
              type="checkbox"
              checked={paired}
              onChange={(event) => onPairedChange(event.target.checked)}
              className="check-private mt-0.5"
            />
            <span>
              Also send the clean original
              <span className="block text-(--color-ink-faint)">
                Uses a second image slot. The best defence against the model painting your
                marks into the result.
              </span>
            </span>
          </label>
        )}

        <textarea
          value={legend}
          onChange={(event) => onLegendChange(event.target.value)}
          placeholder="Add a note to a mark and this writes itself."
          className="input min-h-32 resize-y font-sans text-[11px] leading-relaxed"
        />
        <p className="mt-1 text-[10px] leading-relaxed text-(--color-ink-faint)">
          Added to the end of the prompt field when you save, where you can still edit it.
          Nothing is appended at submit time.
        </p>
      </section>
    </aside>
  )
}

function SelectedShape({
  shape,
  onUpdate,
  onDelete,
}: {
  shape: Shape
  onUpdate: (shape: Shape) => void
  onDelete: (id: string) => void
}) {
  const textRef = useRef<HTMLInputElement>(null)

  /*
   * Focus is taken for a text label and for NOTHING else.
   *
   * A label lands on the canvas reading "Label" and is useless until it is typed
   * over, so jumping into that input is what the user was already going to do.
   * Every other mark is finished the moment it is drawn — and grabbing focus for
   * its note would put the caret in a textarea while the single-letter tool
   * shortcuts are still the obvious next keystroke. Dropping three numbered pins
   * in a row would then type "nnn" into the first one's note.
   */
  useEffect(() => {
    if (shape.kind !== 'text') return
    textRef.current?.focus()
    textRef.current?.select()
  }, [shape.id, shape.kind])

  return (
    <section className="rounded-lg border border-(--color-border) bg-(--color-surface) p-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[12px] font-medium">{describe(shape)}</span>
        <button
          type="button"
          onClick={() => onDelete(shape.id)}
          className="btn btn-ghost btn-danger btn-sm btn-icon"
          aria-label="Delete this mark"
          title="Delete this mark (Del)"
        >
          <Close size={12} />
        </button>
      </div>

      {shape.kind === 'text' && (
        <label className="mb-2 block">
          <span className="mb-1 block text-[11px] text-(--color-ink-muted)">Label text</span>
          <input
            ref={textRef}
            value={shape.text}
            onChange={(event) => onUpdate({ ...shape, text: event.target.value })}
            className="input py-1 text-xs"
          />
        </label>
      )}

      <label className="block">
        <span className="mb-1 block text-[11px] text-(--color-ink-muted)">
          What should happen here?
        </span>
        <textarea
          value={shape.note ?? ''}
          onChange={(event) => onUpdate({ ...shape, note: event.target.value })}
          placeholder="replace this sign with a wooden one"
          className="input min-h-16 resize-y font-sans text-[11px] leading-relaxed"
        />
      </label>

      <div className="mt-2 flex items-center gap-1" role="group" aria-label="Recolour this mark">
        {MARKER_COLORS.map((swatch) => (
          <button
            key={swatch.name}
            type="button"
            onClick={() => onUpdate({ ...shape, color: swatch.name as MarkerColor })}
            aria-pressed={shape.color === swatch.name}
            aria-label={swatch.name}
            title={swatch.name}
            className={`h-5 w-5 rounded-full border-2 ${
              shape.color === swatch.name ? 'border-(--color-ink)' : 'border-(--color-border)'
            }`}
            style={{ backgroundColor: swatch.hex }}
          />
        ))}
      </div>
    </section>
  )
}

/** The same words the legend uses, so the list and the prompt agree. */
function describe(shape: Shape): string {
  switch (shape.kind) {
    case 'stroke':
      return shape.opacity < 1 ? `${shape.color} shaded area` : `${shape.color} brush mark`
    case 'arrow':
      return `${shape.color} arrow`
    case 'line':
      return `${shape.color} line`
    case 'rect':
      return `${shape.color} box`
    case 'ellipse':
      return `${shape.color} circle`
    case 'text':
      return `"${shape.text}" label`
    case 'pin':
      return `${circledNumber(shape.index)} marker`
  }
}
