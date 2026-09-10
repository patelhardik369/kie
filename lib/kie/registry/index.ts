import { BYTEDANCE_MODELS } from './bytedance.ts'
import { ENHANCE_MODELS } from './enhance.ts'
import { GOOGLE_MODELS } from './google.ts'
import { KLING_MODELS } from './kling.ts'
import { OPENAI_MODELS } from './openai.ts'
import {
  capabilitiesOf,
  type Capability,
  type Family,
  type ModelDefinition,
} from './types.ts'
import { WAN_MODELS } from './wan.ts'

export * from './types.ts'

/**
 * All 86 in-scope models: 19 Kling + 20 ByteDance + 20 Wan + 14 Google +
 * 8 OpenAI + 5 Enhance.
 *
 * Order is browse order, not alphabetical: the three original video families
 * first, then the newer generative families, then Enhance — which is the only
 * family you reach with an asset already in hand rather than a prompt.
 */
export const ALL_MODELS: ModelDefinition[] = [
  ...KLING_MODELS,
  ...BYTEDANCE_MODELS,
  ...WAN_MODELS,
  ...GOOGLE_MODELS,
  ...OPENAI_MODELS,
  ...ENHANCE_MODELS,
]

export {
  BYTEDANCE_MODELS,
  ENHANCE_MODELS,
  GOOGLE_MODELS,
  KLING_MODELS,
  OPENAI_MODELS,
  WAN_MODELS,
}

const BY_SLUG = new Map(ALL_MODELS.map((m) => [m.slug, m]))

export function getModel(slug: string): ModelDefinition | undefined {
  return BY_SLUG.get(slug)
}

/** Throws when the slug is unknown — use where a missing model is a bug. */
export function requireModel(slug: string): ModelDefinition {
  const model = BY_SLUG.get(slug)
  if (!model) {
    throw new Error(
      `Unknown model "${slug}". Slugs are verbatim from the API — check punctuation ` +
        '(bytedance/seedance-1.5-pro uses a dot, bytedance/seedance-2-5 a dash), ' +
        'or run /verify-catalog if Kie may have added it.',
    )
  }
  return model
}

export function modelsByFamily(family: Family): ModelDefinition[] {
  return ALL_MODELS.filter((m) => m.family === family)
}

/** Includes models that serve the capability as a secondary mode. */
export function modelsByCapability(capability: Capability): ModelDefinition[] {
  return ALL_MODELS.filter((m) => capabilitiesOf(m).includes(capability))
}

export function allSlugs(): string[] {
  return ALL_MODELS.map((m) => m.slug)
}

/** Every capability present in the registry, for building filter UI. */
export function availableCapabilities(): Capability[] {
  const seen = new Set<Capability>()
  for (const model of ALL_MODELS) {
    for (const capability of capabilitiesOf(model)) seen.add(capability)
  }
  return [...seen]
}

/** Flat list of a model's parameters, including nested object[] fields. */
export function flattenParams(model: ModelDefinition) {
  return model.params.flatMap((param) =>
    param.fields ? [param, ...param.fields] : [param],
  )
}
