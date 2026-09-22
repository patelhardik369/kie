import { docUrl, type ModelDefinition, type ParamDef } from './types.ts'

/**
 * Qwen — 11 image models across four generations.
 * Transcribed from .claude/skills/kie-models/references/qwen.md.
 *
 * The family is really THREE unrelated parameter vocabularies wearing one name,
 * and nothing in the slugs tells you which one you are looking at:
 *
 *  - **Qwen 1** (`qwen/*`) is a diffusion passthrough: `num_inference_steps`,
 *    `guidance_scale`, `acceleration`, `strength`, `enable_safety_checker`.
 *    Its `image_size` takes NAMED sizes (`square_hd`, `landscape_4_3`).
 *  - **Qwen 2** (`qwen2/*`) drops every sampler knob and keeps four fields. Its
 *    `image_size` is the SAME KEY holding aspect RATIOS (`16:9`) — the one
 *    parameter name in this family that means two different things.
 *  - **Qwen 2.1** (`qwen2-1/*`) renames the shape to `aspect_ratio`, adds
 *    `resolution`, `background`, `enhance_prompt`, and a WebP output.
 *  - **Qwen 3** (`qwen3/*`) goes back to `image_size` for ratios, renames
 *    `enhance_prompt` to `prompt_extend`, and keeps `resolution`.
 *
 * Family-wide traps encoded below:
 *  - **The Pro slugs are not what their doc pages are called.** The pages live
 *    at `market/qwen3-pro/…` and the `model` enum reads `qwen3/pro-text-to-image`
 *    — a `qwen3-pro/` prefix is a 422.
 *  - **`image_size` is a named size on Qwen 1 and a ratio on Qwen 2 and Qwen 3**,
 *    while Qwen 2.1 calls the same idea `aspect_ratio`. Four generations, three
 *    vocabularies.
 *  - **Prompt ceilings differ by generation**: 5000 on Qwen 1 text-to-image, 2000
 *    on Qwen 1 image-edit, 800 on both Qwen 2 endpoints, 5000 again on 2.1 and 3.
 *  - **`output_format` enum ORDER flips**: `png, jpeg` on Qwen 1 and Qwen 3,
 *    `jpeg, png` on Qwen 2. The default is `png` throughout, so this only bites
 *    when reading the docs, not the API.
 *  - **Two safety switches, not one.** `nsfw_checker` is Kie's own filter and is
 *    on every model in the catalog; `enable_safety_checker` is the upstream
 *    model's, and only Qwen 1 has it. Both are reachable and they are not
 *    interchangeable.
 */

// --------------------------------------------------------------- shared

/**
 * Kie's own content filter. Present on all 11 pages, always by `$ref` to one
 * shared schema, which is why the wording is identical everywhere.
 *
 * Its documented default is **false** — filtering OFF. The Playground turns it
 * on, and the Qwen 2.1 playground page says "Defaults to true in the Playground"
 * for exactly that reason. The API default is what the registry records.
 */
function nsfwChecker(): ParamDef {
  return {
    key: 'nsfw_checker',
    type: 'boolean',
    label: 'Kie content filter',
    describe:
      'Kie\'s own filter, separate from the model\'s. Off by default over the API — the Playground turns it on. Filtering is never a guarantee.',
    group: 'advanced',
    default: false,
  }
}

/** `png` / `jpeg`, default `png`. `order` differs between generations. */
function outputFormat(values: string[], describe: string): ParamDef {
  return {
    key: 'output_format',
    type: 'enum',
    label: 'Output format',
    describe,
    group: 'framing',
    enum: values,
    default: 'png',
  }
}

function negativePrompt(maxLength: number): ParamDef {
  return {
    key: 'negative_prompt',
    type: 'text',
    label: 'Negative prompt',
    describe: `What must not appear in the image. Up to ${maxLength} characters.`,
    group: 'core',
    maxLength,
  }
}

/** Seed with no documented range or default — Qwen 1, 2 and 2.1. */
function looseSeed(): ParamDef {
  return {
    key: 'seed',
    type: 'seed',
    label: 'Seed',
    describe:
      'The same seed with the same prompt and parameters reproduces the same image on the same model version. Omit it for a random one.',
    group: 'advanced',
  }
}

// ------------------------------------------------------- Qwen 1 (qwen/*)

const QWEN1_IMAGE_SIZES = [
  'square',
  'square_hd',
  'portrait_4_3',
  'portrait_16_9',
  'landscape_4_3',
  'landscape_16_9',
]

