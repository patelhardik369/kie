import type { ModelDefinition, ParamDef } from '../kie/registry/types.ts'

/**
 * The traps: places where two models that look alike disagree.
 *
 * Pure module — reads the registry, computes, returns. No env, no DB.
 *
 * WHY THIS EXISTS: 97 models across seven families share parameter names but not
 * parameter meanings. `duration` is a string on most Kling models and an integer
 * on Kling Omni. Wan 2.7 text-to-video calls its framing parameter `ratio` while
 * everything else calls it `aspect_ratio`. `google/imagen4` types `seed` as a
 * string and `google/imagen4-fast` types it as a number. Each of these costs an
 * hour and a `422` the first time, and the reference tables record them — but
 * only if you already know to look.
 *
 * Almost everything here is **derived from the registry**, not curated, which
 * means it cannot go stale: adding the 98th model surfaces its inconsistencies
 * automatically. The one curated part is `SYNONYM_GROUPS`, and even that only
 * reports keys that genuinely exist in the registry.
 */

export type TrapKind = 'type' | 'enum' | 'naming' | 'note'

export interface Trap {
  kind: TrapKind
  /** The parameter at issue, when there is a single one. */
  key?: string
  title: string
  detail: string
  /** Slugs this trap applies to. */
  models: string[]
}

/**
 * Keys that mean the same thing under different names.
 *
 * Curated, because no amount of string comparison can tell you that `ratio` and
 * `aspect_ratio` are the same idea. Only groups with more than one member
 * actually present in the registry are ever reported.
 */
const SYNONYM_GROUPS: string[][] = [
  /** `image_size` is Nano Banana 1's superseded spelling of `aspect_ratio`. */
  ['aspect_ratio', 'ratio', 'image_size'],
  /*
   * "The image(s) to work from" is spelled six ways across the catalog:
   * `image` (Recraft), `image_url` (Topaz), `image_urls` (Nano Banana 1 and 2
   * Lite), `image_input` (Nano Banana 2 and Pro), `input_urls` (GPT Image, Wan)
   * and `imageUrls` (Veo, the only camelCase field anywhere). Recraft vs Topaz
   * and Nano Banana 2 vs 2 Lite are both one-character mistakes away from a 422.
   */
  ['image', 'image_url', 'image_urls', 'image_input', 'input_urls', 'imageUrls'],
  ['negative_prompt', 'negativePrompt'],
  ['duration', 'duration_seconds'],
]

/**
 * The JSON type a parameter's values take **on the wire**.
 *
 * Deliberately not the ParamType: an enum of strings and a free-text string are
 * both `string` to the API, and reporting them as different would bury the one
 * difference that actually causes a 422 — string versus number.
 */
function wireType(param: ParamDef): string {
  switch (param.type) {
    case 'enum': {
      const types = new Set((param.enum ?? []).map((v) => typeof v))
      if (types.size === 1) return [...types][0]!
      return types.size === 0 ? 'string' : 'mixed'
    }
    case 'number':
    case 'seed':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'text':
    case 'string':
    case 'url':
      return 'string'
    // Both are a flat array of strings on the wire; the difference between them
    // is only whether the value is uploadable, which is a UI concern.
    case 'url[]':
    case 'string[]':
      return 'string[]'
    case 'color[]':
      return '{ hex, ratio }[]'
    case 'bbox[][]':
      return 'number[4][][]'
    case 'object[]':
      return 'object[]'
    default:
      return param.type
  }
}

interface Usage {
  model: ModelDefinition
  param: ParamDef
}

function usagesByKey(models: ModelDefinition[]): Map<string, Usage[]> {
  const byKey = new Map<string, Usage[]>()
  for (const model of models) {
    for (const param of model.params) {
      const list = byKey.get(param.key)
      if (list) list.push({ model, param })
      else byKey.set(param.key, [{ model, param }])
    }
  }
  return byKey
}

