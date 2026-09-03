'use client'

import { ArrowDown, ArrowUp, Close, Plus } from '@/components/shell/icons.tsx'
import type { ParamDef } from '@/lib/kie/registry/types.ts'
import { BboxListControl } from './RegionPicker.tsx'
import {
  BooleanControl,
  ColorListControl,
  EnumControl,
  NumberControl,
  SeedControl,
  StringControl,
  StringListControl,
  TextControl,
  UrlControl,
  UrlListControl,
  type ControlProps,
} from './controls.tsx'

/**
 * Renders one parameter.
 *
 * The dispatch below switches on `param.type` and NOTHING else — no model slug,
 * no family, no special cases. That is the property Phase 3 exists to prove: a
 * model that needs a branch here means ParamType is missing a member.
 */

export interface FieldProps extends ControlProps {
  /** Why a constraint is currently disabling or narrowing this control. */
  reason?: string
  /** Required in the current state, which can differ from param.required. */
  required?: boolean
  /** Validation messages for this field. */
  errors?: string[]
  /**
   * The studio preference this field opened on, when it differs from the
   * documented default. Shown alongside it rather than replacing it — what Kie
   * does with the field omitted stays visible either way.
   */
  studioDefault?: string | number
}

function Control(props: ControlProps) {
  switch (props.param.type) {
    case 'text':
      return <TextControl {...props} />
    case 'string':
      return <StringControl {...props} />
    case 'enum':
      return <EnumControl {...props} />
    case 'number':
      return <NumberControl {...props} />
    case 'boolean':
      return <BooleanControl {...props} />
    case 'seed':
      return <SeedControl {...props} />
    case 'url':
      return <UrlControl {...props} />
    case 'url[]':
      return <UrlListControl {...props} />
    case 'string[]':
      return <StringListControl {...props} />
    case 'color[]':
      return <ColorListControl {...props} />
    case 'bbox[][]':
      return <BboxListControl {...props} />
    case 'object[]':
      return <ObjectListControl {...props} />
  }
}

export function Field({ reason, required, errors, studioDefault, ...rest }: FieldProps) {
  const { param, disabled } = rest
  const isRequired = required ?? param.required
  // The control needs the derived requiredness too — it drives placeholders and
  // whether an enum choice can be cleared.
  const props: ControlProps = { ...rest, required: isRequired }

  return (
    <div className={disabled ? 'opacity-60' : undefined}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label className="text-[13px] font-medium text-(--color-ink)">
          {param.label}
          {isRequired && (
            <span className="ml-1 text-(--color-accent)" title="Required">
              *
            </span>
          )}
          {/* Superseded fields stay reachable — the promise is every parameter —
              but they are labelled, so nobody sets one expecting it to win over
              its replacement. */}
          {param.deprecated && (
            <span
              className="ml-1.5 rounded border border-(--color-border) px-1 py-px align-middle text-[10px] font-normal tracking-wide text-(--color-ink-faint) uppercase"
              title="The model's docs mark this parameter as superseded."
            >
              deprecated
            </span>
          )}
        </label>
        <code className="mono shrink-0 text-(--color-ink-faint)">{param.key}</code>
      </div>

      <Control {...props} />

      <p className="mt-1.5 text-[11px] leading-relaxed text-(--color-ink-faint)">
        {param.describe}
        {param.default !== undefined && (
          <span className="ml-1 opacity-70">
            Default: <code className="font-mono">{JSON.stringify(param.default)}</code>.
          </span>
        )}
        {studioDefault !== undefined && (
          <span className="ml-1 opacity-70">
            Opens on <code className="font-mono">{JSON.stringify(studioDefault)}</code>.
          </span>
        )}
      </p>

      {/* Not gated on `disabled`: a constraint that narrows an enum leaves the
          control usable but silently removes choices, which is exactly when the
          reason is most worth showing. */}
      {reason && <p className="note mt-2 py-1 text-[11px]">{reason}</p>}

      {errors?.map((error) => (
        <p key={error} className="mt-1.5 text-[11px] text-(--color-bad-ink)">
          {error}
        </p>
      ))}
    </div>
  )
}

/**
 * Repeating group — multi_prompt, kling_elements, elements.
 *
 * Recurses through `Field`, so a nested group gets the same controls, counters
 * and validation affordances as a top-level one.
 */
function ObjectListControl({ param, value, onChange, disabled }: ControlProps) {
  const rows = Array.isArray(value) ? (value as Record<string, unknown>[]) : []
  const fields = param.fields ?? []
  const ceiling = param.maxItems

  const setRows = (next: Record<string, unknown>[]) => onChange(next)

  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length) return
    const next = [...rows]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved!)
    setRows(next)
  }

  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div
          key={index}
          className="rounded-lg border border-(--color-border) bg-(--color-surface) p-3 transition-colors duration-(--dur-fast) hover:border-(--color-border-strong)"
        >
          <div className="mb-2.5 flex items-center justify-between">
            <span className="mono text-(--color-ink-muted)">
              {param.label} {index + 1}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={disabled || index === 0}
                onClick={() => move(index, index - 1)}
                className="btn btn-ghost btn-sm btn-icon"
                aria-label="Move up"
              >
                <ArrowUp size={12} />
              </button>
              <button
                type="button"
                disabled={disabled || index === rows.length - 1}
                onClick={() => move(index, index + 1)}
                className="btn btn-ghost btn-sm btn-icon"
                aria-label="Move down"
              >
                <ArrowDown size={12} />
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
                className="btn btn-ghost btn-danger btn-sm btn-icon"
                aria-label="Remove"
              >
                <Close size={12} />
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {fields.map((field) => (
              <Field
                key={field.key}
                param={field}
                value={row[field.key]}
                disabled={disabled}
                onChange={(fieldValue) => {
                  const next = [...rows]
                  next[index] = { ...row, [field.key]: fieldValue }
                  setRows(next)
                }}
              />
            ))}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={disabled || (ceiling !== undefined && rows.length >= ceiling)}
          onClick={() => setRows([...rows, blankRow(fields)])}
          className="btn btn-sm border-dashed border-(--color-border) text-(--color-ink-muted) hover:border-(--color-accent-line) hover:text-(--color-accent)"
        >
          <Plus size={12} />
          Add {param.label.toLowerCase()}
        </button>
        {ceiling !== undefined && (
          <span className="mono text-(--color-ink-faint)">
            {rows.length} / {ceiling}
          </span>
        )}
      </div>
    </div>
  )
}

/** A new row seeded with whatever defaults the fields document. */
function blankRow(fields: ParamDef[]): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.default !== undefined) row[field.key] = field.default
  }
  return row
}