/**
 * NAMED sizes, not ratios. `portrait_16_9` is a 9:16 picture — the name reads
 * the orientation first and the ratio second, which is the opposite of how every
 * other model in the catalog writes it.
 */
function qwen1ImageSize(defaultValue: string): ParamDef {
  return {
    key: 'image_size',
    type: 'enum',
    label: 'Image size',
    describe:
      'Named sizes, not ratios — `portrait_16_9` is a 9:16 picture. Qwen 2 and Qwen 3 reuse this key for aspect ratios instead.',
    group: 'framing',
    enum: QWEN1_IMAGE_SIZES,
    default: defaultValue,
  }
}

function inferenceSteps(max: number, defaultValue: number): ParamDef {
  return {
    key: 'num_inference_steps',
    type: 'number',
    label: 'Inference steps',
    describe: `Denoising steps. More is slower and usually more detailed. 2–${max}.`,
    group: 'advanced',
    min: 2,
    max,
    step: 1,
    default: defaultValue,
  }
}

function guidanceScale(defaultValue: number): ParamDef {
  return {
    key: 'guidance_scale',
    type: 'number',
    label: 'Guidance scale',
    describe:
      'CFG — how tightly the image is held to the prompt. Higher follows the words more literally and costs variety.',
    group: 'advanced',
    min: 0,
    max: 20,
    step: 0.1,
    default: defaultValue,
  }
}

/** `none` / `regular` / `high`, default `none`. */
function acceleration(describe: string): ParamDef {
  return {
    key: 'acceleration',
    type: 'enum',
    label: 'Acceleration',
    describe,
    group: 'advanced',
    enum: ['none', 'regular', 'high'],
    default: 'none',
  }
}

/**
 * The UPSTREAM model's safety checker, which only Qwen 1 exposes.
 *
 * No documented default: the page says it is always on in the Playground and can
 * only be turned off by passing `false` through the API, which describes the
 * behaviour without stating a schema default. Recorded as no default rather than
 * guessing `true`.
 */
function enableSafetyChecker(): ParamDef {
  return {
    key: 'enable_safety_checker',
    type: 'boolean',
    label: 'Model safety checker',
    describe:
      "The model's own checker, not Kie's. Always on in the Playground; pass false over the API to turn it off.",
    group: 'advanced',
  }
}

const QWEN1_PROMPT: ParamDef = {
  key: 'prompt',
  type: 'text',
  label: 'Prompt',
  describe: 'What to generate. Up to 5000 characters.',
  group: 'core',
  required: true,
  maxLength: 5000,
}

// ------------------------------------------------------ Qwen 2 (qwen2/*)

function qwen2Prompt(): ParamDef {
  return {
    key: 'prompt',
    type: 'text',
    label: 'Prompt',
    describe:
      'What to generate. Up to 800 characters — a sixth of what every other Qwen generation allows.',
    group: 'core',
    required: true,
    maxLength: 800,
  }
}

/** Ratios under the `image_size` key — Qwen 1 puts named sizes here. */
function qwen2ImageSize(values: string[]): ParamDef {
  return {
    key: 'image_size',
    type: 'enum',
    label: 'Aspect ratio',
    describe:
      'The output shape. Named `image_size` like Qwen 1, but holding ratios — and Qwen 2.1 calls the same idea `aspect_ratio`.',
    group: 'framing',
    enum: values,
    default: '16:9',
  }
}

// -------------------------------------------------- Qwen 2.1 (qwen2-1/*)

const QWEN21_RATIOS = ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9', '9:21']

function qwen21Prompt(describe: string): ParamDef {
  return {
    key: 'prompt',
    type: 'text',
    label: 'Prompt',
    describe,
    group: 'core',
    required: true,
    minLength: 1,
    maxLength: 5000,
  }
}

function qwen21Resolution(describe: string): ParamDef {
  return {
    key: 'resolution',
    type: 'enum',
    label: 'Resolution',
    describe,
    group: 'framing',
    enum: ['1K', '2K'],
    default: '1K',
  }
}

function qwen21Background(): ParamDef {
  return {
    key: 'background',
    type: 'enum',
    label: 'Background',
    describe:
      'Transparent gives a real alpha channel, so describe only the subject — a prompt that mentions a scene or a surface usually fills it back in.',
    group: 'framing',
    enum: ['opaque', 'transparent'],
    default: 'opaque',
  }
}