/** Groups slugs by the variant they use, as "a, b use X; c uses Y". */
function describeGroups(groups: Map<string, string[]>, noun: string): string {
  return [...groups.entries()]
    .map(([variant, slugs]) => {
      const shown = slugs.length > 3 ? `${slugs.slice(0, 3).join(', ')} +${slugs.length - 3}` : slugs.join(', ')
      return `${noun} ${variant}: ${shown}`
    })
    .join(' — ')
}

/** Same parameter name, different wire type. The classic source of a 422. */
function typeTraps(byKey: Map<string, Usage[]>): Trap[] {
  const traps: Trap[] = []

  for (const [key, usages] of byKey) {
    const byType = new Map<string, string[]>()
    for (const { model, param } of usages) {
      const type = wireType(param)
      const list = byType.get(type)
      if (list) list.push(model.slug)
      else byType.set(type, [model.slug])
    }

    if (byType.size < 2) continue

    traps.push({
      kind: 'type',
      key,
      title: `\`${key}\` is not the same type on every model`,
      detail:
        `Sending the wrong JSON type is rejected as a 422 that names the field ` +
        `but not the reason. ${describeGroups(byType, 'as')}.`,
      models: usages.map((u) => u.model.slug),
    })
  }

  return traps
}

/**
 * Same parameter name, different accepted values.
 *
 * Only reported when neither set contains the other: a model that simply offers
 * fewer resolutions than its sibling is a difference, not a trap. Two sets that
 * genuinely diverge mean a value valid on one model is rejected on the other.
 */
function enumTraps(byKey: Map<string, Usage[]>): Trap[] {
  const traps: Trap[] = []

  for (const [key, usages] of byKey) {
    const enums = usages.filter((u) => u.param.enum && u.param.enum.length > 0)
    if (enums.length < 2) continue

    const signatures = new Map<string, string[]>()
    for (const { model, param } of enums) {
      const signature = [...(param.enum ?? [])].map(String).sort().join(',')
      const list = signatures.get(signature)
      if (list) list.push(model.slug)
      else signatures.set(signature, [model.slug])
    }

    if (signatures.size < 2) continue

    // A strict superset is a capability difference, not a disagreement.
    const sets = [...signatures.keys()].map((s) => new Set(s.split(',')))
    const diverges = sets.some((a) =>
      sets.some((b) => a !== b && ![...a].every((v) => b.has(v)) && ![...b].every((v) => a.has(v))),
    )
    if (!diverges) continue

    traps.push({
      kind: 'enum',
      key,
      title: `\`${key}\` accepts different values on different models`,
      detail:
        `A value that works on one of these is rejected on another. ` +
        describeGroups(signatures, 'accepts') +
        '.',
      models: enums.map((u) => u.model.slug),
    })
  }

  return traps
}

/** The same idea spelled two ways — `ratio` versus `aspect_ratio`. */
function namingTraps(models: ModelDefinition[]): Trap[] {
  const traps: Trap[] = []

  for (const group of SYNONYM_GROUPS) {
    const usedBy = new Map<string, string[]>()

    for (const key of group) {
      const slugs = models.filter((m) => m.params.some((p) => p.key === key)).map((m) => m.slug)
      if (slugs.length > 0) usedBy.set(key, slugs)
    }

    // One spelling in use is not a trap; it is just the name.
    if (usedBy.size < 2) continue

    /*
     * A model can declare more than one spelling ITSELF — google/nano-banana
     * carries both `aspect_ratio` and its superseded `image_size`. That is a
     * different hazard from the cross-model one, and the sentence below would
     * be plainly wrong about it: the receiving model has very much heard of
     * that key, it just has two knobs for one idea and only one of them is
     * current. Called out separately rather than folded in.
     */
    const overlapping = models
      .filter((m) => group.filter((key) => m.params.some((p) => p.key === key)).length > 1)
      .map((m) => m.slug)

    traps.push({
      kind: 'naming',
      title: `\`${[...usedBy.keys()].join('` vs `')}\` — the same idea, two names`,
      detail:
        `Copying a payload between these models silently drops the field, ` +
        `because the receiving model has never heard of that key. ` +
        describeGroups(usedBy, 'uses') +
        '.' +
        (overlapping.length > 0
          ? ` ${listSlugs(overlapping)} declare${overlapping.length === 1 ? 's' : ''} ` +
            `more than one of these spellings, so setting two of them on the same ` +
            `request sets one idea twice — check which the docs mark current.`
          : ''),
      models: [...usedBy.values()].flat(),
    })
  }

  return traps
}

