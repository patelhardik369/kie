import type { ModelDefinition, ParamDef } from '../kie/registry/types.ts'
import { validateInput } from '../kie/validate.ts'

/**
 * Applying a saved preset to a model.
 *
 * Pure module — no env, no DB — so drift handling is unit-testable.
 *
 * THE REQUIREMENT THIS EXISTS FOR: a preset saved before a model's registry
 * entry changed must still apply, with removed fields **dropped and reported**
 * rather than erroring (docs/PRD.md F6). Kie renames parameters and narrows
 * enums between model revisions, so a preset store that assumed the registry
 * never moves would rot silently — and the failure would surface as a 422 on
 * submit, long after the preset was applied.
 *
 * Validity is judged by the real validator rather than a second copy of its
 * rules, so a preset can never be considered valid by a standard the submit
 * path disagrees with.
 */

export type DropReason = 'unknown_key' | 'invalid_value'

export interface DroppedField {
  key: string
  value: unknown
  reason: DropReason
  /** Human-readable, for the "what was dropped" report. */
  message: string
}

export interface PresetApplication {
  /** The values that still apply, ready to seed the form. */
  values: Record<string, unknown>
  /** What could not be carried over, and why. */
  dropped: DroppedField[]
  /** True when the preset applied completely. */
  clean: boolean
}

/**
 * Filters a stored parameter set down to what this model still accepts.
 *
 * Never throws and never returns a partial failure: whatever survives is a
 * usable starting point, and everything that did not is listed. Applying a
 * preset is a starting point, not a submission — every field stays editable
 * afterwards, and missing ones fall back to their documented defaults.
 */
export function applyPreset(
  model: ModelDefinition,
  params: Record<string, unknown>,
): PresetApplication {
  const values: Record<string, unknown> = {}
  const dropped: DroppedField[] = []

  for (const [key, value] of Object.entries(params)) {
    const param = model.params.find((p) => p.key === key)

    if (!param) {
      dropped.push({
        key,
        value,
        reason: 'unknown_key',
        message: `${model.slug} no longer has a "${key}" parameter.`,
      })
      continue
    }

    const problem = fieldProblem(model, param, value)
    if (problem) {
      dropped.push({
        key,
        value,
        reason: 'invalid_value',
        message: problem,
      })
      continue
    }

    values[key] = value
  }

  return { values, dropped, clean: dropped.length === 0 }
}

/**
 * Why one value is no longer acceptable, or undefined if it is fine.
 *
 * Runs the real validator over a single-key payload. Issues about OTHER keys —
 * the required fields a one-key payload is obviously missing — are filtered out
 * by key, and whole-payload constraint issues carry no key at all, so neither
 * can make a valid value look invalid.
 */
function fieldProblem(
  model: ModelDefinition,
  param: ParamDef,
  value: unknown,
): string | undefined {
  const result = validateInput(model, { [param.key]: value })

  const issue = result.issues.find(
    (i) =>
      i.key !== undefined &&
      // Nested keys arrive as `elements[0].name`; match on the root.
      i.key.split(/[[.]/)[0] === param.key &&
      i.code !== 'required',
  )

  return issue?.message
}

/**
 * A one-line summary of a preset, for the list view.
 *
 * Shows the keys, not the values, past a handful — a preset with twenty
 * parameters is identified by its name, and the full set is one click away.
 */
export function summarizePreset(
  params: Record<string, unknown>,
  limit = 4,
): string {
  const entries = Object.entries(params)
  if (entries.length === 0) return 'No parameters'

  const shown = entries
    .slice(0, limit)
    .map(([key, value]) => `${key}=${compact(value)}`)
    .join(' · ')

  const rest = entries.length - limit
  return rest > 0 ? `${shown} · +${rest} more` : shown
}

function compact(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > 24 ? `"${value.slice(0, 21)}…"` : JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.length}]`
  if (value && typeof value === 'object') return '{…}'
  return JSON.stringify(value) ?? String(value)
}

/**
 * The values worth saving as a preset.
 *
 * Asset URLs are excluded: a Kie upload dies after about 24 hours, so a preset
 * carrying one would apply cleanly and then fail at submit with an expired URL.
 * The parameters that shape a look — resolution, cfg, style, negative prompt —
 * are what a preset is for.
 */
export function presetableValues(
  model: ModelDefinition,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(values)) {
    const param = model.params.find((p) => p.key === key)
    if (!param) continue
    if (param.type === 'url' || param.type === 'url[]') continue
    if (value === undefined || value === null) continue
    out[key] = value
  }

  return out
}
