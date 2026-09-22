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

/**
 * `enhance` is a CAPABILITY family, not a vendor: every upscaler and background
 * remover lives there whoever built it. That is why `grok-imagine/upscale` is in
 * scope while the rest of Grok Imagine is not.
 */
export const FAMILIES = [
  'kling',
  'bytedance',
  'wan',
  'google',
  'openai',
  'qwen',
  'enhance',
] as const
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
  'text-to-speech',
  /** Resolution increase on an asset you already have. */
  'upscale',
  'background-removal',
] as const
export type Capability = (typeof CAPABILITIES)[number]

/**
 * Which HTTP contract a model speaks.
 *
 * `jobs` is the unified `POST /jobs/createTask` + `GET /jobs/recordInfo` pair
 * that 96 of the 97 models use. `veo` is Veo 3.1, which predates it: a FLAT
 * request body to `/veo/generate` and a numeric `successFlag` from
 * `/veo/record-info` instead of a `state` string.
 *
 * `lib/kie/veo.ts` adapts both directions so callers still see one `Task`.
 * Nothing above `lib/kie/` may branch on this — see .claude/CLAUDE.md §7.
 */
export const TRANSPORTS = ['jobs', 'veo'] as const
export type Transport = (typeof TRANSPORTS)[number]

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
  /**
   * Ordered list of opaque strings — Gemini Omni's `audio_ids` and
   * `character_ids`.
   *
   * Deliberately NOT `url[]`. These are ids minted by
   * `POST /api/v1/omni/{audio,character}/create`, two synchronous endpoints that
   * are not models and are not in the registry. Typing them as URLs would offer
   * an upload button that cannot produce a valid value.
   */
  | 'string[]'
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
   * The doc marks this field superseded.
   *
   * It stays in the registry and stays reachable — the product promise is every
   * parameter, and a model's own docs are the only authority on which ones
   * exist. The control renders it with the label the doc gives it so the user
   * can tell it apart from its replacement, rather than discovering by 422 that
   * `image_size` and `aspect_ratio` are the same knob.
   */
  deprecated?: boolean
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
       *
       * Reads as a COUNT for a list parameter: Qwen 2.1's `image_urls` normally
       * takes ten references and exactly one once `mask_url` is supplied.
       */
      kind: 'maxWhen'
      keys: string[]
      when: ConstraintWhen
      max: number
      message: string
    }
  | {
      /**
       * `keys` are narrowed to `values` while `when` holds — GPT Image 2's
       * `resolution`, which drops to 1K-only once `aspect_ratio` is `auto`.
       *
       * Narrowing rather than disabling is the point. Disabling `resolution`
       * outright would hide the tier that is still legal, and leaving it alone
       * ships a request the API refuses to even create. `values` must be a
       * subset of the parameter's own `enum`.
       */
      kind: 'allowedValuesWhen'
      keys: string[]
      when: ConstraintWhen
      values: Array<string | number>
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
  /** Omit for `'jobs'`, the unified endpoint 96 of the 97 models use. */
  transport?: Transport
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

/**
 * A doc URL outside `/market`, for a model on a legacy API.
 *
 * Only Veo needs this: it predates the market catalog and is documented under
 * `veo3-api/`. Kept separate from `docUrl` so "not under /market" stays a
 * conscious choice at the call site rather than a string anyone can pass in.
 */
export function legacyDocUrl(page: string): string {
  return `https://docs.kie.ai/${page}.md`
}

/** The transport a model speaks, defaulting to the unified endpoint. */
export function transportOf(model: ModelDefinition): Transport {
  return model.transport ?? 'jobs'
}

/** Every capability a model can serve. */
export function capabilitiesOf(model: ModelDefinition): Capability[] {
  return [model.capability, ...(model.alsoSupports ?? [])]
}
