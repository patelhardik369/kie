import { docUrl, type Constraint, type ModelDefinition, type ParamDef } from './types.ts'

/**
 * OpenAI — 14 image models (GPT Image 1.5 x2, GPT Image 2 x2, GPT Image 2.5 x4,
 * GPT Image 2.6 x6: Flare, Sunburst and Economy, each text- and image-to-image).
 * Transcribed from .claude/skills/kie-models/references/openai.md.
 *
 * Family-wide traps encoded below:
 *  - GPT Image 1.5 slugs carry a `gpt-image/` prefix AND a dot in the version
 *    (`gpt-image/1.5-text-to-image`). GPT Image 2 and 2.5 slugs carry NEITHER,
 *    despite living under `market/gpt/`. Not typos.
 *  - 1.5 marks aspect_ratio and quality REQUIRED with documented defaults;
 *    2 documents no default on anything but requires only the prompt.
 *  - 1.5 offers three aspect ratios; 2 offers sixteen; 2.5 offers thirteen that
 *    are NOT a subset of 2's — four are new and seven are gone. Completing one
 *    from the other is the exact mistake .claude/skills/kie-models/SKILL.md
 *    warns about.
 *  - GPT Image 2's resolution tiers are gated on the chosen aspect ratio, and
 *    the gating differs between its text-to-image and image-to-image endpoints.
 *    2.5 gates on a DIFFERENT set of ratios and drops `background` entirely.
 *
 * Sora is not offered by Kie, and the legacy 4o Image API is a separate
 * non-unified endpoint deliberately left out of scope.
 */

// ------------------------------------------------------------ GPT Image 1.5

const GPT15_ASPECT = ['1:1', '2:3', '3:2']

const gpt15Quality: ParamDef = {
  key: 'quality',
  type: 'enum',
  label: 'Quality',
  describe: 'medium is balanced; high is slower and more detailed.',
  group: 'framing',
  required: true,
  enum: ['medium', 'high'],
  default: 'medium',
}

function gpt15Aspect(defaultValue: string): ParamDef {
  return {
    key: 'aspect_ratio',
    type: 'enum',
    label: 'Aspect ratio',
    describe: 'Only three shapes on this model — GPT Image 2 offers sixteen.',
    group: 'framing',
    required: true,
    enum: GPT15_ASPECT,
    default: defaultValue,
  }
}

// -------------------------------------------------------------- GPT Image 2

const GPT2_ASPECT = [
  'auto',
  '1:1',
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  '5:4',
  '4:5',
  '16:9',
  '9:16',
  '2:1',
  '1:2',
  '3:1',
  '1:3',
  '21:9',
  '9:21',
]

const gpt2Resolution: ParamDef = {
  key: 'resolution',
  type: 'enum',
  label: 'Resolution',
  describe:
    'Which tiers are available depends on the aspect ratio — the control narrows itself as you choose one.',
  group: 'framing',
  enum: ['1K', '2K', '4K'],
}

const gpt2Background: ParamDef = {
  key: 'background',
  type: 'enum',
  label: 'Background',
  describe: 'Transparency of the output. Supported at 1K only.',
  group: 'framing',
  enum: ['transparent', 'opaque', 'auto'],
}

function gpt2Aspect(describe: string): ParamDef {
  return {
    key: 'aspect_ratio',
    type: 'enum',
    label: 'Aspect ratio',
    describe,
    group: 'framing',
    enum: GPT2_ASPECT,
  }
}

/**
 * The restriction both GPT Image 2 endpoints share, quoted from the docs:
 * "Images with a 1:1 aspect ratio cannot be converted to 4K images" and
 * "Images with the aspect ratio set to auto … will only be converted to 1K
 * images; otherwise, the task will fail to create."
 *
 * Expressed against `resolution` rather than `aspect_ratio` because that is the
 * order the choices get made in: pick a shape, then a size. Narrowing the second
 * control reads as guidance; narrowing the first reads as the shape being taken
 * away.
 */
