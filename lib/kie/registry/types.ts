/**
 * The registry schema. Pure module — no env, no network.
 *
 * A model is DATA, never code branches. The parameter form, the validator, the
 * model browser and the request builder all read these definitions, so adding
 * the 60th model means adding one object.
 *
 * Corollary: if a model cannot be expressed here, extend `ParamType` rather than
 * special-casing the UI. See .claude/skills/kie-models/SKILL.md.
 */

export const FAMILIES = ['kling', 'bytedance', 'wan'] as const
export type Family = (typeof FAMILIES)[number]

export const CAPABILITIES = [
  'text-to-video',
  'image-to-video',
  'reference-to-video',
  'video-to-video',
  'speech-to-video',
  'motion-control',
  'avatar',
  'text-to-image',
  'image-to-image',
  'layer-decomposition',
] as const
export type Capability = (typeof CAPABILITIES)[number]

export type ParamType =
  /** Multiline free text — prompt, negative_prompt. */
  | 'text'
  /** Single-line free text. */
  | 'string'
  /** Fixed option set. */
  | 'enum'
  /** Int or float, with min/max/step. */
  | 'number'
  | 'boolean'
  /** One asset URL — uploadable or pasted. */
  | 'url'
  /** Ordered list of asset URLs. */
  | 'url[]'
  /** Integer with a randomize affordance. */
  | 'seed'
  /** Repeating group — multi_prompt, kling_elements, elements. */
  | 'object[]'
  /** Ordered list of colors — Wan 2.7 Image's `color_palette`. */
  | 'color[]'
  /** Regions drawn on an input image as [x1, y1, x2, y2] — Wan's `bbox_list`. */
  | 'bbox[]'

/**
 * Drives basic/advanced placement only. Grouping is a UI hint — every parameter
 * stays reachable, which is the whole point of this project.
 */
export type ParamGroup = 'core' | 'framing' | 'motion' | 'audio' | 'advanced'

export type AssetKind = 'image' | 'video' | 'audio' | 'file'

export interface ParamDef {
  /** Exact API field name. Never renamed to suit project conventions. */
  key: string
  type: ParamType
  label: string
  describe: string
  group: ParamGroup
  required?: boolean
  /** Present ONLY when the doc states one. */
  default?: unknown
  /** Exact values the API accepts, in doc order. */
  enum?: Array<string | number>
  min?: number
  max?: number
  step?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  /** For `url` / `url[]`. */
  accept?: AssetKind[]
  /** For `object[]`. */
  fields?: ParamDef[]
}

export type Constraint =
  | {
      /** At most one of `keys` may be set. */
      kind: 'mutuallyExclusive'
      keys: string[]
      message: string
    }
  | {
      /**
       * At most one GROUP may contribute values. Fields inside a group combine
       * freely — this is what Seedance's three input modes need, where the
       * reference_* fields work together but never alongside a frame URL.
       */
      kind: 'mutuallyExclusiveGroups'
      groups: string[][]
      message: string
    }
  | {
      /** At least one of `keys` must be set. */
      kind: 'requiresOneOf'
      keys: string[]
      message: string
    }
  | {
      /** `keys` become required when `when` holds. */
      kind: 'requiredWhen'
      keys: string[]
      when: { key: string; equals: unknown }
      message: string
    }
  | {
      /** `keys` must NOT be set when `when` holds. */
      kind: 'forbiddenWhen'
      keys: string[]
      when: { key: string; equals: unknown }
      message: string
    }
  | {
      /** `keys` require `requires` to also be set. */
      kind: 'requires'
      keys: string[]
      requires: string
      message: string
    }
  | {
      /**
       * `keys` take a lower ceiling when `when` holds — Wan 2.7 Image's `n`,
       * which allows 12 in sequential mode but only 4 outside it.
       */
      kind: 'maxWhen'
      keys: string[]
      when: { key: string; equals: unknown }
      max: number
      message: string
    }

export interface ModelDefinition {
  /** Exact API value for `model`. Copied character-for-character. */
  slug: string
  family: Family
  /** Primary mode, used for browsing and filtering. */
  capability: Capability
  /** Other modes the same endpoint serves, when it serves more than one. */
  alsoSupports?: Capability[]
  label: string
  /** The docs.kie.ai page this was transcribed from. */
  docUrl: string
  outputKind: 'video' | 'image' | 'audio' | 'object'
  params: ParamDef[]
  constraints?: Constraint[]
  /** Cost hints, quirks, and anything the doc left ambiguous. */
  notes?: string
}

const DOC_BASE = 'https://docs.kie.ai/market'

/** Builds a doc URL from its page path, e.g. `kling/v2-1-standard`. */
export function docUrl(page: string): string {
  return `${DOC_BASE}/${page}.md`
}

/** Every capability a model can serve. */
export function capabilitiesOf(model: ModelDefinition): Capability[] {
  return [model.capability, ...(model.alsoSupports ?? [])]
}
