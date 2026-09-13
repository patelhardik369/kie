'use client'

import {
  ArrowMark,
  Circle,
  Cursor,
  Highlighter,
  LineMark,
  Pen,
  Pin,
  Redo,
  Square,
  Trash,
  TypeMark,
  Undo,
} from '@/components/shell/icons.tsx'
import { MARKER_COLORS, type MarkerColor } from '@/lib/annotate/doc.ts'
import type { Tool } from './Surface.tsx'

/**
 * Tools, colours and weight.
 *
 * The colour row is not decoration and not a free-form picker. Every swatch has
 * a NAME, that name goes into the legend, and the legend is what the model
 * reads — so the palette is exactly the seven colours that are unambiguous in
 * words. An eyedropper offering `#8a7f6e` would produce marks nobody can refer
 * to in a sentence.
 */

interface ToolSpec {
  tool: Tool
  label: string
  /** The single key that selects it. Shown in the tooltip, not as a badge. */
  key: string
  icon: (props: { size?: number }) => React.ReactElement
}

export const TOOLS: ToolSpec[] = [
  { tool: 'select', label: 'Select and move', key: 'V', icon: Cursor },
  { tool: 'brush', label: 'Draw freehand', key: 'B', icon: Pen },
  { tool: 'highlighter', label: 'Shade a region', key: 'H', icon: Highlighter },
  { tool: 'arrow', label: 'Point at something', key: 'A', icon: ArrowMark },
  { tool: 'line', label: 'Draw a line', key: 'L', icon: LineMark },
  { tool: 'rect', label: 'Box a region', key: 'R', icon: Square },
  { tool: 'ellipse', label: 'Circle a subject', key: 'O', icon: Circle },
  { tool: 'text', label: 'Place a label', key: 'T', icon: TypeMark },
  { tool: 'pin', label: 'Place a numbered marker', key: 'N', icon: Pin },
]

/** Fractions of the image's long edge. Named so the control is not a raw float. */
export const WIDTHS = [
  { label: 'Fine', value: 0.003 },
  { label: 'Medium', value: 0.006 },
  { label: 'Bold', value: 0.012 },
] as const

export function Toolbar({
  tool,
  color,
  width,
  fill,
  canUndo,
  canRedo,
  shapeCount,
  onTool,
  onColor,
  onWidth,
  onFill,
  onUndo,
  onRedo,
  onClear,
}: {
  tool: Tool
  color: MarkerColor
  width: number
  fill: number
  canUndo: boolean
  canRedo: boolean
  shapeCount: number
  onTool: (tool: Tool) => void
  onColor: (color: MarkerColor) => void
  onWidth: (width: number) => void
  onFill: (fill: number) => void
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
}) {
  const shapesCanFill = tool === 'rect' || tool === 'ellipse'

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-(--color-border) px-3 py-2">
      <div className="flex flex-wrap items-center gap-1">
        {TOOLS.map(({ tool: id, label, key, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onTool(id)}
            aria-pressed={tool === id}
            title={`${label} (${key})`}
            aria-label={label}
            className={`btn btn-sm btn-icon ${
              tool === id
                ? 'border-(--color-accent-line) bg-(--color-accent-softer) text-(--color-accent)'
                : 'btn-ghost'
            }`}
          >
            <Icon size={15} />
          </button>
        ))}
      </div>

      <span className="h-5 w-px bg-(--color-border)" aria-hidden />

      <div className="flex items-center gap-1" role="group" aria-label="Marker colour">
        {MARKER_COLORS.map((swatch) => (
          <button
            key={swatch.name}
            type="button"
            onClick={() => onColor(swatch.name)}
            aria-pressed={color === swatch.name}
            title={`${swatch.name} — the legend will call it "${swatch.name}"`}
            aria-label={swatch.name}
            className={`h-6 w-6 rounded-full border-2 transition-transform duration-(--dur-fast) ${
              color === swatch.name
                ? 'scale-110 border-(--color-ink)'
                : 'border-(--color-border) hover:scale-105'
            }`}
            style={{ backgroundColor: swatch.hex }}
          />
        ))}
      </div>

      <span className="h-5 w-px bg-(--color-border)" aria-hidden />

      <label className="flex items-center gap-1.5">
        <span className="sr-only">Stroke weight</span>
        <select
          value={width}
          onChange={(event) => onWidth(Number(event.target.value))}
          className="input select-field w-auto py-1 text-xs"
          title="Stroke weight, as a share of the image — a mark keeps its weight at any resolution"
        >
          {WIDTHS.map((option) => (
            <option key={option.label} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {/*
        Only for the two shapes that have an interior. A fill checkbox that does
        nothing for six of the nine tools is a checkbox people stop trusting.
      */}
      {shapesCanFill && (
        <label
          className="flex cursor-pointer items-center gap-1.5 text-[11px] text-(--color-ink-muted)"
          title="Tint the inside. A translucent fill still shows what is underneath, which the model needs in order to replace it."
        >
          <input
            type="checkbox"
            checked={fill > 0}
            onChange={(event) => onFill(event.target.checked ? 0.25 : 0)}
            className="check-private"
          />
          Fill
        </label>
      )}

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          className="btn btn-ghost btn-sm btn-icon"
        >
          <Undo size={14} />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
          className="btn btn-ghost btn-sm btn-icon"
        >
          <Redo size={14} />
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={shapeCount === 0}
          title="Remove every mark"
          aria-label="Clear all marks"
          className="btn btn-ghost btn-danger btn-sm btn-icon"
        >
          <Trash size={14} />
        </button>
      </div>
    </div>
  )
}
