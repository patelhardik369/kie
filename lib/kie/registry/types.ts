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
  /**
   * Ordered colour theme — Wan 2.7 Image's `color_palette`.
   *
   * Items are `{ hex, ratio }`, NOT bare strings: Kie wants each colour paired
   * with the share of the image it should occupy, `"23.51%"`, both required.
   */
  | 'color[]'
  /**
   * Regions drawn on input images — Wan's `bbox_list`.
   *
   * Doubly nested, and the nesting is the contract: one entry per image in the
   * `drawsOn` parameter, in the same order, each holding up to `maxItems` boxes
   * of `[x1, y1, x2, y2]` in the source image's own pixels.
   */
  | 'bbox[][]'

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
  /**
   * For `bbox[][]`: the key of the `url[]` parameter whose images this
   * annotates.
   *
   * The link is declared here rather than assumed by the control, so the form
   * can render a drawing surface per image without knowing which model it is
   * looking at — and so the outer array can never disagree with the image list,
   * which is the shape Kie requires.
   */
  drawsOn?: string
}

/**
 * The test a conditional constraint applies to another field.
 *
 * `equals` covers a switch with a known value; `present` covers "the user put
 * something in it", which is what an array-valued field like `input_urls` needs
 * — there is no single value to compare it against.
 */
export type ConstraintWhen =
  | { key: string; equals: unknown; present?: never }
  | { key: string; present: boolean; equals?: never }

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
      when: ConstraintWhen
      message: string
    }
  | {
      /** `keys` must NOT be set when `when` holds. */
      kind: 'forbiddenWhen'
      keys: string[]
      when: ConstraintWhen
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
      when: ConstraintWhen
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
