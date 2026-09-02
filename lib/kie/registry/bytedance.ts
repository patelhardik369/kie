import { docUrl, type Constraint, type ModelDefinition, type ParamDef } from './types.ts'

/**
 * ByteDance — 20 models (10 Seedance video, 10 Seedream image).
 * Transcribed from .claude/skills/kie-models/references/bytedance.md.
 *
 * Family-wide traps encoded below:
 *  - Slug prefixes are inconsistent: `bytedance/` for video and the two oldest
 *    image models, bare `seedream/` from 4.5 onward. Version punctuation varies
 *    too (`seedance-1.5-pro` vs `seedance-2-5` vs `4.5-edit`). Not typos.
 *  - Seedance 2.x `duration` is an INTEGER; Seedance V1 `duration` is a STRING.
 *  - Seedream has two sizing vocabularies that must never be mixed:
 *    3.0/4.0 use image_size + image_resolution; 4.5/5.x use aspect_ratio + quality.
 */

// -------------------------------------------------------------- Seedance 2.x

const SEEDANCE_ASPECT = ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9', 'adaptive']

const nsfwChecker: ParamDef = {
  key: 'nsfw_checker',
  type: 'boolean',
  label: 'Content filtering',
  describe: 'When off, results are returned directly by the model without filtering.',
  group: 'advanced',
  default: false,
}

const firstFrame: ParamDef = {
  key: 'first_frame_url',
  type: 'url',
  label: 'First frame',
  describe: 'Image URL or asset://{assetId}. Cannot be combined with reference assets.',
  group: 'core',
  accept: ['image'],
}

const lastFrame: ParamDef = {
  key: 'last_frame_url',
  type: 'url',
  label: 'Last frame',
  describe: 'Requires a first frame. Cannot be combined with reference assets.',
  group: 'core',
  accept: ['image'],
}

const webSearch: ParamDef = {
  key: 'web_search',
  type: 'boolean',
  label: 'Web search',
  describe: 'Let the model search online. Text-to-video only.',
  group: 'advanced',
}

/**
 * The exclusion every Seedance 2.x model enforces, quoted from the docs:
 * "Image-to-Video (First Frame), Image-to-Video (First & Last Frames), and
 * Multimodal Reference-to-Video are three mutually exclusive scenarios."
 */
const SEEDANCE_CONSTRAINTS: Constraint[] = [
  {
    kind: 'mutuallyExclusiveGroups',
    groups: [
      ['first_frame_url', 'last_frame_url'],
      ['reference_image_urls', 'reference_video_urls', 'reference_audio_urls'],
    ],
    message:
      'Seedance supports one input mode per generation: first frame (optionally with a last frame), or multimodal references — never both.',
  },
  {
    kind: 'requires',
    keys: ['last_frame_url'],
    requires: 'first_frame_url',
    message: 'A last frame needs a first frame.',
  },
]

interface Seedance2Options {
  slug: string
  label: string
  page: string
  promptMax: number
  resolutions: string[]
  aspectDefault: string
  refImages: number
  refVideos: number
  refAudios: number
  durationMin: number
  durationMax: number
  durationDescribe: string
  includeReturnLastFrame: boolean
  extraParams?: ParamDef[]
  notes?: string
}

