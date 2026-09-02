import type { ModelDefinition } from './registry/types.ts'
import { isPresent } from './validate.ts'

/**
 * Builds the exact `input` object to send to Kie.
 *
 * Pure module — no env, no network.
 *
 * WHY THIS EXISTS: a documented default is NOT applied server-side. Seedream
 * marks `aspect_ratio` required and documents a default of `1:1`, but omitting
 * it returns an error reading "This field is required". So every required
 * parameter must be present in the payload, falling back to its documented
 * default when the user did not choose one.
 *
 * The validator stays lenient about this on purpose — from the user's point of
 * view a field with a default IS satisfied. Filling it in is this layer's job,
 * at the boundary, so the two concerns do not get tangled.
 */
export function buildRequestInput(
  model: ModelDefinition,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}

  // Preserve everything the caller supplied, dropping only empty values —
  // an empty array or blank string would trip the API's own required checks.
  for (const [key, value] of Object.entries(input)) {
    if (isPresent(value) || typeof value === 'boolean' || typeof value === 'number') {
      payload[key] = value
    }
  }

  for (const param of model.params) {
    if (!param.required) continue
    if (isPresent(payload[param.key]) || param.key in payload) continue
    if (param.default === undefined) continue
    payload[param.key] = param.default
  }

  return payload
}

/** Every required parameter with no value and no documented default. */
export function missingRequired(
  model: ModelDefinition,
  input: Record<string, unknown>,
): string[] {
  return model.params
    .filter((p) => p.required && p.default === undefined && !isPresent(input[p.key]))
    .map((p) => p.key)
}