/** `a`, `a and b`, or `a, b and c`, truncating past three. */
function listSlugs(slugs: string[]): string {
  if (slugs.length === 1) return slugs[0]!
  if (slugs.length > 3) return `${slugs.slice(0, 3).join(', ')} and ${slugs.length - 3} more`
  return `${slugs.slice(0, -1).join(', ')} and ${slugs.at(-1)}`
}

/** Everything the registry's own `notes` record, surfaced verbatim. */
function noteTraps(models: ModelDefinition[]): Trap[] {
  return models
    .filter((m) => m.notes?.trim())
    .map((model) => ({
      kind: 'note' as const,
      title: model.label,
      // Verbatim from the reference tables — these are the quirks a human wrote
      // down precisely because they could not be derived.
      detail: model.notes!.trim(),
      models: [model.slug],
    }))
}

/**
 * Every trap across a set of models, most widely applicable first.
 *
 * `models` is deduplicated HERE rather than in each builder, because every
 * builder can produce a repeat and the consequences are not local to one of
 * them. A model legitimately lands in the same trap twice whenever it declares
 * two members of one synonym group — `google/nano-banana` has both
 * `aspect_ratio` and the superseded `image_size` — and a repeated slug renders
 * as a duplicate React key, inflates the "N models" count in the list, and
 * would make `trapsForModel` no less correct but the UI visibly wrong.
 *
 * Doing it once at the boundary means a new builder cannot reintroduce the bug.
 */
export function findTraps(models: ModelDefinition[]): Trap[] {
  const byKey = usagesByKey(models)

  return [
    ...typeTraps(byKey),
    ...enumTraps(byKey),
    ...namingTraps(models),
    ...noteTraps(models),
  ]
    // First occurrence wins, so the order a builder chose is preserved.
    .map((trap) => ({ ...trap, models: [...new Set(trap.models)] }))
    // Sorted after deduping: the count is what ranks a trap, and before the
    // dedupe a model counted twice would push its trap up the list.
    .sort((a, b) => b.models.length - a.models.length)
}

/** The traps that apply to one model. */
export function trapsForModel(slug: string, traps: Trap[]): Trap[] {
  return traps.filter((trap) => trap.models.includes(slug))
}

/**
 * A one-line differentiator for a model, for the browser's list rows.
 *
 * The capability alone does not distinguish nine Kling text-to-video models
 * (docs/UX-SPEC.md), so this leans on what actually varies between siblings:
 * resolution, duration, and the presence of audio.
 */
export function differentiator(model: ModelDefinition): string {
  const bits: string[] = []

  const resolution = model.params.find(
    (p) => p.key === 'resolution' || p.key === 'quality' || p.key === 'size',
  )
  if (resolution?.enum?.length) bits.push(resolution.enum.join('/'))

  const duration = model.params.find((p) => p.key === 'duration')
  if (duration?.enum?.length) bits.push(`${duration.enum.join('/')}s`)
  else if (duration && duration.max !== undefined) {
    bits.push(`${duration.min ?? 0}-${duration.max}s`)
  }

  if (model.params.some((p) => ['sound', 'generate_audio', 'audio'].includes(p.key))) {
    bits.push('audio')
  }

  const assets = model.params.filter((p) => p.type === 'url' || p.type === 'url[]')
  if (assets.length > 0) {
    const kinds = new Set(assets.flatMap((p) => p.accept ?? []))
    if (kinds.size > 0) bits.push(`takes ${[...kinds].join('+')}`)
  }

  return bits.join(' · ')
}