const GPT2_SHARED_CONSTRAINTS: Constraint[] = [
  {
    kind: 'allowedValuesWhen',
    keys: ['resolution'],
    when: { key: 'aspect_ratio', equals: 'auto' },
    values: ['1K'],
    message:
      'An automatic aspect ratio renders at 1K only — pick an explicit ratio to reach 2K or 4K, or the task fails to create.',
  },
  {
    /*
     * The doc restricts BOTH halves of that sentence: "the aspect ratio set to
     * auto **or without a specified aspect ratio parameter** will only be
     * converted to 1K images; otherwise, the task will fail to create."
     *
     * Omitting the field is not the same state as setting it to `auto` — this
     * model documents no default, so an unset ratio resolves to nothing and the
     * `equals: 'auto'` rule above never fires for it.
     */
    kind: 'allowedValuesWhen',
    keys: ['resolution'],
    when: { key: 'aspect_ratio', present: false },
    values: ['1K'],
    message:
      'With no aspect ratio chosen, this renders at 1K only — pick a ratio to reach 2K or 4K, or the task fails to create.',
  },
  {
    kind: 'allowedValuesWhen',
    keys: ['resolution'],
    when: { key: 'aspect_ratio', equals: '1:1' },
    values: ['1K', '2K'],
    message: 'Square images cannot be rendered at 4K.',
  },
  {
    kind: 'forbiddenWhen',
    keys: ['background'],
    when: { key: 'resolution', equals: '2K' },
    message: 'Background transparency is supported at 1K only.',
  },
  {
    kind: 'forbiddenWhen',
    keys: ['background'],
    when: { key: 'resolution', equals: '4K' },
    message: 'Background transparency is supported at 1K only.',
  },
]

/** One constraint per ratio the doc names as 1K-only. */
function oneKOnly(ratios: string[]): Constraint[] {
  return ratios.map((ratio) => ({
    kind: 'allowedValuesWhen' as const,
    keys: ['resolution'],
    when: { key: 'aspect_ratio', equals: ratio },
    values: ['1K'],
    message: `The ${ratio} aspect ratio is supported at 1K only.`,
  }))
}

const gpt2Prompt: ParamDef = {
  key: 'prompt',
  type: 'text',
  label: 'Prompt',
  describe: 'What you want to see.',
  group: 'core',
  required: true,
  maxLength: 20000,
}

const gptInputUrls: ParamDef = {
  key: 'input_urls',
  type: 'url[]',
  label: 'Input images',
  describe: 'Up to 16 source images.',
  group: 'core',
  required: true,
  maxItems: 16,
  accept: ['image'],
}

// ------------------------------------------------------------ GPT Image 2.5

/**
 * Thirteen ratios — and NOT a subset of GPT Image 2's sixteen.
 *
 * 2.5 ADDS `27:16`, `16:27`, `9:8` and `8:9`, and DROPS `5:4`, `4:5`, `2:1`,
 * `1:2`, `3:1`, `1:3` and `9:21`. Two sets that each hold what the other lacks,
 * which is why lib/models/traps.ts reports `aspect_ratio` as a genuine
 * divergence rather than a capability difference: `2:1` is valid on GPT Image 2
 * and a 422 on 2.5, and `9:8` is the reverse.
 *
 * Order is the `enum` order from the OpenAPI block, which puts 4:3/3:4 ahead of
 * 16:9/9:16. The kie.ai playground renders them the other way round; the schema
 * is what the server reads.
 *
 * All four 2.5 endpoints share this list exactly — text-to-image and
 * image-to-image do NOT differ here the way GPT Image 2's do.
 */
const GPT25_ASPECT = [
  'auto',
  '1:1',
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '21:9',
  '27:16',
  '16:27',
  '9:8',
  '8:9',
]

/** The four ratios 2.5 caps at 1K. Nothing to do with GPT Image 2's five. */
const GPT25_ONE_K_ONLY = ['27:16', '16:27', '9:8', '8:9']

/**
 * `auto` is NOT restricted to 1K on 2.5.
 *
 * On GPT Image 2 it is, and carrying that rule across would quietly deny 2K and
 * 4K on the very shape the form opens on. 2.5's own wording names only the four
 * ratios above: "The 27:16, 16:27, 9:8 and 8:9 aspect ratios support 1K only.
 * 2K and 4K are available for other aspect ratios."
 */
const GPT25_CONSTRAINTS: Constraint[] = oneKOnly(GPT25_ONE_K_ONLY)

const gpt25Aspect: ParamDef = {
  key: 'aspect_ratio',
  type: 'enum',
  label: 'Aspect ratio',
  describe:
    '27:16, 16:27, 9:8 and 8:9 render at 1K only — every other shape reaches 2K and 4K.',
  group: 'framing',
  enum: GPT25_ASPECT,
  default: 'auto',
}

const gpt25Resolution: ParamDef = {
  key: 'resolution',
  type: 'enum',
  label: 'Resolution',
  describe:
    'Output size, and what it costs: 6 credits at 1K, 10 at 2K, 16 at 4K. The four narrow ratios cap this at 1K.',
  group: 'framing',
  enum: ['1K', '2K', '4K'],
  default: '1K',
}

