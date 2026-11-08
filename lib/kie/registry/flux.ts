import { docUrl, type Constraint, type ModelDefinition, type ParamDef } from './types.ts'

/**
 * Flux — 2 image models (FLUX.2 Pro, FLUX.3 Klein).
 * Transcribed from .claude/skills/kie-models/references/flux.md.
 *
 * Family-wide traps encoded below:
 *  - The version sits in the PREFIX and the tier in the path:
 *    `flux-2/pro-text-to-image`, `flux-3/klein-text-to-image`. Not `flux/…`.
 *  - The two generations share almost nothing. FLUX.2 Pro marks aspect_ratio
 *    and resolution REQUIRED and stops at 2K with seven ratios; FLUX.3 Klein
 *    makes both optional, reaches 4K, adds `auto`, 21:9 and 9:21, and adds
 *    explicit width/height, a seed, a batch count and a prompt rewriter.
 *  - Klein's width/height OVERRIDE aspect_ratio and resolution — Kie ignores
 *    both once a pixel size is passed. Encoded as `forbiddenWhen`, because an
 *    ignored field is a silently wrong result, not a 422.
 */

// --------------------------------------------------------------- shared

/**
 * Kie's own content filter. Both pages describe it only as "A configurable
 * parameter. Defaults to true in the Playground." — a statement about the
 * Playground, not the API. The Qwen pages, which expose the shared schema,
 * document the API default as false. No default is recorded here, so nothing is
 * sent unless the user chooses.
 */
const nsfwChecker: ParamDef = {
  key: 'nsfw_checker',
  type: 'boolean',
  label: 'Kie content filter',
  describe:
    "Kie's own filter. The Playground turns it on; leave it unset to use the API's own default.",
  group: 'advanced',
}

// ------------------------------------------------------------ FLUX.3 Klein

const KLEIN_PIXEL_SIZE = ['width', 'height']

const KLEIN_CONSTRAINTS: Constraint[] = [
  {
    kind: 'requires',
    keys: ['width'],
    requires: 'height',
    message: 'Width and height must be passed together.',
  },
  {
    kind: 'requires',
    keys: ['height'],
    requires: 'width',
    message: 'Width and height must be passed together.',
  },
  ...KLEIN_PIXEL_SIZE.map(
    (key): Constraint => ({
      kind: 'forbiddenWhen',
      keys: ['aspect_ratio', 'resolution'],
      when: { key, present: true },
      message:
        'A pixel width and height override the aspect ratio and resolution — Kie ignores both once a size is set.',
    }),
  ),
]

// ---------------------------------------------------------------------- models

export const FLUX_MODELS: ModelDefinition[] = [
  {
    slug: 'flux-2/pro-text-to-image',
    family: 'flux',
    capability: 'text-to-image',
    label: 'FLUX.2 Pro — Text to Image',
    docUrl: docUrl('flux2/pro-text-to-image'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'What you want to see. 3-5000 characters.',
        group: 'core',
        required: true,
        minLength: 3,
        maxLength: 5000,
      },
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe: 'Aspect ratio for the generated image.',
        group: 'framing',
        required: true,
        enum: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3'],
        default: '1:1',
      },
      {
        key: 'resolution',
        type: 'enum',
        label: 'Resolution',
        describe: 'Output image resolution.',
        group: 'framing',
        required: true,
        enum: ['1K', '2K'],
        default: '1K',
      },
      nsfwChecker,
    ],
    notes:
      'aspect_ratio and resolution are both REQUIRED, with documented defaults, so a request always carries them. ' +
      "Seven ratios and no 4K. The field's description mentions an 'auto' option that matches the first input " +
      'image, but `auto` is NOT in the enum and this endpoint takes no image — it is not offered. ' +
      'docUrl page path is inferred: transcribed from the page text supplied by the user while docs.kie.ai was unreachable — run /verify-catalog.',
  },
  {
    slug: 'flux-3/klein-text-to-image',
    family: 'flux',
    capability: 'text-to-image',
    label: 'FLUX.3 Klein — Text to Image',
    docUrl: docUrl('flux3/klein-text-to-image'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Describe the image to generate, in any language.',
        group: 'core',
        required: true,
        maxLength: 5000,
      },
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe: 'Output aspect ratio. Ignored once width and height are set.',
        group: 'framing',
        enum: ['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9', '9:21', 'auto'],
        default: '1:1',
      },
      {
        key: 'resolution',
        type: 'enum',
        label: 'Resolution',
        describe: 'Higher resolutions cost more and take longer. Ignored once width and height are set.',
        group: 'framing',
        enum: ['1K', '2K', '4K'],
        default: '1K',
      },
      {
        key: 'width',
        type: 'number',
        label: 'Width (px)',
        describe:
          'Exact output width, 256-4096. Pass with height; the shape must stay between 1:2.5 and 2.5:1. Overrides aspect ratio and resolution.',
        group: 'framing',
        min: 256,
        max: 4096,
        step: 1,
      },
      {
        key: 'height',
        type: 'number',
        label: 'Height (px)',
        describe:
          'Exact output height, 256-4096. Pass with width; the shape must stay between 1:2.5 and 2.5:1. Overrides aspect ratio and resolution.',
        group: 'framing',
        min: 256,
        max: 4096,
        step: 1,
      },
      {
        key: 'output_format',
        type: 'enum',
        label: 'Output format',
        describe: 'Output image format.',
        group: 'advanced',
        enum: ['png', 'jpeg', 'webp'],
        default: 'png',
      },
      {
        key: 'num_images',
        type: 'number',
        label: 'Images',
        describe: 'Number of images to generate with the same settings.',
        group: 'core',
        min: 1,
        max: 4,
        step: 1,
        default: 1,
      },
      {
        key: 'seed',
        type: 'seed',
        label: 'Seed',
        describe:
          'Omit for a random result; the same seed and parameters reproduce it. With several images, image i uses seed + i.',
        group: 'advanced',
        min: 0,
        max: 2147483647,
      },
      {
        key: 'enhance_prompt',
        type: 'boolean',
        label: 'Enhance prompt',
        describe:
          'Rewrites the prompt into a fuller description first. Turn off when the prompt must be followed literally, or when latency matters.',
        group: 'advanced',
        default: true,
      },
      nsfwChecker,
    ],
    constraints: KLEIN_CONSTRAINTS,
    notes:
      'width and height go together and, once passed, make Kie IGNORE aspect_ratio and resolution — the form greys ' +
      'those out rather than letting a request ask for one shape and get another. The page shows width 256 / height ' +
      '640 and seed 1 as "default values"; they are its example, not API defaults (sending them would override the ' +
      'chosen ratio, and the seed doc says to omit it for a random result), so none is recorded. The 1:2.5-2.5:1 ' +
      'shape limit on width/height is not machine-checked. ' +
      'docUrl page path is inferred: transcribed from the page text supplied by the user while docs.kie.ai was unreachable — run /verify-catalog.',
  },
]
