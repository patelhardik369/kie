import { docUrl, type Constraint, type ModelDefinition, type ParamDef } from './types.ts'

/**
 * OpenAI — 8 image models (GPT Image 1.5 x2, GPT Image 2 x2, GPT Image 2.5 x4).
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
]