function qwen21OutputFormat(): ParamDef {
  return outputFormat(
    ['png', 'webp', 'jpeg'],
    'PNG and WebP carry an alpha channel; JPEG does not, so it cannot be combined with a transparent background.',
  )
}

function enhancePrompt(): ParamDef {
  return {
    key: 'enhance_prompt',
    type: 'boolean',
    label: 'Enhance prompt',
    describe:
      'Rewrites the prompt into a fuller scene description before generating. On by default, including when omitted.',
    group: 'advanced',
    default: true,
  }
}

/**
 * The transparency/JPEG pair, in both directions.
 *
 * Narrowed rather than disabled so whichever control you reach second simply
 * loses the one member that cannot work, instead of greying out a choice that is
 * still perfectly available.
 */
const TRANSPARENCY_CONSTRAINTS: ModelDefinition['constraints'] = [
  {
    kind: 'allowedValuesWhen',
    keys: ['output_format'],
    when: { key: 'background', equals: 'transparent' },
    values: ['png', 'webp'],
    message:
      'A transparent background needs an alpha channel, and JPEG has none — pick PNG or WebP, or set the background back to opaque.',
  },
  {
    kind: 'allowedValuesWhen',
    keys: ['background'],
    when: { key: 'output_format', equals: 'jpeg' },
    values: ['opaque'],
    message:
      'JPEG has no alpha channel, so the background stays opaque while the output format is JPEG.',
  },
]

// ------------------------------------ Qwen 3 and Qwen 3 Pro (qwen3/*)

const QWEN3_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9']

/**
 * Qwen 3 and Qwen 3 Pro take the IDENTICAL input schema — the tier is the slug
 * and nothing else. Both text-to-image pages omit a default on `resolution`
 * while both image-to-image pages document `1K`; that difference is transcribed
 * rather than smoothed over.
 */
function qwen3Params(mode: 'text' | 'image'): ParamDef[] {
  const prompt: ParamDef = {
    key: 'prompt',
    type: 'text',
    label: 'Prompt',
    describe:
      'What to generate or edit. Chinese and English are both supported. Up to 5000 characters.',
    group: 'core',
    required: true,
    maxLength: 5000,
  }

  const resolution: ParamDef = {
    key: 'resolution',
    type: 'enum',
    label: 'Resolution',
    describe: 'Output resolution tier.',
    group: 'framing',
    enum: ['1K', '2K'],
    // Documented on the image-to-image pages only.
    ...(mode === 'image' ? { default: '1K' } : {}),
  }

  const imageSize: ParamDef = {
    key: 'image_size',
    type: 'enum',
    label: 'Aspect ratio',
    describe:
      'The output shape. Back under `image_size` again after Qwen 2.1 called it `aspect_ratio`, and with no `9:21` member.',
    group: 'framing',
    enum: QWEN3_RATIOS,
    default: '16:9',
  }

  const promptExtend: ParamDef = {
    key: 'prompt_extend',
    type: 'boolean',
    label: 'Prompt extend',
    describe:
      'Intelligent prompt rewriting, recommended for short descriptions. Qwen 2.1 spells the same idea `enhance_prompt`.',
    group: 'advanced',
    default: true,
  }

  const seed: ParamDef = {
    key: 'seed',
    type: 'seed',
    label: 'Seed',
    describe:
      'A fixed seed keeps results relatively stable. Range 0–2147483647; the only Qwen generation that documents one.',
    group: 'advanced',
    min: 0,
    max: 2147483647,
    default: 1,
  }

  const images: ParamDef = {
    key: 'image_urls',
    type: 'url[]',
    label: 'Input images',
    describe:
      'Up to 3 images, by URL. jpeg, png, webp, bmp, gif or tiff, max 10 MB each. Qwen 2.1 takes up to 10.',
    group: 'core',
    required: true,
    accept: ['image'],
    minItems: 1,
    maxItems: 3,
  }

  return [
    ...(mode === 'image' ? [images] : []),
    prompt,
    negativePrompt(5000),
    resolution,
    imageSize,
    outputFormat(['png', 'jpeg'], 'The generated image format.'),
    promptExtend,
    seed,
    nsfwChecker(),
  ]
}

// ---------------------------------------------------------------- models

