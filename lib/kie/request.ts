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

  pruneBlankUrls(model, payload)

  for (const param of model.params) {
    if (!param.required) continue
    if (isPresent(payload[param.key]) || param.key in payload) continue
    if (param.default === undefined) continue
    payload[param.key] = param.default
  }

  return payload
}

/**
 * Drops blank rows from `url[]` lists, re-indexing whatever is drawn on them.
 *
 * The list controls append an empty row when you press "+ Add", and an empty
 * row is a placeholder, not a URL — sending `""` asks Kie to fetch nothing, and
 * on the way there it is what makes an `<img src="">` in the region picker.
 *
 * Pruning has to take the matching entry out of every `drawsOn` sibling in the
 * same step. Those lists are read POSITIONALLY — `bbox_list[2]` means "the
 * regions for `input_urls[2]`" — so shortening one without the other does not
 * fail loudly, it applies the regions to the wrong image.
 */
function pruneBlankUrls(model: ModelDefinition, payload: Record<string, unknown>): void {
  for (const param of model.params) {
    if (param.type !== 'url[]') continue
    const list = payload[param.key]
    if (!Array.isArray(list)) continue

    const keep: number[] = []
    list.forEach((entry, index) => {
      if (typeof entry === 'string' && entry.trim().length > 0) keep.push(index)
    })
    if (keep.length === list.length) continue

    if (keep.length > 0) payload[param.key] = keep.map((index) => list[index])
    else delete payload[param.key]

    for (const sibling of model.params) {
      if (sibling.drawsOn !== param.key) continue
      const drawn = payload[sibling.key]
      // Only realigned when it was aligned to begin with. A list of some other
      // length is already wrong, and the validator's job is to say so.
      if (!Array.isArray(drawn) || drawn.length !== list.length) continue

      const aligned = keep.map((index) => drawn[index])
      // All that survived is empty slots — the same as never having drawn.
      const used = aligned.some((entry) => !Array.isArray(entry) || entry.length > 0)
      if (used) payload[sibling.key] = aligned
      else delete payload[sibling.key]
    }
  }
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
