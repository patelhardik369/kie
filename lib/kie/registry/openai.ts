import { docUrl, type Constraint, type ModelDefinition, type ParamDef } from './types.ts'

/**
 * OpenAI — 4 image models (GPT Image 1.5 x2, GPT Image 2 x2).
 * Transcribed from .claude/skills/kie-models/references/openai.md.
 *
 * Family-wide traps encoded below:
 *  - GPT Image 1.5 slugs carry a `gpt-image/` prefix AND a dot in the version
 *    (`gpt-image/1.5-text-to-image`). GPT Image 2 slugs carry NEITHER, despite
 *    living under `market/gpt/`. Not typos.
 *  - 1.5 marks aspect_ratio and quality REQUIRED with documented defaults;
 *    2 documents no default on anything but requires only the prompt.
 *  - 1.5 offers three aspect ratios; 2 offers sixteen.
 *  - GPT Image 2's resolution tiers are gated on the chosen aspect ratio, and
 *    the gating differs between its text-to-image and image-to-image endpoints.
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
]