export const QWEN_MODELS: ModelDefinition[] = [
  // ------------------------------------------------------------- Qwen 1

  {
    slug: 'qwen/text-to-image',
    family: 'qwen',
    capability: 'text-to-image',
    label: 'Qwen — Text to Image',
    docUrl: docUrl('qwen/text-to-image'),
    outputKind: 'image',
    params: [
      QWEN1_PROMPT,
      negativePrompt(500),
      qwen1ImageSize('square_hd'),
      outputFormat(['png', 'jpeg'], 'The generated image format.'),
      acceleration(
        "Higher is faster. 'regular' balances speed and quality; 'high' is recommended for images without text.",
      ),
      inferenceSteps(250, 30),
      guidanceScale(2.5),
      looseSeed(),
      enableSafetyChecker(),
      nsfwChecker(),
    ],
    notes:
      'The Qwen 1 generation is a diffusion passthrough: steps, CFG and acceleration are all exposed. ' +
      'image_size holds NAMED sizes here (square_hd, landscape_4_3), not ratios — Qwen 2 and Qwen 3 reuse ' +
      'the same key for ratios. Two independent safety switches: enable_safety_checker is the model\'s, ' +
      'nsfw_checker is Kie\'s.',
  },

  {
    slug: 'qwen/image-to-image',
    family: 'qwen',
    capability: 'image-to-image',
    label: 'Qwen — Image to Image',
    docUrl: docUrl('qwen/image-to-image'),
    outputKind: 'image',
    params: [
      {
        key: 'image_url',
        type: 'url',
        label: 'Reference image',
        describe: 'The image to work from. jpeg, png or webp, max 10.0 MB.',
        group: 'core',
        required: true,
        accept: ['image'],
      },
      QWEN1_PROMPT,
      negativePrompt(500),
      {
        key: 'strength',
        type: 'number',
        label: 'Strength',
        describe:
          'Denoising strength. 1.0 remakes the picture completely; 0.0 preserves the original. Only this endpoint has it.',
        group: 'advanced',
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.8,
      },
      outputFormat(['png', 'jpeg'], 'The generated image format.'),
      acceleration(
        "Higher is faster. 'regular' balances speed and quality; 'high' is recommended for images without text.",
      ),
      inferenceSteps(250, 30),
      guidanceScale(2.5),
      looseSeed(),
      enableSafetyChecker(),
      nsfwChecker(),
    ],
    notes:
      'Takes a SINGLE image_url, not the image_urls array Qwen 2.1 and Qwen 3 use. No image_size at all — ' +
      'the output follows the reference. `strength` exists on this endpoint only.',
  },

  {
    slug: 'qwen/image-edit',
    family: 'qwen',
    capability: 'image-to-image',
    label: 'Qwen — Image Edit',
    docUrl: docUrl('qwen/image-edit'),
    outputKind: 'image',
    params: [
      {
        key: 'image_url',
        type: 'url',
        label: 'Image to edit',
        describe: 'The image to edit. jpeg, png or webp, max 10.0 MB.',
        group: 'core',
        required: true,
        accept: ['image'],
      },
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe:
          'The edit to make. Up to 2000 characters — its two Qwen 1 siblings allow 5000.',
        group: 'core',
        required: true,
        maxLength: 2000,
      },
      negativePrompt(500),
      qwen1ImageSize('landscape_4_3'),
      outputFormat(['jpeg', 'png'], 'The generated image format.'),
      acceleration(
        "Higher is faster. The prose lists only 'none' and 'regular'; the schema enum also carries 'high'.",
      ),
      inferenceSteps(49, 25),
      guidanceScale(4),
      {
        key: 'num_images',
        type: 'enum',
        label: 'Number of images',
        describe:
          'How many images to return. QUOTED STRINGS, not numbers — the schema types this field as a string.',
        group: 'framing',
        enum: ['1', '2', '3', '4'],
      },
      {
        key: 'sync_mode',
        type: 'boolean',
        label: 'Sync mode',
        describe:
          'Upstream flag that waits for the image before responding. The studio polls either way, so this only makes the task slower.',
        group: 'advanced',
      },
      looseSeed(),
      enableSafetyChecker(),
      nsfwChecker(),
    ],
    notes:
      'The only Qwen endpoint with num_images and sync_mode. num_images is an enum of STRINGS. ' +
      'Its step ceiling is 49, not the 250 its siblings allow, and guidance defaults to 4 rather than 2.5. ' +
      'DOC CONFLICT (two on one page): num_inference_steps prose says "Default value: 30" while the schema ' +
      'says 25 — the schema is what the server reads, so 25 is recorded. acceleration prose says "Options: ' +
      "'none', 'regular'\" while the schema enum is none/regular/high — the enum is recorded. " +
      'Prompt ceiling is 2000 here and 5000 on both other Qwen 1 endpoints.',
  },

  // ------------------------------------------------------------- Qwen 2

  {
    slug: 'qwen2/text-to-image',
    family: 'qwen',
    capability: 'text-to-image',
    label: 'Qwen2 — Text to Image',
    docUrl: docUrl('qwen2/text-to-image'),
    outputKind: 'image',
    params: [
      qwen2Prompt(),
      qwen2ImageSize(['1:1', '3:4', '4:3', '9:16', '16:9']),
      outputFormat(['jpeg', 'png'], 'The generated image format.'),
      looseSeed(),
      nsfwChecker(),
    ],
    notes:
      'Four parameters plus the filter — every sampler knob from Qwen 1 is gone. ' +
      'DOC CONFLICT: the `model` block on this page reads `qwen2/image-edit`, copied from the sibling page. ' +
      'The summary ("Qwen2 - Text To Image"), the description ("Image generation by qwen2/text-to-image"), ' +
      'the request example and the callback example all say `qwen2/text-to-image`, so that is the slug. ' +
      'Only five ratios here; qwen2/image-edit offers eight.',
  },

  {
    slug: 'qwen2/image-edit',
    family: 'qwen',
    capability: 'image-to-image',
    label: 'Qwen2 — Image Edit',
    docUrl: docUrl('qwen2/image-edit'),
    outputKind: 'image',
    params: [
      {
        key: 'image_url',
        type: 'url',
        label: 'Image to edit',
        describe: 'The image to edit. jpeg, png or webp, max 10.0 MB.',
        group: 'core',
        required: true,
        accept: ['image'],
      },
      qwen2Prompt(),
      qwen2ImageSize(['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9']),
      outputFormat(['jpeg', 'png'], 'The generated image format.'),
      looseSeed(),
      nsfwChecker(),
    ],
    notes:
      'Eight ratios against its text-to-image sibling\'s five — 2:3, 3:2 and 21:9 exist only here. ' +
      'There is no qwen2/image-to-image endpoint; this is the generation\'s only image input.',
  },

  // ----------------------------------------------------------- Qwen 2.1

  {
    slug: 'qwen2-1/text-to-image',
    family: 'qwen',
    capability: 'text-to-image',
    label: 'Qwen 2.1 — Text to Image',
    docUrl: docUrl('qwen2-1/text-to-image'),
    outputKind: 'image',
    params: [
      qwen21Prompt('What to generate. Any language, up to 5000 characters — longer returns 422.'),
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe:
          'The output shape. Pixel size depends on the resolution tier as well. The generation on either side of this one calls the field `image_size`.',
        group: 'framing',
        enum: QWEN21_RATIOS,
        default: '1:1',
      },
      qwen21Resolution(
        '1K takes roughly 7–12 seconds; 2K is four times the pixels and roughly 30–55. Only these two tiers exist — 4K returns 422.',
      ),
      qwen21Background(),
      qwen21OutputFormat(),
      enhancePrompt(),
      looseSeed(),
      nsfwChecker(),
    ],
    constraints: TRANSPARENCY_CONSTRAINTS,
    notes:
      'The only Qwen generation with a transparent background, a WebP output and a 9:21 ratio. ' +
      'Names the shape `aspect_ratio`, unlike Qwen 1, 2 and 3, which all use `image_size`. ' +
      'The Playground page for this model documents aspect_ratio defaulting to 3:2 and nsfw_checker to ' +
      'true; the OpenAPI schema says 1:1 and false. The schema is what the server reads.',
  },

  {
    slug: 'qwen2-1/image-to-image',
    family: 'qwen',
    capability: 'image-to-image',
    label: 'Qwen 2.1 — Image to Image',
    docUrl: docUrl('qwen2-1/image-to-image'),
    outputKind: 'image',
    params: [
      {
        key: 'image_urls',
        type: 'url[]',
        label: 'Reference images',
        describe:
          '1 to 10 images, by URL. The array order is the order the prompt refers to ("the first image"). jpeg, png or webp, max 30 MB and 25 MP each. Detail per reference drops as you add more — stay within 4 when fidelity matters.',
        group: 'core',
        required: true,
        accept: ['image'],
        minItems: 1,
        maxItems: 10,
      },
      qwen21Prompt(
        'What you want back. With a mask, describe what belongs inside the white area. Any language, up to 5000 characters.',
      ),
      {
        key: 'mask_url',
        type: 'url',
        label: 'Inpainting mask',
        describe:
          'Switches the request into local-edit mode. Black and white, WHITE marks what changes, with a few pixels of feathering. Same aspect ratio as the reference image; a different size is scaled to it.',
        group: 'core',
        accept: ['image'],
      },
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe:
          '`auto` takes the first reference image\'s shape and snaps it to the nearest supported ratio.',
        group: 'framing',
        enum: ['auto', ...QWEN21_RATIOS],
        default: 'auto',
      },
      qwen21Resolution(
        '1K is the faster tier; 2K is four times the pixels and can take about 3 minutes with reference images. 4K returns 422.',
      ),
      qwen21Background(),
      qwen21OutputFormat(),
      enhancePrompt(),
      looseSeed(),
      nsfwChecker(),
    ],
    constraints: [
      ...TRANSPARENCY_CONSTRAINTS,
      {
        kind: 'maxWhen',
        keys: ['image_urls'],
        when: { key: 'mask_url', present: true },
        max: 1,
        message:
          'A mask applies to exactly one reference image — Kie returns 422 if the mask arrives with more than one.',
      },
      {
        kind: 'allowedValuesWhen',
        keys: ['background'],
        when: { key: 'mask_url', present: true },
        values: ['opaque'],
        message:
          'Local-edit mode cannot produce a transparent background — a mask with transparency returns 422.',
      },
      {
        kind: 'forbiddenWhen',
        keys: ['aspect_ratio', 'enhance_prompt'],
        when: { key: 'mask_url', present: true },
        message:
          'In local-edit mode the output keeps the reference image\'s shape, so these two are ignored — Kie accepts the job and reports them back in the result\'s `ignored` field.',
      },
    ],
    notes:
      'Takes up to 10 references, the most of any Qwen endpoint (Qwen 3 caps at 3). ' +
      'Supplying mask_url is a MODE SWITCH, not an extra option: it demands exactly one reference image, ' +
      'forbids a transparent background, and makes aspect_ratio and enhance_prompt no-ops that Kie lists ' +
      'in an `ignored` field rather than rejecting. All three are encoded as constraints so the form ' +
      'cannot build the request Kie would silently reinterpret.',
  },

  // ------------------------------------------------------------- Qwen 3

  {
    slug: 'qwen3/text-to-image',
    family: 'qwen',
    capability: 'text-to-image',
    label: 'Qwen3 — Text to Image',
    docUrl: docUrl('qwen3/text-to-image'),
    outputKind: 'image',
    params: qwen3Params('text'),
    notes:
      'Identical input schema to qwen3/pro-text-to-image — the tier is the slug and nothing else. ' +
      'resolution documents no default on the text-to-image pages while the image-to-image pages document ' +
      '1K; transcribed as documented rather than completed from the sibling. ' +
      'The only Qwen generation with a documented seed range (0–2147483647, default 1).',
  },

  {
    slug: 'qwen3/image-to-image',
    family: 'qwen',
    capability: 'image-to-image',
    label: 'Qwen3 — Image to Image',
    docUrl: docUrl('qwen3/image-to-image'),
    outputKind: 'image',
    params: qwen3Params('image'),
    notes:
      'Identical input schema to qwen3/pro-image-to-image. Caps image_urls at 3 where qwen2-1 allows 10, ' +
      'and accepts bmp, gif and tiff on top of jpeg/png/webp. No mask, no background, no WebP output.',
  },

  {
    slug: 'qwen3/pro-text-to-image',
    family: 'qwen',
    capability: 'text-to-image',
    label: 'Qwen3 Pro — Text to Image',
    docUrl: docUrl('qwen3-pro/text-to-image'),
    outputKind: 'image',
    params: qwen3Params('text'),
    notes:
      'SLUG TRAP: the doc page is `market/qwen3-pro/text-to-image` but the `model` enum reads ' +
      '`qwen3/pro-text-to-image`. The tier is a prefix on the CAPABILITY, not on the family — a ' +
      '`qwen3-pro/` slug is a 422. Input schema is byte-identical to qwen3/text-to-image.',
  },

  {
    slug: 'qwen3/pro-image-to-image',
    family: 'qwen',
    capability: 'image-to-image',
    label: 'Qwen3 Pro — Image to Image',
    docUrl: docUrl('qwen3-pro/image-to-image'),
    outputKind: 'image',
    params: qwen3Params('image'),
    notes:
      'SLUG TRAP: doc page `market/qwen3-pro/image-to-image`, slug `qwen3/pro-image-to-image`. ' +
      'Input schema is byte-identical to qwen3/image-to-image.',
  },
]
