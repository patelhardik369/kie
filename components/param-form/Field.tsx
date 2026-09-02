'use client'

import type { ParamDef } from '@/lib/kie/registry/types.ts'
import {
  BboxListControl,
  BooleanControl,
  ColorListControl,
  EnumControl,
  NumberControl,
  SeedControl,
  StringControl,
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
  /** Explanation shown when a constraint disabled this control. */
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
    case 'color[]':
      return <ColorListControl {...props} />
    case 'bbox[]':
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
        <label className="text-sm font-medium">
          {param.label}
          {isRequired && <span className="ml-1 text-(--color-accent)">*</span>}
        </label>
        <code className="font-mono text-xs text-(--color-ink-muted)">{param.key}</code>
      </div>

      <Control {...props} />

      <p className="mt-1.5 text-xs leading-relaxed text-(--color-ink-muted)">
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

      {disabled && reason && (
        <p className="mt-1.5 rounded border-l-2 border-(--color-accent) bg-(--color-accent)/10 px-2 py-1 text-xs text-(--color-ink-muted)">
          {reason}
        </p>
      )}

      {errors?.map((error) => (
        <p key={error} className="mt-1.5 text-xs text-red-400">
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
          className="rounded-lg border border-(--color-border) bg-(--color-surface) p-3"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="font-mono text-xs text-(--color-ink-muted)">
              {param.label} {index + 1}
            </span>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={disabled || index === 0}
                onClick={() => move(index, index - 1)}
                className="rounded border border-(--color-border) px-1.5 text-xs text-(--color-ink-muted) disabled:opacity-30"
                aria-label="Move up"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={disabled || index === rows.length - 1}
                onClick={() => move(index, index + 1)}
                className="rounded border border-(--color-border) px-1.5 text-xs text-(--color-ink-muted) disabled:opacity-30"
                aria-label="Move down"
              >
                ↓
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
                className="rounded border border-(--color-border) px-1.5 text-xs text-(--color-ink-muted) transition hover:border-red-400 hover:text-red-400 disabled:opacity-30"
                aria-label="Remove"
              >
                ✕
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
          className="rounded-md border border-dashed border-(--color-border) px-3 py-1.5 text-xs text-(--color-ink-muted) transition hover:border-(--color-ink-muted) disabled:cursor-not-allowed disabled:opacity-40"
        >
          + Add {param.label.toLowerCase()}
        </button>
        {ceiling !== undefined && (
          <span className="font-mono text-xs text-(--color-ink-muted)">
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
