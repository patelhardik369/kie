import type { ModelDefinition, ParamDef } from '../kie/registry/types.ts'

/**
 * Which fields can be marked up, decided entirely from registry data.
 *
 * This module is what keeps the feature honest against rule 7 in
 * .claude/CLAUDE.md: no model is named anywhere, no family is special-cased, and
 * a model added tomorrow gets the editor — or correctly does not — without a
 * line changing here. Two facts decide it, and both are already declared on
 * every `ModelDefinition`.
 */

/**
 * Whether marks on an image in this field could mean anything.
 *
 * Two conditions, and the second is the interesting one:
 *
 *   1. The field takes an image. `video`, `audio` and `file` cannot be drawn on.
 *   2. The model has somewhere to explain the marks.
 *
 * A mark with nothing to reference it is just vandalism on the input. An
 * upscaler asked to enlarge a photo with a red circle on it enlarges the red
 * circle — there is no prompt in which to say "the circle is an instruction".
 * That is why `topaz/image-upscale`, `recraft/crisp-upscale`,
 * `recraft/remove-background` and the two Wan animate endpoints fall out of this
 * on their own: they take images and have no prompt. Nothing lists them.
 */
export function canMarkUp(model: ModelDefinition, param: ParamDef): boolean {
  if (param.type !== 'url' && param.type !== 'url[]') return false
  if (!(param.accept ?? []).includes('image')) return false
  return promptKeyOf(model) !== null
}

/**
 * The field the legend should be written into.
 *
 * The first `text` parameter whose key names a prompt, skipping negatives — a
 * legend appended to `negative_prompt` would instruct the model to avoid
 * precisely the edit that was asked for, which is the worst possible way for
 * this to be subtly wrong.
 *
 * Matched on the key rather than on position because the registry transcribes
 * API field names verbatim and their order follows the doc page, not a
 * convention this could rely on.
 */
export function promptKeyOf(model: ModelDefinition): string | null {
  const candidates = model.params.filter(
    (param) => param.type === 'text' && !isNegative(param.key),
  )
  const named = candidates.find((param) => /prompt/i.test(param.key))
  return named?.key ?? null
}

function isNegative(key: string): boolean {
  return /negative|avoid|exclude/i.test(key)
}

/** Whether any field on this model can be marked up at all. */
export function modelSupportsMarkup(model: ModelDefinition): boolean {
  return model.params.some((param) => canMarkUp(model, param))
}