const gpt25Prompt: ParamDef = {
  key: 'prompt',
  type: 'text',
  label: 'Prompt',
  describe: 'What you want to see.',
  group: 'core',
  required: true,
  minLength: 1,
  maxLength: 20000,
}

const gpt25EditPrompt: ParamDef = {
  key: 'prompt',
  type: 'text',
  label: 'Prompt',
  describe:
    'How to change the supplied images. 2.5 holds the untouched parts steady, so naming what must NOT change is worth the words.',
  group: 'core',
  required: true,
  // The schema states no maxLength here, unlike the text-to-image sibling; the
  // field description on the same page says "up to 20,000 characters".
  maxLength: 20000,
}

const gpt25InputUrls: ParamDef = {
  key: 'input_urls',
  type: 'url[]',
  label: 'Input images',
  describe: 'Up to 16 source images. Kie accepts JPEG, PNG and WEBP, 30MB each.',
  group: 'core',
  required: true,
  maxItems: 16,
  accept: ['image'],
}

// ------------------------------------------------------------ GPT Image 2.6

/**
 * Sixteen ratios — GPT Image 2's set (with 21:9 / 9:21 ahead of 3:1 / 1:3),
 * NOT 2.5's thirteen. There is no 27:16 / 16:27 / 9:8 / 8:9 on 2.6.
 */
const GPT26_ASPECT = [
  'auto',
  '1:1',
  '3:2',
  '2:3',
  '4:3',
  '3:4',
  '5:4',
  '4:5',
  '16:9',
  '9:16',
  '2:1',
  '1:2',
  '21:9',
  '9:21',
  '3:1',
  '1:3',
]

/** Economy's eight — a subset of the full sixteen, in its own doc order. */
const GPT26_ECONOMY_ASPECT = ['auto', '1:1', '16:9', '9:16', '3:2', '2:3', '21:9', '4:3']

const GPT26_FORMATS = ['png', 'jpeg', 'webp', 'gif', 'svg'] as const

/** Every format other than `keep`, for "send only when output_format=…" rules. */
function otherFormats(...keep: string[]): string[] {
  return GPT26_FORMATS.filter((f) => !keep.includes(f))
}

/**
 * 2.6 switches field sets on `output_format`, and the doc is blunt about it:
 * GIF fields "Send only when output_format=gif … Do not send for non-gif";
 * `svg` "only when output_format=svg"; `output_compression` "only when
 * output_format is jpeg or webp. Do not include this field for other formats."
 *
 * ConstraintWhen tests equality, so "not gif" is spelled as one rule per other
 * format. `output_format` defaults to png, and an omitted field resolves to its
 * default, so the GIF and SVG groups open greyed out — and a disabled field
 * never reaches the payload.
 *
 * Transparency: "`output_format` must be `png` or `webp`" on `background`, and
 * the same field's summary line adds gif. jpeg and svg are excluded by both
 * sentences, so they are what is narrowed; gif is left to the server.
 */
const GPT26_CONSTRAINTS: Constraint[] = [
  ...otherFormats('gif').map(
    (format): Constraint => ({
      kind: 'forbiddenWhen',
      keys: ['size', 'frame_count', 'frame_duration_ms'],
      when: { key: 'output_format', equals: format },
      message: 'Frame size, count and duration apply to GIF output only.',
    }),
  ),
  ...otherFormats('svg').map(
    (format): Constraint => ({
      kind: 'forbiddenWhen',
      keys: ['svg'],
      when: { key: 'output_format', equals: format },
      message: 'SVG options apply to SVG output only.',
    }),
  ),
  ...otherFormats('jpeg', 'webp').map(
    (format): Constraint => ({
      kind: 'forbiddenWhen',
      keys: ['output_compression'],
      when: { key: 'output_format', equals: format },
      message: 'Compression applies to JPEG and WebP output only.',
    }),
  ),
  ...['jpeg', 'svg'].map(
    (format): Constraint => ({
      kind: 'allowedValuesWhen',
      keys: ['background'],
      when: { key: 'output_format', equals: format },
      values: ['opaque', 'auto'],
      message: 'A transparent background needs PNG or WebP output.',
    }),
  ),
]

const gpt26Resolution: ParamDef = {
  key: 'resolution',
  type: 'enum',
  label: 'Resolution',
  describe:
    'Static-image tier: 1:1 is 1024 / 2048 / 2880px square; 16:9 is 1536×864 / 2048×1152 / 3840×2160.',
  group: 'framing',
  enum: ['1K', '2K', '4K'],
  default: '1K',
}

