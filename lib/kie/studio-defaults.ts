import type { ModelDefinition, ParamDef } from './registry/types.ts'

/**
 * Studio preferences — what a form opens on, layered over the documented default.
 *
 * These are NOT registry data and must never be written into a `ParamDef`.
 * `param.default` is transcribed from `docs.kie.ai` and is the answer to "what
 * does Kie do if I omit this field"; that answer stays visible on every control
 * whether or not a preference overrides it. This module answers a different
 * question — "what should already be selected when the form opens" — and every
 * value it produces is still a documented enum member or inside the documented
 * range, so nothing here can invent a parameter value.
 *
 * Three preferences, and one reason for all of them: a fresh form should cost
 * the least it can while still being the shape you usually want. Kie's own
 * defaults lean the other way — Wan 2.7 Image ships `n: 4` at `2K`, which is
 * eight times the credits of one 1K image for a prompt you are probably still
 * iterating on.
 *
 * Everything remains one click away: the control is fully populated and the
 * documented default is printed underneath it.
 */

export const STUDIO_PREFERENCES = {
  /** One output per submission. Sweeps and batches are explicit, never a default. */
  outputCount: 1,
  /** Images open at 1K. */
  imageResolution: '1K',
  /** Video opens at 720p. */
  videoResolution: '720p',
} as const

/** Keys that mean "how many outputs". */
const COUNT_KEYS = new Set(['n', 'max_images'])

/**
 * Keys that mean "how big".
 *
 * `size` on `seedream/5-pro-layer-decomposition` is deliberately absent: its
 * documented `auto` follows the source image, and pinning that model to 1K would
 * silently downscale the thing being decomposed.
 */
const RESOLUTION_KEYS = new Set(['resolution', 'image_resolution'])

/**
 * The preference for one parameter, or undefined when there is none.
 *
 * Undefined is also the answer whenever the preference cannot be expressed in
 * this model's own vocabulary — an enum without a 720p member, a count whose
 * minimum is above one. The documented default then stands, because a preference
 * is never worth a 422.
 */
export function studioDefault(
  model: ModelDefinition,
  param: ParamDef,
): string | number | undefined {
  if (COUNT_KEYS.has(param.key) && param.type === 'number') {
    const min = param.min ?? 1
    const max = param.max ?? STUDIO_PREFERENCES.outputCount
    const wanted = Math.min(Math.max(STUDIO_PREFERENCES.outputCount, min), max)
    return wanted === param.default ? undefined : wanted
  }

  if (RESOLUTION_KEYS.has(param.key) && param.enum) {
    const wanted =
      model.outputKind === 'image'
        ? STUDIO_PREFERENCES.imageResolution
        : STUDIO_PREFERENCES.videoResolution

    // Case-insensitively, because the families disagree: Wan 3.0 writes `720P`
    // where everything else writes `720p`, and the API takes only its own casing.
    const match = param.enum.find(
      (value) => String(value).toLowerCase() === wanted.toLowerCase(),
    )
    return match === param.default ? undefined : (match as string | undefined)
  }

  return undefined
}

/** Every preference that applies to a model, keyed by parameter. */
export function studioDefaults(model: ModelDefinition): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const param of model.params) {
    const preferred = studioDefault(model, param)
    if (preferred !== undefined) values[param.key] = preferred
  }
  return values
}

/** What a fresh form opens on: documented defaults, then preferences over them. */
export function openingValues(model: ModelDefinition): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const param of model.params) {
    if (param.default !== undefined) values[param.key] = param.default
  }
  return { ...values, ...studioDefaults(model) }
}