function seedance2(options: Seedance2Options): ModelDefinition {
  return {
    slug: options.slug,
    family: 'bytedance',
    capability: 'text-to-video',
    alsoSupports: ['image-to-video', 'reference-to-video'],
    label: options.label,
    docUrl: docUrl(options.page),
    outputKind: 'video',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Text description of the video to generate.',
        group: 'core',
        required: true,
        minLength: 3,
        maxLength: options.promptMax,
      },
      firstFrame,
      lastFrame,
      {
        key: 'reference_image_urls',
        type: 'url[]',
        label: 'Reference images',
        describe:
          'jpeg/png/webp/bmp/tiff/gif, aspect 0.4-2.5, 300-6000px, under 30MB each.',
        group: 'core',
        maxItems: options.refImages,
        accept: ['image'],
      },
      {
        key: 'reference_video_urls',
        type: 'url[]',
        label: 'Reference videos',
        describe: 'mp4/mov, 480p-720p, aspect 0.4-2.5, 24-60fps.',
        group: 'core',
        maxItems: options.refVideos,
        accept: ['video'],
      },
      {
        key: 'reference_audio_urls',
        type: 'url[]',
        label: 'Reference audio',
        describe: 'wav/mp3, under 15MB each.',
        group: 'audio',
        maxItems: options.refAudios,
        accept: ['audio'],
      },
      ...(options.includeReturnLastFrame
        ? [
            {
              key: 'return_last_frame',
              type: 'boolean' as const,
              label: 'Return last frame',
              describe: 'Also return the final frame as an image. Deprecated.',
              group: 'advanced' as const,
              default: false,
            },
          ]
        : []),
      {
        key: 'generate_audio',
        type: 'boolean',
        label: 'Generate audio',
        describe: 'Adds an audio track. Increases generation cost.',
        group: 'audio',
        default: true,
      },
      {
        key: 'resolution',
        type: 'enum',
        label: 'Resolution',
        describe: 'Output resolution tier.',
        group: 'framing',
        enum: options.resolutions,
        default: '720p',
      },
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe: 'Frame shape. adaptive follows the input media.',
        group: 'framing',
        enum: SEEDANCE_ASPECT,
        default: options.aspectDefault,
      },
      {
        key: 'duration',
        type: 'number',
        label: 'Duration',
        describe: options.durationDescribe,
        group: 'framing',
        min: options.durationMin,
        max: options.durationMax,
        step: 1,
        default: 5,
      },
      ...(options.extraParams ?? []),
      webSearch,
      nsfwChecker,
    ],
    constraints: SEEDANCE_CONSTRAINTS,
    notes: options.notes,
  }
}

// ------------------------------------------------------------ Seedance V1

const v1Prompt: ParamDef = {
  key: 'prompt',
  type: 'text',
  label: 'Prompt',
  describe: 'Text description of the video to generate.',
  group: 'core',
  required: true,
  maxLength: 10000,
}

const v1Duration: ParamDef = {
  key: 'duration',
  type: 'enum',
  label: 'Duration',
  describe: 'Seconds. Sent as a string on the V1 line, unlike Seedance 2.x.',
  group: 'framing',
  enum: ['5', '10'],
  default: '5',
}

const v1CameraFixed: ParamDef = {
  key: 'camera_fixed',
  type: 'boolean',
  label: 'Fix camera',
  describe: 'Lock the camera position.',
  group: 'motion',
}

const v1Seed: ParamDef = {
  key: 'seed',
  type: 'seed',
  label: 'Seed',
  describe: 'Use -1 for a random seed.',
  group: 'advanced',
  min: -1,
  max: 2147483647,
  step: 1,
  default: -1,
}

const v1SafetyChecker: ParamDef = {
  key: 'enable_safety_checker',
  type: 'boolean',
  label: 'Safety checker',
  describe: 'Always on in the Playground; can only be disabled through the API.',
  group: 'advanced',
}

const v1ImageUrl: ParamDef = {
  key: 'image_url',
  type: 'url',
  label: 'Source image',
  describe: 'jpeg/png/webp, up to 10MB.',
  group: 'core',
  required: true,
  accept: ['image'],
}

const v1Resolution = (values: string[]): ParamDef => ({
  key: 'resolution',
  type: 'enum',
  label: 'Resolution',
  describe: 'Output resolution tier.',
  group: 'framing',
  enum: values,
  default: '720p',
})

// -------------------------------------------------------------- Seedream