const gpt26Quality: ParamDef = {
  key: 'quality',
  type: 'enum',
  label: 'Quality',
  describe: 'Rendering quality.',
  group: 'framing',
  enum: ['low', 'medium', 'high', 'xhigh', 'max', 'auto'],
  default: 'medium',
}

const gpt26Complexity: ParamDef = {
  key: 'complexity',
  type: 'enum',
  label: 'Planning complexity',
  describe: 'How much planning the model does before rendering.',
  group: 'advanced',
  enum: ['low', 'medium', 'high'],
  default: 'high',
}

const gpt26Moderation: ParamDef = {
  key: 'moderation',
  type: 'enum',
  label: 'Moderation',
  describe: 'Moderation strength.',
  group: 'advanced',
  enum: ['auto', 'low'],
  default: 'low',
}

const gpt26Compression: ParamDef = {
  key: 'output_compression',
  type: 'number',
  label: 'Compression',
  describe: 'JPEG / WebP compression, 0-100. Sent only with those two formats.',
  group: 'advanced',
  min: 0,
  max: 100,
  step: 1,
}

/**
 * Flare and Sunburst share one schema per direction, field for field — checked by
 * diffing the four OpenAPI blocks, which differ only in whitespace inside one
 * description. The tiers differ in output, so the only things that vary here are
 * the slug, the label, the doc page and the positioning line.
 *
 * Economy is NOT a third instance of this: its schema is smaller and differently
 * typed, and is written out separately below.
 */
type Gpt26FullTier = 'flare' | 'sunburst'

const GPT26_TIER_LABEL: Record<Gpt26FullTier, string> = {
  flare: 'Flare',
  sunburst: 'Sunburst',
}

const GPT26_TIER_NOTE: Record<Gpt26FullTier, string> = {
  flare: 'Flare is the fast tier, which OpenAI says improves layout quality.',
  sunburst:
    'Sunburst is the refined tier, for higher-quality output and consistent edits — same schema as Flare.',
}

function gpt26TextToImage(tier: Gpt26FullTier): ModelDefinition {
  return {
    slug: `gpt-image-2-6/${tier}-text-to-image`,
    family: 'openai',
    capability: 'text-to-image',
    label: `GPT Image 2.6 ${GPT26_TIER_LABEL[tier]} — Text to Image`,
    docUrl: docUrl(`gpt/gpt-image-2-6-${tier}-text-to-image`),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe:
          'Subject, setting, composition, lighting and style. Put any text that should appear in the image in quotes.',
        group: 'core',
        required: true,
        minLength: 1,
        maxLength: 32000,
      },
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe:
          'Shape of a static image (png / jpeg / webp / svg), mapped to pixels with the resolution. GIF frames use Frame size instead.',
        group: 'framing',
        enum: GPT26_ASPECT,
        default: 'auto',
      },
      gpt26Resolution,
      gpt26Quality,
      {
        key: 'background',
        type: 'enum',
        label: 'Background',
        describe:
          'transparent for cut-outs, icons and stickers (PNG or WebP); opaque is always solid; auto lets the model decide.',
        group: 'framing',
        enum: ['transparent', 'opaque', 'auto'],
        default: 'auto',
      },
      {
        key: 'output_format',
        type: 'enum',
        label: 'Output format',
        describe:
          'gif unlocks the frame controls; svg unlocks the SVG author model. jpg is accepted as jpeg.',
        group: 'framing',
        enum: [...GPT26_FORMATS],
        default: 'png',
      },
      gpt26Complexity,
      gpt26Moderation,
      gpt26Compression,
      {
        key: 'size',
        type: 'string',
        label: 'Frame size',
        describe:
          'GIF per-frame pixels as WIDTHxHEIGHT, both multiples of 16 — not a ratio like 1:1. auto is 512x512. 512x512 works for 2-16 frames; 768x768 for at most 12; 1024x1024 never fits.',
        group: 'motion',
        default: 'auto',
      },
      {
        key: 'frame_count',
        type: 'number',
        label: 'Frame count',
        describe: 'GIF frames, an integer 2-16.',
        group: 'motion',
        min: 2,
        max: 16,
        step: 1,
        default: 9,
      },
      {
        key: 'frame_duration_ms',
        type: 'number',
        label: 'Frame duration (ms)',
        describe: 'Per GIF frame, integer milliseconds, 20-2000 in steps of 10.',
        group: 'motion',
        min: 20,
        max: 2000,
        step: 10,
        default: 200,
      },
      {
        key: 'svg',
        type: 'object',
        label: 'SVG',
        describe: 'SVG output only. Left empty, Kie uses gpt-5.6-luna.',
        group: 'advanced',
        fields: [
          {
            key: 'model',
            type: 'enum',
            label: 'Author model',
            describe:
              'Text model that writes the SVG. Billed as image tokens plus this model\'s input/output tokens.',
            group: 'core',
            enum: ['gpt-6-sol', 'gpt-5.6-luna', 'gpt-5.6-terra'],
            default: 'gpt-5.6-luna',
          },
        ],
      },
    ],
    constraints: GPT26_CONSTRAINTS,
    notes:
      `${GPT26_TIER_NOTE[tier]} ` +
      'Slug is `gpt-image-2-6/flare-text-to-image` — a `gpt-image-2-6/` PREFIX and a slash, unlike 2.5 ' +
      '(`gpt-image-2-5-flare-text-to-image`, one hyphenated string). Sixteen ratios, GPT Image 2\'s set rather ' +
      'than 2.5\'s, and no ratio is capped to a tier. Output format switches field sets: GIF uses size / ' +
      'frame_count / frame_duration_ms, SVG uses `svg.model`, compression is JPEG/WebP only — each is greyed ' +
      'out for the other formats because the doc says not to send it. GIF frames are packed into a sprite sheet ' +
      '(2-8 frames 4×2, 9 → 3×3, 10-12 → 4×3, 13-16 → 4×4) that must stay ≤ 3840 per side, ≤ 8,294,400 pixels ' +
      'and ≤ 3:1, or Kie returns 400 — the form does not compute that, so trust the size guidance. ' +
      'DOC CONFLICT: `background` says transparency needs png or webp, while its summary also lists gif; jpeg ' +
      'and svg are blocked, gif is left to the server. The SVG request example uses `gpt-5.4-mini`, which is not ' +
      'in the enum and is not offered.',
  }
}

function gpt26ImageToImage(tier: Gpt26FullTier): ModelDefinition {
  return {
    slug: `gpt-image-2-6/${tier}-image-to-image`,
    family: 'openai',
    capability: 'image-to-image',
    label: `GPT Image 2.6 ${GPT26_TIER_LABEL[tier]} — Image to Image`,
    docUrl: docUrl(`gpt/gpt-image-2-6-${tier}-image-to-image`),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe:
          'How to edit or combine the input images. Say what should stay the same and what should change; put any text that should appear in quotes.',
        group: 'core',
        required: true,
        minLength: 1,
        maxLength: 32000,
      },
      {
        key: 'input_urls',
        type: 'url[]',
        label: 'Input images',
        describe: 'Up to 16 reference images, JPEG / PNG / WebP.',
        group: 'core',
        required: true,
        maxItems: 16,
        accept: ['image'],
      },
      {
        key: 'mask_url',
        type: 'url',
        label: 'Inpaint mask',
        describe: 'Optional mask for a local edit. Not together with a markup overlay.',
        group: 'core',
        accept: ['image'],
      },
      {
        key: 'markup',
        type: 'url',
        label: 'Markup overlay',
        describe:
          'Optional transparent PNG drawn over the FIRST input image to show the edit. Not together with a mask.',
        group: 'core',
        accept: ['image'],
      },
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe: 'Mapped to pixels with the resolution.',
        group: 'framing',
        enum: GPT26_ASPECT,
        default: 'auto',
      },
      gpt26Resolution,
      gpt26Quality,
      {
        key: 'background',
        type: 'enum',
        label: 'Background',
        describe:
          'transparent for cut-outs, icons and stickers (PNG or WebP only); opaque is always solid; auto lets the model decide.',
        group: 'framing',
        enum: ['transparent', 'opaque', 'auto'],
        default: 'auto',
      },
      {
        key: 'output_format',
        type: 'enum',
        label: 'Output format',
        describe: 'Static formats only — GIF and SVG are text-to-image features. jpg is accepted as jpeg.',
        group: 'framing',
        enum: ['png', 'jpeg', 'webp'],
        default: 'png',
      },
      gpt26Complexity,
      gpt26Moderation,
      gpt26Compression,
    ],
    constraints: [
      {
        kind: 'mutuallyExclusive',
        keys: ['mask_url', 'markup'],
        message: 'Use an inpaint mask or a markup overlay, not both.',
      },
      {
        kind: 'forbiddenWhen',
        keys: ['output_compression'],
        when: { key: 'output_format', equals: 'png' },
        message: 'Compression applies to JPEG and WebP output only.',
      },
      {
        kind: 'allowedValuesWhen',
        keys: ['background'],
        when: { key: 'output_format', equals: 'jpeg' },
        values: ['opaque', 'auto'],
        message: 'A transparent background needs PNG or WebP output.',
      },
    ],
    notes:
      `${GPT26_TIER_NOTE[tier]} ` +
      'Slug is `gpt-image-2-6/flare-image-to-image` — prefix and slash, like its text-to-image sibling. Same ' +
      'sixteen ratios, quality, complexity and moderation, but output is png / jpeg / webp only: no GIF frame ' +
      'controls and no `svg`. Adds `mask_url` (inpaint) and `markup` (a transparent PNG overlaid on the first ' +
      'input image), which cannot be combined. Unlike the text-to-image page, this one states transparency as ' +
      'png / webp with no mention of gif.',
  }
}