const SEEDREAM_ASPECT = ['1:1', '4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '21:9']

const IMAGE_SIZE_V4 = [
  'square',
  'square_hd',
  'portrait_4_3',
  'portrait_3_2',
  'portrait_16_9',
  'landscape_4_3',
  'landscape_3_2',
  'landscape_16_9',
  'landscape_21_9',
]

const seedreamAspect: ParamDef = {
  key: 'aspect_ratio',
  type: 'enum',
  label: 'Aspect ratio',
  describe: 'Width-to-height ratio of the generated image.',
  group: 'framing',
  required: true,
  enum: SEEDREAM_ASPECT,
  default: '1:1',
}

const outputFormat = (fallback: string): ParamDef => ({
  key: 'output_format',
  type: 'enum',
  label: 'Output format',
  describe: 'File format of the generated image.',
  group: 'advanced',
  enum: ['png', 'jpeg'],
  default: fallback,
})

const seedreamSeed: ParamDef = {
  key: 'seed',
  type: 'seed',
  label: 'Seed',
  describe: 'Controls the randomness of generation.',
  group: 'advanced',
}

const editImageUrls = (maxItems: number): ParamDef => ({
  key: 'image_urls',
  type: 'url[]',
  label: 'Input images',
  describe: 'jpeg/png/webp, up to 30MB each.',
  group: 'core',
  required: true,
  minItems: 1,
  maxItems,
  accept: ['image'],
})

function seedreamQuality(values: string[], describe: string): ParamDef {
  return {
    key: 'quality',
    type: 'enum',
    label: 'Quality',
    describe,
    group: 'framing',
    required: true,
    enum: values,
    default: 'basic',
  }
}

// ---------------------------------------------------------------- models

export const BYTEDANCE_MODELS: ModelDefinition[] = [
  seedance2({
    slug: 'bytedance/seedance-2',
    label: 'Seedance 2.0',
    page: 'bytedance/seedance-2',
    promptMax: 20000,
    resolutions: ['480p', '720p', '1080p', '4k'],
    aspectDefault: '16:9',
    refImages: 9,
    refVideos: 3,
    refAudios: 3,
    durationMin: 4,
    durationMax: 15,
    durationDescribe: 'Seconds, 4 to 15. An integer on the 2.x line.',
    includeReturnLastFrame: true,
  }),
  seedance2({
    slug: 'bytedance/seedance-2-fast',
    label: 'Seedance 2.0 Fast',
    page: 'bytedance/seedance-2-fast',
    promptMax: 20000,
    resolutions: ['480p', '720p'],
    aspectDefault: '16:9',
    refImages: 9,
    refVideos: 3,
    refAudios: 3,
    durationMin: 4,
    durationMax: 15,
    durationDescribe: 'Seconds, 4 to 15.',
    includeReturnLastFrame: true,
    notes: 'Same features as Seedance 2.0 but capped at 720p.',
  }),
  seedance2({
    slug: 'bytedance/seedance-2-mini',
    label: 'Seedance 2.0 Mini',
    page: 'bytedance/seedance-2-mini',
    promptMax: 20000,
    resolutions: ['480p', '720p'],
    aspectDefault: '16:9',
    refImages: 9,
    refVideos: 3,
    refAudios: 3,
    durationMin: 4,
    durationMax: 15,
    durationDescribe: 'Seconds, 4 to 15.',
    includeReturnLastFrame: false,
    notes: 'Cheapest 2.0 tier. The doc does not list return_last_frame on this model.',
  }),
  seedance2({
    slug: 'bytedance/seedance-2-5',
    label: 'Seedance 2.5',
    page: 'bytedance/seedance-2-5',
    promptMax: 30000,
    resolutions: ['480p', '720p', '1080p'],
    aspectDefault: 'adaptive',
    refImages: 30,
    refVideos: 10,
    refAudios: 10,
    durationMin: 4,
    durationMax: 30,
    durationDescribe: 'Seconds, 4 to 30. Pass -1 to let the model choose.',
    includeReturnLastFrame: true,
    extraParams: [
      {
        key: 'output_format',
        type: 'enum',
        label: 'Output format',
        describe: 'Container for the generated video.',
        group: 'advanced',
        enum: ['mp4', 'mov'],
        default: 'mp4',
      },
    ],
    notes:
      'The long-form tier: 30s output, 30k prompts, 30 reference images, and the only Seedance with output_format. No 4k.',
  }),
  {
    slug: 'bytedance/seedance-1.5-pro',
    family: 'bytedance',
    capability: 'text-to-video',
    alsoSupports: ['image-to-video'],
    label: 'Seedance 1.5 Pro',
    docUrl: docUrl('bytedance/seedance-1-5-pro'),
    outputKind: 'video',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Text description of the video to generate.',
        group: 'core',
        required: true,
        minLength: 3,
        maxLength: 20000,
      },
      {
        key: 'input_urls',
        type: 'url[]',
        label: 'Input images',
        describe:
          'Zero, one (first frame) or two (first and last). jpeg/png/webp, 10MB each.',
        group: 'core',
        maxItems: 2,
        accept: ['image'],
      },
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe: 'Frame shape. No adaptive option on this model.',
        group: 'framing',
        required: true,
        enum: ['1:1', '4:3', '3:4', '16:9', '9:16', '21:9'],
        default: '1:1',
      },
      v1Resolution(['480p', '720p', '1080p']),
      {
        key: 'duration',
        type: 'number',
        label: 'Duration',
        describe: 'Seconds, 4 to 12.',
        group: 'framing',
        required: true,
        min: 4,
        max: 12,
        step: 1,
      },
      {
        key: 'fixed_lens',
        type: 'boolean',
        label: 'Fixed lens',
        describe: 'Lock the camera for a stable, static shot.',
        group: 'motion',
        default: false,
      },
      {
        key: 'generate_audio',
        type: 'boolean',
        label: 'Generate audio',
        describe: 'Increases generation cost.',
        group: 'audio',
        default: false,
      },
      nsfwChecker,
    ],
    notes:
      'A different schema from the 2.x line: images arrive as one input_urls array rather than named frames, and duration has no documented default.',
  },
  {
    slug: 'bytedance/v1-pro-text-to-video',
    family: 'bytedance',
    capability: 'text-to-video',
    label: 'Seedance V1 Pro — Text to Video',
    docUrl: docUrl('bytedance/v1-pro-text-to-video'),
    outputKind: 'video',
    params: [
      v1Prompt,
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe: 'Frame shape of the generated video.',
        group: 'framing',
        enum: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
        default: '16:9',
      },
      v1Resolution(['480p', '720p', '1080p']),
      v1Duration,
      v1CameraFixed,
      v1Seed,
      v1SafetyChecker,
      nsfwChecker,
    ],
  },
  {
    slug: 'bytedance/v1-pro-image-to-video',
    family: 'bytedance',
    capability: 'image-to-video',
    label: 'Seedance V1 Pro — Image to Video',
    docUrl: docUrl('bytedance/v1-pro-image-to-video'),
    outputKind: 'video',
    params: [
      v1Prompt,
      v1ImageUrl,
      v1Resolution(['480p', '720p', '1080p']),
      v1Duration,
      v1CameraFixed,
      v1Seed,
      v1SafetyChecker,
      nsfwChecker,
    ],
  },
  {
    slug: 'bytedance/v1-pro-fast-image-to-video',
    family: 'bytedance',
    capability: 'image-to-video',
    label: 'Seedance V1 Pro Fast — Image to Video',
    docUrl: docUrl('bytedance/v1-pro-fast-image-to-video'),
    outputKind: 'video',
    params: [
      v1Prompt,
      v1ImageUrl,
      v1Resolution(['720p', '1080p']),
      v1Duration,
      nsfwChecker,
    ],
    notes:
      'No seed, camera_fixed or enable_safety_checker. The enum omits 480p even though the field description mentions it.',
  },
  {
    slug: 'bytedance/v1-lite-text-to-video',
    family: 'bytedance',
    capability: 'text-to-video',
    label: 'Seedance V1 Lite — Text to Video',
    docUrl: docUrl('bytedance/v1-lite-text-to-video'),
    outputKind: 'video',
    params: [
      v1Prompt,
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe: 'Frame shape. Lite drops 21:9 and adds 9:21.',
        group: 'framing',
        enum: ['16:9', '4:3', '1:1', '3:4', '9:16', '9:21'],
        default: '16:9',
      },
      v1Resolution(['480p', '720p', '1080p']),
      v1Duration,
      v1CameraFixed,
      {
        key: 'seed',
        type: 'seed',
        label: 'Seed',
        describe: 'Use -1 for a random seed.',
        group: 'advanced',
      },
      v1SafetyChecker,
      nsfwChecker,
    ],
  },
  {
    slug: 'bytedance/v1-lite-image-to-video',
    family: 'bytedance',
    capability: 'image-to-video',
    label: 'Seedance V1 Lite — Image to Video',
    docUrl: docUrl('bytedance/v1-lite-image-to-video'),
    outputKind: 'video',
    params: [
      v1Prompt,
      v1ImageUrl,
      {
        key: 'end_image_url',
        type: 'url',
        label: 'End frame',
        describe: 'Optional final frame. jpeg/png/webp, up to 10MB.',
        group: 'core',
        accept: ['image'],
      },
      v1Resolution(['480p', '720p', '1080p']),
      v1Duration,
      v1CameraFixed,
      v1Seed,
      v1SafetyChecker,
      nsfwChecker,
    ],
    notes: 'The only V1 model with an end frame.',
  },

  // ------------------------------------------------------------- Seedream
  {
    slug: 'bytedance/seedream',
    family: 'bytedance',
    capability: 'text-to-image',
    label: 'Seedream 3.0 — Text to Image',
    docUrl: docUrl('seedream/seedream'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Text description of the image to generate.',
        group: 'core',
        required: true,
        maxLength: 5000,
      },
      {
        key: 'image_size',
        type: 'enum',
        label: 'Image size',
        describe: 'Named size preset.',
        group: 'framing',
        enum: [
          'square',
          'square_hd',
          'portrait_4_3',
          'portrait_16_9',
          'landscape_4_3',
          'landscape_16_9',
        ],
        default: 'square_hd',
      },
      {
        key: 'guidance_scale',
        type: 'number',
        label: 'Guidance scale',
        describe: 'Higher values follow the prompt more closely.',
        group: 'advanced',
        min: 1,
        max: 10,
        step: 0.1,
        default: 2.5,
      },
      seedreamSeed,
    ],
    notes: 'The only Seedream tier with guidance_scale, and a narrower image_size set than 4.0.',
  },
  {
    slug: 'bytedance/seedream-v4-text-to-image',
    family: 'bytedance',
    capability: 'text-to-image',
    label: 'Seedream 4.0 — Text to Image',
    docUrl: docUrl('seedream/seedream-v4-text-to-image'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Text description of the image to generate.',
        group: 'core',
        required: true,
        maxLength: 5000,
      },
      {
        key: 'image_size',
        type: 'enum',
        label: 'Image size',
        describe: 'Named size preset. Combines with resolution to set final pixels.',
        group: 'framing',
        enum: IMAGE_SIZE_V4,
        default: 'square_hd',
      },
      {
        key: 'image_resolution',
        type: 'enum',
        label: 'Resolution',
        describe: 'Scale tier applied on top of the size preset.',
        group: 'framing',
        enum: ['1K', '2K', '4K'],
        default: '1K',
      },
      {
        key: 'max_images',
        type: 'number',
        label: 'Images',
        describe: 'How many images one run may produce.',
        group: 'core',
        min: 1,
        max: 6,
        step: 1,
        default: 1,
      },
      seedreamSeed,
      nsfwChecker,
    ],
    notes: 'The only Seedream tier with a built-in batch (max_images).',
  },
  {
    slug: 'bytedance/seedream-v4-edit',
    family: 'bytedance',
    capability: 'image-to-image',
    label: 'Seedream 4.0 — Edit',
    docUrl: docUrl('seedream/seedream-v4-edit'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'How to edit the input images.',
        group: 'core',
        required: true,
        maxLength: 5000,
      },
      editImageUrls(10),
      {
        key: 'image_size',
        type: 'enum',
        label: 'Image size',
        describe: 'Named size preset.',
        group: 'framing',
        enum: IMAGE_SIZE_V4,
        default: 'square_hd',
      },
      {
        key: 'image_resolution',
        type: 'enum',
        label: 'Resolution',
        describe: 'Scale tier applied on top of the size preset.',
        group: 'framing',
        enum: ['1K', '2K', '4K'],
        default: '1K',
      },
      {
        key: 'max_images',
        type: 'number',
        label: 'Images',
        describe: 'How many images one run may produce.',
        group: 'core',
        min: 1,
        max: 6,
        step: 1,
        default: 1,
      },
      seedreamSeed,
      nsfwChecker,
    ],
  },
  {
    slug: 'seedream/4.5-text-to-image',
    family: 'bytedance',
    capability: 'text-to-image',
    label: 'Seedream 4.5 — Text to Image',
    docUrl: docUrl('seedream/4-5-text-to-image'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Text description of the image to generate.',
        group: 'core',
        required: true,
        maxLength: 3000,
      },
      seedreamAspect,
      seedreamQuality(['basic', 'high'], 'basic outputs 2K, high outputs 4K.'),
      nsfwChecker,
    ],
    notes: 'Neither 4.5 model exposes seed or output_format.',
  },
  {
    slug: 'seedream/4.5-edit',
    family: 'bytedance',
    capability: 'image-to-image',
    label: 'Seedream 4.5 — Edit',
    docUrl: docUrl('seedream/4-5-edit'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'How to edit the input images.',
        group: 'core',
        required: true,
        maxLength: 3000,
      },
      editImageUrls(14),
      seedreamAspect,
      seedreamQuality(['basic', 'high'], 'basic outputs 2K, high outputs 4K.'),
      nsfwChecker,
    ],
  },
  {
    slug: 'seedream/5-lite-text-to-image',
    family: 'bytedance',
    capability: 'text-to-image',
    label: 'Seedream 5.0 Lite — Text to Image',
    docUrl: docUrl('seedream/5-lite-text-to-image'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Text description of the image to generate.',
        group: 'core',
        required: true,
        minLength: 3,
        maxLength: 3000,
      },
      seedreamAspect,
      seedreamQuality(
        ['basic', 'high', 'ultra'],
        'basic outputs 2K, high outputs 3K, ultra outputs 4K.',
      ),
      outputFormat('png'),
      nsfwChecker,
    ],
  },
  {
    slug: 'seedream/5-lite-image-to-image',
    family: 'bytedance',
    capability: 'image-to-image',
    label: 'Seedream 5.0 Lite — Image to Image',
    docUrl: docUrl('seedream-5-lite-image-to-image'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'How to edit the input images.',
        group: 'core',
        required: true,
        minLength: 3,
        maxLength: 3000,
      },
      editImageUrls(14),
      seedreamAspect,
      seedreamQuality(
        ['basic', 'high', 'ultra'],
        'basic outputs 2K, high outputs 3K, ultra outputs 4K.',
      ),
      outputFormat('png'),
      nsfwChecker,
    ],
    notes:
      'Doc page sits at market/seedream-5-lite-image-to-image.md — outside the seedream/ directory, unlike every sibling.',
  },
  {
    slug: 'seedream/5-pro-text-to-image',
    family: 'bytedance',
    capability: 'text-to-image',
    label: 'Seedream 5.0 Pro — Text to Image',
    docUrl: docUrl('seedream/5-pro-text-to-image'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Text description of the image to generate.',
        group: 'core',
        required: true,
        minLength: 3,
        maxLength: 5000,
      },
      seedreamAspect,
      seedreamQuality(
        ['basic', 'high'],
        'basic outputs 1K, high outputs 2K — lower than the Lite tier, which is not a mistake.',
      ),
      outputFormat('png'),
      nsfwChecker,
    ],
    notes:
      "Pro's quality tiers resolve LOWER than Lite's: Pro high is 2K where Lite high is 3K and Lite ultra is 4K.",
  },
  {
    slug: 'seedream/5-pro-image-to-image',
    family: 'bytedance',
    capability: 'image-to-image',
    label: 'Seedream 5.0 Pro — Image to Image',
    docUrl: docUrl('seedream/5-pro-image-to-image'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'How to edit the input images.',
        group: 'core',
        required: true,
        minLength: 3,
        maxLength: 5000,
      },
      editImageUrls(10),
      seedreamAspect,
      seedreamQuality(['basic', 'high'], 'basic outputs 1K, high outputs 2K.'),
      outputFormat('png'),
      nsfwChecker,
    ],
    notes: 'Accepts 10 input images where the Lite tier accepts 14.',
  },
  {
    slug: 'seedream/5-pro-layer-decomposition',
    family: 'bytedance',
    capability: 'layer-decomposition',
    label: 'Seedream 5.0 Pro — Layer Decomposition',
    docUrl: docUrl('seedream/5-pro-layer-decomposition'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe:
          'Optional. Names which elements to separate; auto-detects when omitted. Supports <bbox>x1 y1 x2 y2</bbox> with normalized 0-1000 coordinates.',
        group: 'core',
        minLength: 0,
        maxLength: 5000,
      },
      {
        key: 'image_url',
        type: 'url',
        label: 'Source image',
        describe:
          'png/jpeg/webp/bmp/tiff/gif — not heic/heif. Up to 30MB, 262144-36000000 pixels, aspect 1:16 to 16:1.',
        group: 'core',
        required: true,
        accept: ['image'],
      },
      {
        key: 'size',
        type: 'enum',
        label: 'Size',
        describe: 'Output resolution. auto picks based on the input.',
        group: 'framing',
        enum: ['auto', '1K', '1.5K', '2K'],
        default: 'auto',
      },
      outputFormat('jpeg'),
    ],
    notes:
      'Returns resultObject.layers_data[] alongside resultUrls. The downloader must persist z_index, name and bounding_box per layer — resultUrls alone loses the ordering and labels. Separated layers always output PNG regardless of output_format.',
  },
]