/**
 * The paragraph every 2.5 entry needs, plus whatever is true of just that one.
 *
 * `notes` surfaces verbatim in the model browser (lib/models/traps.ts), so this
 * is written for someone about to send a request, not as a changelog.
 */
function gpt25Notes(tier: 'Flare' | 'Sunburst', extra: string): string {
  const positioning =
    tier === 'Flare'
      ? 'Flare is the lower-latency tier Kie recommends by default — creator content, social, prototyping, high volume.'
      : 'Sunburst is the premium tier: tighter control and more polished output for campaign and product work, at the same posted price as Flare.'

  return (
    `${positioning} ` +
    'Slug carries no vendor prefix despite the market/gpt/ doc path, and no dot in 2-5. ' +
    "Thirteen aspect ratios, and they are NOT GPT Image 2's sixteen — 27:16, 16:27, 9:8 and 8:9 are new here, " +
    'while 5:4, 4:5, 2:1, 1:2, 3:1, 1:3 and 9:21 do not exist on 2.5. There is no `background` field at all, so ' +
    'transparency is not reachable on this tier. Unlike GPT Image 2, `auto` is NOT capped at 1K. ' +
    'Pricing: 6 credits ($0.03) at 1K, 10 ($0.05) at 2K, 16 ($0.08) at 4K. ' +
    'DOC CONFLICT: the OpenAPI block at docs.kie.ai declares no default on aspect_ratio or resolution, while ' +
    'kie.ai/gpt-image-2-5 states "auto" and "1K" and ships exactly those in its own request example — the stated ' +
    `defaults are used here, and both are enum members either way. ${extra}`
  )
}

export const OPENAI_MODELS: ModelDefinition[] = [
  {
    slug: 'gpt-image/1.5-text-to-image',
    family: 'openai',
    capability: 'text-to-image',
    label: 'GPT Image 1.5 — Text to Image',
    docUrl: docUrl('gpt-image/1-5-text-to-image'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'What you want to see.',
        group: 'core',
        required: true,
      },
      gpt15Aspect('1:1'),
      gpt15Quality,
    ],
    notes:
      'Slug keeps the gpt-image/ prefix and the dot in 1.5; GPT Image 2 has neither. Three of its four fields ' +
      'are required, all with documented defaults, so buildRequestInput always has something to send. ' +
      'No documented prompt length limit.',
  },

  {
    slug: 'gpt-image/1.5-image-to-image',
    family: 'openai',
    capability: 'image-to-image',
    label: 'GPT Image 1.5 — Image to Image',
    docUrl: docUrl('gpt-image/1-5-image-to-image'),
    outputKind: 'image',
    params: [
      {
        key: 'input_urls',
        type: 'url[]',
        label: 'Input images',
        describe: 'Up to 16 source images, max 10.0MB each.',
        group: 'core',
        required: true,
        maxItems: 16,
        accept: ['image'],
      },
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'How to edit the supplied images.',
        group: 'core',
        required: true,
      },
      // 3:2 here, 1:1 on the text-to-image sibling.
      gpt15Aspect('3:2'),
      gpt15Quality,
    ],
    notes:
      'aspect_ratio defaults to 3:2 here but 1:1 on gpt-image/1.5-text-to-image. All four fields are required.',
  },

  {
    slug: 'gpt-image-2-text-to-image',
    family: 'openai',
    capability: 'text-to-image',
    label: 'GPT Image 2 — Text to Image',
    docUrl: docUrl('gpt/gpt-image-2-text-to-image'),
    outputKind: 'image',
    params: [
      { ...gpt2Prompt, minLength: 1 },
      gpt2Aspect(
        'Shape of the generated image. 5:4, 4:5, 3:1, 1:3 and 9:21 render at 1K only.',
      ),
      gpt2Resolution,
      gpt2Background,
    ],
    constraints: [
      ...GPT2_SHARED_CONSTRAINTS,
      ...oneKOnly(['5:4', '4:5', '3:1', '1:3', '9:21']),
    ],
    notes:
      'Slug has no vendor prefix despite the market/gpt/ doc path. No documented default on aspect_ratio, ' +
      'resolution or background — the prose says aspect_ratio "is set to auto by default" but the schema ' +
      'states none, so nothing is sent unless chosen. Five ratios are 1K-only here; the image-to-image ' +
      'sibling restricts only two.',
  },

  {
    slug: 'gpt-image-2-image-to-image',
    family: 'openai',
    capability: 'image-to-image',
    label: 'GPT Image 2 — Image to Image',
    docUrl: docUrl('gpt/gpt-image-2-image-to-image'),
    outputKind: 'image',
    params: [
      gpt2Prompt,
      gptInputUrls,
      gpt2Aspect('Shape of the generated image. 5:4 and 4:5 render at 1K only.'),
      gpt2Resolution,
      gpt2Background,
    ],
    constraints: [...GPT2_SHARED_CONSTRAINTS, ...oneKOnly(['5:4', '4:5'])],
    notes:
      'Slug has no vendor prefix despite the market/gpt/ doc path. Only 5:4 and 4:5 are 1K-only here, ' +
      'where the text-to-image sibling also restricts 3:1, 1:3 and 9:21. No documented file-size limit on ' +
      'input_urls, unlike GPT Image 1.5.',
  },

  // ---------------------------------------------------------- GPT Image 2.5

  {
    slug: 'gpt-image-2-5-flare-text-to-image',
    family: 'openai',
    capability: 'text-to-image',
    label: 'GPT Image 2.5 Flare — Text to Image',
    docUrl: docUrl('gpt/gpt-image-2-5-flare-text-to-image'),
    outputKind: 'image',
    params: [gpt25Prompt, gpt25Aspect, gpt25Resolution],
    constraints: GPT25_CONSTRAINTS,
    notes: gpt25Notes(
      'Flare',
      'Three fields, and only the prompt is required (1-20000 characters).',
    ),
  },

  {
    slug: 'gpt-image-2-5-flare-image-to-image',
    family: 'openai',
    capability: 'image-to-image',
    label: 'GPT Image 2.5 Flare — Image to Image',
    docUrl: docUrl('gpt/gpt-image-2-5-flare-image-to-image'),
    outputKind: 'image',
    params: [gpt25EditPrompt, gpt25InputUrls, gpt25Aspect, gpt25Resolution],
    constraints: GPT25_CONSTRAINTS,
    notes: gpt25Notes(
      'Flare',
      "STALE DOC: the x-apidog-enum annotation on this page still lists GPT Image 2's ratios (5:4, 2:1, 9:21 and so on). " +
        'The `enum` beside it — the half the server validates — is the same thirteen as the text-to-image sibling, and that is what is transcribed here.',
    ),
  },

  {
    slug: 'gpt-image-2-5-sunburst-text-to-image',
    family: 'openai',
    capability: 'text-to-image',
    label: 'GPT Image 2.5 Sunburst — Text to Image',
    docUrl: docUrl('gpt/gpt-image-2-5-sunburst-text-to-image'),
    outputKind: 'image',
    params: [gpt25Prompt, gpt25Aspect, gpt25Resolution],
    constraints: GPT25_CONSTRAINTS,
    notes: gpt25Notes(
      'Sunburst',
      'Parameter-for-parameter identical to the Flare sibling — the tiers differ in output, not in schema, so the only thing to get right is the slug.',
    ),
  },

  {
    slug: 'gpt-image-2-5-sunburst-image-to-image',
    family: 'openai',
    capability: 'image-to-image',
    label: 'GPT Image 2.5 Sunburst — Image to Image',
    docUrl: docUrl('gpt/gpt-image-2-5-sunburst-image-to-image'),
    outputKind: 'image',
    params: [gpt25EditPrompt, gpt25InputUrls, gpt25Aspect, gpt25Resolution],
    constraints: GPT25_CONSTRAINTS,
    notes: gpt25Notes(
      'Sunburst',
      "Parameter-for-parameter identical to the Flare sibling. STALE DOC: its x-apidog-enum annotation still lists GPT Image 2's ratios; " +
        'the `enum` the server validates against is the same thirteen used throughout 2.5.',
    ),
  },
  // ---------------------------------------------------------- GPT Image 2.6

  gpt26TextToImage('flare'),
  gpt26ImageToImage('flare'),
  gpt26TextToImage('sunburst'),
  gpt26ImageToImage('sunburst'),

  {
    slug: 'gpt-image-2-6/economy-text-to-image',
    family: 'openai',
    capability: 'text-to-image',
    label: 'GPT Image 2.6 Economy — Text to Image',
    docUrl: docUrl('gpt/gpt-image-2-6-economy-text-to-image'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe:
          'Subject, setting, composition, lighting and style. Put any text that should appear in the image in quotes.',
        group: 'core',
        required: true,
        minLength: 1,
        maxLength: 20000,
      },
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe:
          'auto lets the model pick the frame that fits the prompt. Economy offers eight shapes only.',
        group: 'framing',
        enum: GPT26_ECONOMY_ASPECT,
        default: 'auto',
      },
      {
        key: 'background',
        type: 'enum',
        label: 'Background',
        describe:
          'transparent for cut-outs, icons and stickers; opaque is always solid; auto lets the model decide.',
        group: 'framing',
        enum: ['transparent', 'opaque', 'auto'],
        default: 'auto',
      },
      {
        key: 'output_format',
        type: 'enum',
        label: 'Output format',
        describe: 'Economy outputs PNG or an animated GIF only.',
        group: 'framing',
        enum: ['png', 'gif'],
        default: 'png',
      },
      {
        key: 'frame_count',
        type: 'enum',
        label: 'Frame count',
        describe:
          'GIF only. auto lets the model choose. Sent as a quoted string — not the 2-16 integer Flare and Sunburst take.',
        group: 'motion',
        enum: ['auto', '4', '9', '16', '25', '36', '64'],
        default: 'auto',
      },
      {
        key: 'frame_duration_ms',
        type: 'number',
        label: 'Frame duration (ms)',
        describe:
          'GIF only. Integer 20-2000, rounded to 10ms. Leave empty for auto — the model chooses.',
        group: 'motion',
        min: 20,
        max: 2000,
        step: 10,
      },
    ],
    constraints: [
      {
        kind: 'forbiddenWhen',
        keys: ['frame_count', 'frame_duration_ms'],
        when: { key: 'output_format', equals: 'png' },
        message: 'Frame count and duration apply to GIF output only.',
      },
    ],
    notes:
      'Economy is the third 2.6 tier, with a much smaller schema than Flare / Sunburst: no resolution, quality, ' +
      'complexity, moderation, compression, GIF `size` or `svg`; eight aspect ratios (auto, 1:1, 16:9, 9:16, 3:2, ' +
      "2:3, 21:9, 4:3); png or gif only; 20,000-character prompts. `frame_count` is a STRING enum including auto and " +
      "values up to 64 — Flare's is an integer 2-16. DOC CONFLICT: `frame_duration_ms` is typed `number` with no " +
      'default, while its description calls `auto` the default and the request example sends the string "auto". ' +
      'The registry follows the type (a number, 20-2000) and leaves it empty to get auto; sending the string is ' +
      'not offered.',
  },

  {
    slug: 'gpt-image-2-6/economy-image-to-image',
    family: 'openai',
    capability: 'image-to-image',
    alsoSupports: ['text-to-image'],
    label: 'GPT Image 2.6 Economy — Image to Image',
    docUrl: docUrl('gpt/gpt-image-2-6-economy-image-to-image'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe:
          'How to edit or combine the input images. Say what should stay the same and what should change; with several images, refer to them by order.',
        group: 'core',
        required: true,
        minLength: 1,
        maxLength: 20000,
      },
      {
        key: 'input_urls',
        type: 'url[]',
        label: 'Input images',
        describe: 'Optional, up to 16. JPEG, PNG or WebP, up to 30MB each.',
        group: 'core',
        maxItems: 16,
        accept: ['image'],
      },
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe: 'auto fits the prompt and input images. Economy offers eight shapes only.',
        group: 'framing',
        enum: GPT26_ECONOMY_ASPECT,
        default: 'auto',
      },
      {
        key: 'background',
        type: 'enum',
        label: 'Background',
        describe:
          'transparent for cut-outs, icons and stickers; opaque is always solid; auto lets the model decide.',
        group: 'framing',
        enum: ['transparent', 'opaque', 'auto'],
        default: 'auto',
      },
      {
        key: 'output_format',
        type: 'enum',
        label: 'Output format',
        describe: 'Economy image-to-image outputs PNG only.',
        group: 'framing',
        enum: ['png'],
        default: 'png',
      },
    ],
    notes:
      'Economy editing: input_urls is OPTIONAL here (up to 16), unlike Flare / Sunburst image-to-image where it is ' +
      'required — without images it runs as text-to-image. PNG output only, no GIF, no mask or markup, no ' +
      'resolution / quality controls, eight aspect ratios, 20,000-character prompts.',
  },
]
