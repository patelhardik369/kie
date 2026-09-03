import {
  docUrl,
  legacyDocUrl,
  type Constraint,
  type ModelDefinition,
  type ParamDef,
} from './types.ts'

/**
 * Google — 14 models (5 video, 8 image, 1 audio).
 * Transcribed from .claude/skills/kie-models/references/google.md.
 *
 * Family-wide traps encoded below:
 *  - Slug prefixes are inconsistent. Imagen 4, Nano Banana 1, Gemini Omni 1.1
 *    Flash and Gemini TTS carry `google/`; Nano Banana 2, 2 Lite, Pro and Gemini
 *    Omni Video carry NO prefix; Veo uses underscores (`veo3_fast`). Not typos.
 *  - `google/imagen4` and `-ultra` type `seed` as a STRING (maxLength 500);
 *    `google/imagen4-fast` types it as an INTEGER. Same family, same field.
 *  - Nano Banana 1 writes `jpeg`; Nano Banana 2 and Pro write `jpg`. Each
 *    rejects the other spelling.
 *  - Input images are `image_urls` on Nano Banana 1 and 2 Lite, but `image_input`
 *    on Nano Banana 2 and Pro.
 *  - Gemini Omni `duration` is a quoted STRING; Veo `duration` is an INTEGER.
 *  - Veo is the only model on a non-unified transport. See lib/kie/veo.ts.
 */

// ------------------------------------------------------------------ Imagen 4

const IMAGEN_ASPECT = ['1:1', '16:9', '9:16', '3:4', '4:3', 'auto']

const imagenPrompt: ParamDef = {
  key: 'prompt',
  type: 'text',
  label: 'Prompt',
  describe: 'What you want to see.',
  group: 'core',
  required: true,
  maxLength: 5000,
}

const imagenNegative: ParamDef = {
  key: 'negative_prompt',
  type: 'text',
  label: 'Negative prompt',
  describe: 'What to discourage in the generated image.',
  group: 'advanced',
  maxLength: 5000,
}

function imagenAspect(defaultValue: string): ParamDef {
  return {
    key: 'aspect_ratio',
    type: 'enum',
    label: 'Aspect ratio',
    describe: 'Shape of the generated image.',
    group: 'framing',
    enum: IMAGEN_ASPECT,
    default: defaultValue,
  }
}

/**
 * Imagen 4 and Ultra take a STRING seed, not a number.
 *
 * Typed `string` rather than `seed` on purpose: `seed` renders the randomize
 * dice and validates as a number, which is exactly the payload the API rejects
 * on these two models. `google/imagen4-fast` gets the real `seed` type below.
 */
const imagenSeedString: ParamDef = {
  key: 'seed',
  type: 'string',
  label: 'Seed',
  describe:
    'Random seed for reproducible generation. This model takes a STRING, not a number — its -fast sibling takes an integer.',
  group: 'advanced',
  maxLength: 500,
}

interface ImagenOptions {
  slug: string
  label: string
  page: string
  aspectDefault: string
  seed: ParamDef
  notes?: string
}

function imagen(options: ImagenOptions): ModelDefinition {
  return {
    slug: options.slug,
    family: 'google',
    capability: 'text-to-image',
    label: options.label,
    docUrl: docUrl(options.page),
    outputKind: 'image',
    params: [
      imagenPrompt,
      imagenNegative,
      imagenAspect(options.aspectDefault),
      options.seed,
    ],
    ...(options.notes ? { notes: options.notes } : {}),
  }
}

// --------------------------------------------------------- Nano Banana 1.x

/** Shared by `google/nano-banana` and `google/nano-banana-edit`. */
const NANO_BANANA_1_ASPECT = [
  '1:1',
  '9:16',
  '16:9',
  '3:4',
  '4:3',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '21:9',
  'auto',
]

const nb1Aspect: ParamDef = {
  key: 'aspect_ratio',
  type: 'enum',
  label: 'Aspect ratio',
  describe: 'Shape of the generated image.',
  group: 'framing',
  enum: NANO_BANANA_1_ASPECT,
  default: '1:1',
}

/**
 * The superseded sizing field, kept because the promise is every parameter.
 *
 * It takes the same values as `aspect_ratio` and the doc says outright that it
 * "has been replaced by aspect_ratio". Left out, someone re-running an old
 * payload would silently lose the field; left in unlabelled, someone would set
 * both and not know which wins.
 */
const nb1ImageSize: ParamDef = {
  key: 'image_size',
  type: 'enum',
  label: 'Image size',
  describe: 'Superseded by Aspect ratio — the docs say to use that instead.',
  group: 'advanced',
  enum: NANO_BANANA_1_ASPECT,
  default: '1:1',
  deprecated: true,
}

const nb1OutputFormat: ParamDef = {
  key: 'output_format',
  type: 'enum',
  label: 'Output format',
  // Spelled out because the Nano Banana 2 models take `jpg` and reject `jpeg`.
  describe: 'File format. Nano Banana 1 spells it "jpeg"; Nano Banana 2 spells it "jpg".',
  group: 'framing',
  enum: ['png', 'jpeg'],
  default: 'png',
}

// --------------------------------------------------------- Nano Banana 2.x

const NB2_RESOLUTION = ['1K', '2K', '4K']

function nb2Resolution(): ParamDef {
  return {
    key: 'resolution',
    type: 'enum',
    label: 'Resolution',
    describe: 'Pixel dimensions of the generated image.',
    group: 'framing',
    enum: NB2_RESOLUTION,
    default: '1K',
  }
}

function nb2OutputFormat(defaultValue: string): ParamDef {
  return {
    key: 'output_format',
    type: 'enum',
    label: 'Output format',
    describe: 'File format. Nano Banana 2 spells it "jpg", not "jpeg".',
    group: 'framing',
    enum: ['png', 'jpg'],
    default: defaultValue,
  }
}

// ------------------------------------------------------------- Gemini Omni

/**
 * The trimmed source clip. All three fields are required per the doc's own
 * nested `required` list, and the 10s ceiling is on the SPAN, not on `ends`.
 */
const omniVideoList: ParamDef = {
  key: 'video_list',
  type: 'object[]',
  label: 'Video clips',
  describe:
    'Source video plus the trim range to use. Max 1 item, and it spends 2 of the 7 image slots.',
  group: 'core',
  maxItems: 1,
  fields: [
    {
      key: 'url',
      type: 'url',
      label: 'Video URL',
      describe: 'Max 100MB and 30s per file.',
      group: 'core',
      required: true,
      accept: ['video'],
    },
    {
      key: 'start',
      type: 'number',
      label: 'Start',
      describe: 'Start time in seconds.',
      group: 'core',
      required: true,
      min: 0,
    },
    {
      key: 'ends',
      type: 'number',
      label: 'End',
      describe: 'End time in seconds. Must exceed Start, and the span cannot exceed 10s.',
      group: 'core',
      required: true,
      min: 0,
    },
  ],
}

const omniAudioIds: ParamDef = {
  key: 'audio_ids',
  type: 'string[]',
  label: 'Voice ids',
  describe:
    'Ids from the gemini-omni-audio endpoint, not URLs — paste them. Max 3.',
  group: 'audio',
  maxItems: 3,
}

const omniCharacterIds: ParamDef = {
  key: 'character_ids',
  type: 'string[]',
  label: 'Character ids',
  describe:
    'Ids from the gemini-omni-character endpoint, not URLs — paste them. Each spends 1 of the 7 image slots (2 for a portrait+body pair).',
  group: 'core',
}

const omniImageUrls: ParamDef = {
  key: 'image_urls',
  type: 'url[]',
  label: 'Reference images',
  describe:
    'References for characters, scenes, styles or storyboards. Max 7 images, 20MB each.',
  group: 'core',
  maxItems: 7,
  accept: ['image'],
}

const omniDuration: ParamDef = {
  key: 'duration',
  type: 'enum',
  label: 'Duration',
  describe:
    'Seconds. Quoted strings, not numbers. Ignored when a video clip is supplied — the model picks the length.',
  group: 'framing',
  required: true,
  enum: ['4', '6', '8', '10'],
}

const omniAspect: ParamDef = {
  key: 'aspect_ratio',
  type: 'enum',
  label: 'Aspect ratio',
  describe: '16:9 is landscape, 9:16 is portrait.',
  group: 'framing',
  enum: ['16:9', '9:16'],
}

const omniSeed: ParamDef = {
  key: 'seed',
  type: 'seed',
  label: 'Seed',
  describe: 'Fixing the seed improves reproducibility but does not guarantee it.',
  group: 'advanced',
  min: 0,
  max: 2147483647,
}

const omniPrompt: ParamDef = {
  key: 'prompt',
  type: 'text',
  label: 'Prompt',
  describe: 'Target content, style, camera language, or character actions.',
  group: 'core',
  required: true,
  maxLength: 20000,
}

function omniResolution(values: string[]): ParamDef {
  return {
    key: 'resolution',
    type: 'enum',
    label: 'Resolution',
    describe: 'Output resolution. Note the lowercase "4k".',
    group: 'framing',
    enum: values,
    default: '720p',
  }
}

// -------------------------------------------------------------------- Veo

const VEO_GENERATION_TYPES = [
  'TEXT_2_VIDEO',
  'FIRST_AND_LAST_FRAMES_2_VIDEO',
  'REFERENCE_2_VIDEO',
]

const veoPrompt: ParamDef = {
  key: 'prompt',
  type: 'text',
  label: 'Prompt',
  describe:
    'Required in every mode. For image-to-video, describe how the image should come alive.',
  group: 'core',
  required: true,
}

const veoImageUrls: ParamDef = {
  key: 'imageUrls',
  type: 'url[]',
  label: 'Images',
  describe:
    'camelCase, unlike every other field in the catalog. 1 image: the video unfolds around it. 2 images: first and last frame. Reference mode: 1–3 images.',
  group: 'core',
  maxItems: 3,
  accept: ['image'],
}

const veoAspect: ParamDef = {
  key: 'aspect_ratio',
  type: 'enum',
  label: 'Aspect ratio',
  describe:
    'Capital "Auto" here — every other model writes it lowercase. Auto centre-crops to whichever of 16:9 or 9:16 your image is closer to.',
  group: 'framing',
  enum: ['16:9', '9:16', 'Auto'],
  default: '16:9',
}

const veoResolution: ParamDef = {
  key: 'resolution',
  type: 'enum',
  label: 'Resolution',
  describe: 'Higher is slower and costs more.',
  group: 'framing',
  enum: ['720p', '1080p', '4k'],
  default: '720p',
}

function veoDuration(supportsReference: boolean): ParamDef {
  return {
    key: 'duration',
    type: 'enum',
    label: 'Duration',
    // The reference-mode caveat only belongs on the tiers that HAVE that mode.
    // On veo3 it named a generationType value its own enum does not offer.
    describe: supportsReference
      ? 'Seconds, as bare numbers. Reference-to-video supports only 8.'
      : 'Seconds, as bare numbers.',
    group: 'framing',
    enum: [4, 6, 8],
    default: 8,
  }
}

const veoWatermark: ParamDef = {
  key: 'watermark',
  type: 'string',
  label: 'Watermark',
  describe: 'Text to burn into the generated video.',
  group: 'advanced',
}

const veoTranslation: ParamDef = {
  key: 'enableTranslation',
  type: 'boolean',
  label: 'Translate prompt',
  describe:
    'Auto-translates the prompt to English before generating. camelCase, like imageUrls.',
  group: 'advanced',
  default: false,
}

const veoFallback: ParamDef = {
  key: 'enableFallback',
  type: 'boolean',
  label: 'Fallback model',
  describe:
    'Superseded — the docs say to remove it. Fell back to a backup model on content-policy and upload errors; forces 16:9 at 1080p, and those results cannot be fetched at 1080p afterwards.',
  group: 'advanced',
  default: false,
  deprecated: true,
}

interface VeoOptions {
  slug: string
  label: string
  /** REFERENCE_2_VIDEO is documented for the fast and lite tiers only. */
  supportsReference: boolean
  notes: string
}

function veo(options: VeoOptions): ModelDefinition {
  const generationType: ParamDef = {
    key: 'generationType',
    type: 'enum',
    label: 'Generation mode',
    describe: options.supportsReference
      ? 'Leave unset and Kie infers the mode from whether images are supplied.'
      : 'Leave unset and Kie infers the mode from whether images are supplied. Reference-to-video is not available on this tier.',
    group: 'core',
    enum: options.supportsReference
      ? VEO_GENERATION_TYPES
      : VEO_GENERATION_TYPES.slice(0, 2),
  }

  const constraints: Constraint[] = options.supportsReference
    ? [
        {
          kind: 'allowedValuesWhen',
          keys: ['duration'],
          when: { key: 'generationType', equals: 'REFERENCE_2_VIDEO' },
          values: [8],
          message: 'Reference-to-video renders 8-second clips only.',
        },
      ]
    : []

  return {
    slug: options.slug,
    family: 'google',
    capability: 'text-to-video',
    alsoSupports: options.supportsReference
      ? ['image-to-video', 'reference-to-video']
      : ['image-to-video'],
    label: options.label,
    docUrl: legacyDocUrl('veo3-api/generate-veo-3-video'),
    outputKind: 'video',
    // The whole reason lib/kie/veo.ts exists.
    transport: 'veo',
    params: [
      veoPrompt,
      veoImageUrls,
      generationType,
      veoAspect,
      veoResolution,
      veoDuration(options.supportsReference),
      veoWatermark,
      veoTranslation,
      veoFallback,
    ],
    ...(constraints.length > 0 ? { constraints } : {}),
    notes: options.notes,
  }
}

const VEO_SHARED_NOTES =
  'Non-unified transport: POSTs a FLAT body to /api/v1/veo/generate and polls /api/v1/veo/record-info, ' +
  'which reports successFlag (0 generating, 1 success, 2 and 3 failed) instead of a state string. ' +
  'DOC CONFLICT: enableTranslation is documented as "Default value is true" in prose and `default: false` ' +
  'in the schema; the schema is transcribed. The page`s example block shows a `seeds` field that does not ' +
  'exist in `properties` and is deliberately absent here. Kie reports no creditsConsumed on this transport. ' +
  'Companion endpoints /veo/get-1080p-video, /veo/get-4k-video and /veo/extend act on a finished task and ' +
  'are not wired up.'

// -------------------------------------------------------------- Gemini TTS

const TTS_VOICES = [
  'Achernar',
  'Achird',
  'Algenib',
  'Algieba',
  'Alnilam',
  'Aoede',
  'Autonoe',
  'Callirrhoe',
  'Charon',
  'Despina',
  'Enceladus',
  'Erinome',
  'Fenrir',
  'Gacrux',
  'Iapetus',
  'Kore',
  'Laomedeia',
  'Leda',
  'Orus',
  'Puck',
  'Pulcherrima',
  'Rasalgethi',
  'Sadachbia',
  'Sadaltager',
  'Schedar',
  'Sulafat',
  'Umbriel',
  'Vindemiatrix',
  'Zephyr',
  'Zubenelgenubi',
]

// ------------------------------------------------------------------ Models

export const GOOGLE_MODELS: ModelDefinition[] = [
  imagen({
    slug: 'google/imagen4',
    label: 'Imagen 4',
    page: 'google/imagen4',
    aspectDefault: '1:1',
    seed: imagenSeedString,
    notes:
      'seed is a STRING here (maxLength 500) but an INTEGER on google/imagen4-fast. Same family, same field name, different type.',
  }),
  imagen({
    slug: 'google/imagen4-fast',
    label: 'Imagen 4 Fast',
    page: 'google/imagen4-fast',
    // The only Imagen tier that does not open on 1:1.
    aspectDefault: '16:9',
    seed: {
      key: 'seed',
      type: 'seed',
      label: 'Seed',
      describe:
        'Random seed for reproducible generation. An integer here, unlike the string seed on Imagen 4 and Ultra.',
      group: 'advanced',
    },
    notes:
      'The only Imagen tier with an INTEGER seed and the only one defaulting to 16:9 rather than 1:1. No documented seed range.',
  }),
  imagen({
    slug: 'google/imagen4-ultra',
    label: 'Imagen 4 Ultra',
    page: 'google/imagen4-ultra',
    aspectDefault: '1:1',
    seed: imagenSeedString,
    notes: 'seed is a STRING here (maxLength 500), as on google/imagen4.',
  }),

  {
    slug: 'google/nano-banana',
    family: 'google',
    capability: 'text-to-image',
    label: 'Nano Banana',
    docUrl: docUrl('google/nano-banana'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'What you want to see.',
        group: 'core',
        required: true,
        maxLength: 5000,
      },
      nb1Aspect,
      nb1OutputFormat,
      nb1ImageSize,
      {
        key: 'nsfw_checker',
        type: 'boolean',
        label: 'Content filtering',
        describe:
          'When off, results are returned directly by the model with no filtering. The docs note filtering is not guaranteed either way.',
        group: 'advanced',
        default: false,
      },
    ],
    notes:
      'output_format is "jpeg" here and "jpg" on the Nano Banana 2 models. image_size is deprecated in favour of aspect_ratio but still accepted.',
  },

  {
    slug: 'google/nano-banana-edit',
    family: 'google',
    capability: 'image-to-image',
    label: 'Nano Banana Edit',
    docUrl: docUrl('google/nano-banana-edit'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'How to edit the supplied images.',
        group: 'core',
        required: true,
        maxLength: 5000,
      },
      {
        key: 'image_urls',
        type: 'url[]',
        label: 'Input images',
        describe: 'Up to 10 images to edit. Max 10.0MB each.',
        group: 'core',
        required: true,
        maxItems: 10,
        accept: ['image'],
      },
      nb1Aspect,
      nb1OutputFormat,
      nb1ImageSize,
    ],
    notes:
      'No nsfw_checker on the edit endpoint, unlike google/nano-banana. Input field is image_urls, not image_input.',
  },

  {
    slug: 'nano-banana-2',
    family: 'google',
    capability: 'text-to-image',
    alsoSupports: ['image-to-image'],
    label: 'Nano Banana 2',
    docUrl: docUrl('google/nanobanana2'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'What you want to see.',
        group: 'core',
        required: true,
        maxLength: 20000,
      },
      {
        key: 'image_input',
        type: 'url[]',
        label: 'Input images',
        describe:
          'Images to transform or reference. Up to 14, max 30.0MB each. Leave empty for pure text-to-image.',
        group: 'core',
        maxItems: 14,
        accept: ['image'],
      },
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe: 'Shape of the generated image.',
        group: 'framing',
        enum: [
          '1:1',
          '2:3',
          '3:2',
          '1:4',
          '4:1',
          '3:4',
          '4:3',
          '4:5',
          '5:4',
          '1:8',
          '8:1',
          '9:16',
          '16:9',
          '21:9',
          'auto',
        ],
        default: 'auto',
      },
      nb2Resolution(),
      nb2OutputFormat('jpg'),
    ],
    notes:
      'Slug carries NO google/ prefix even though the doc page is under market/google/. Input field is image_input (14 max), not image_urls. output_format spells it "jpg" and defaults to jpg.',
  },

  {
    slug: 'nano-banana-2-lite',
    family: 'google',
    capability: 'text-to-image',
    alsoSupports: ['image-to-image'],
    label: 'Nano Banana 2 Lite',
    docUrl: docUrl('google/nano-banana-2-lite'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'What you want to see.',
        group: 'core',
        required: true,
        maxLength: 20000,
      },
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe: 'Shape of the generated image. Required on this model.',
        group: 'framing',
        required: true,
        enum: [
          '1:1',
          '1:4',
          '1:8',
          '2:3',
          '3:2',
          '3:4',
          '4:1',
          '4:3',
          '4:5',
          '5:4',
          '8:1',
          '9:16',
          '16:9',
          '21:9',
          'auto',
        ],
        default: 'auto',
      },
      {
        key: 'image_urls',
        type: 'url[]',
        label: 'Input images',
        describe:
          'Optional references. Up to 10, max 30.0MB each. Leave empty for pure text-to-image.',
        group: 'core',
        maxItems: 10,
        default: [],
        accept: ['image'],
      },
    ],
    notes:
      'The only Nano Banana 2 variant that requires aspect_ratio, uses image_urls rather than image_input, and offers neither resolution nor output_format.',
  },

  {
    slug: 'nano-banana-pro',
    family: 'google',
    capability: 'image-to-image',
    alsoSupports: ['text-to-image'],
    label: 'Nano Banana Pro',
    docUrl: docUrl('google/pro-image-to-image'),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'What you want to see.',
        group: 'core',
        required: true,
        maxLength: 10000,
      },
      {
        key: 'image_input',
        type: 'url[]',
        label: 'Input images',
        describe:
          'Images to transform or reference. Up to 8, max 30.0MB each. Leave empty for pure text-to-image.',
        group: 'core',
        maxItems: 8,
        accept: ['image'],
      },
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe: 'Shape of the generated image.',
        group: 'framing',
        enum: [
          '1:1',
          '2:3',
          '3:2',
          '3:4',
          '4:3',
          '4:5',
          '5:4',
          '9:16',
          '16:9',
          '21:9',
          'auto',
        ],
        default: '1:1',
      },
      nb2Resolution(),
      nb2OutputFormat('png'),
    ],
    notes:
      'Slug is `nano-banana-pro`, not `google/pro-image-to-image` — the page path is not the slug. Prompt limit is 10000 (half of nano-banana-2) and image_input caps at 8 (not 14). output_format defaults to png, unlike nano-banana-2.',
  },

  {
    slug: 'gemini-omni-video',
    family: 'google',
    capability: 'text-to-video',
    alsoSupports: ['image-to-video', 'reference-to-video', 'video-to-video'],
    label: 'Gemini Omni Video',
    docUrl: docUrl('gemini-omni-video'),
    outputKind: 'video',
    params: [
      omniPrompt,
      omniImageUrls,
      omniVideoList,
      omniCharacterIds,
      omniAudioIds,
      omniDuration,
      omniAspect,
      omniResolution(['720p', '1080p', '4k']),
      omniSeed,
    ],
    notes:
      'Slug carries no google/ prefix and its doc page sits at the top of market/, not under market/google/. ' +
      'audio_ids and character_ids are ids minted by POST /api/v1/omni/audio/create and /omni/character/create — ' +
      'synchronous helper endpoints that are deliberately not models, so the fields take pasted ids. ' +
      'Image-slot budget: 7 total; a video_list entry spends 2, leaving room for at most 3 character_ids. ' +
      'duration is a quoted string and is ignored entirely when video_list is set.',
  },

  {
    slug: 'google/gemini-omni-flash-1-1',
    family: 'google',
    capability: 'text-to-video',
    alsoSupports: ['image-to-video', 'reference-to-video', 'video-to-video'],
    label: 'Gemini Omni 1.1 Flash',
    docUrl: docUrl('google/gemini-omni-flash-1-1'),
    outputKind: 'video',
    params: [
      omniPrompt,
      {
        key: 'first_frame_url',
        type: 'url',
        label: 'First frame',
        describe:
          'Starting frame. Cannot be combined with reference images, voices, characters, or video clips.',
        group: 'core',
        accept: ['image'],
      },
      {
        key: 'last_frame_url',
        type: 'url',
        label: 'Last frame',
        describe: 'Ending frame. Requires a first frame — it cannot be used alone.',
        group: 'core',
        accept: ['image'],
      },
      omniImageUrls,
      omniVideoList,
      omniCharacterIds,
      omniAudioIds,
      omniDuration,
      omniAspect,
      // The only Gemini Omni tier offering 360p.
      omniResolution(['360p', '720p', '1080p', '4k']),
      omniSeed,
    ],
    constraints: [
      {
        kind: 'mutuallyExclusiveGroups',
        groups: [
          ['first_frame_url', 'last_frame_url'],
          ['image_urls', 'audio_ids', 'video_list', 'character_ids'],
        ],
        message:
          'Gemini Omni takes one input mode per generation: first frame (optionally with a last frame), or the multimodal references — never both.',
      },
      {
        kind: 'requires',
        keys: ['last_frame_url'],
        requires: 'first_frame_url',
        message: 'A last frame needs a first frame.',
      },
    ],
    notes:
      'Everything gemini-omni-video has, plus first/last-frame inputs and a 360p tier. The doc states the ' +
      'first-frame exclusion in prose and repeats it as a machine-readable dependencies block for last_frame_url.',
  },

  {
    slug: 'google/gemini-3-1-flash-tts',
    family: 'google',
    capability: 'text-to-speech',
    label: 'Gemini 3.1 Flash TTS',
    docUrl: docUrl('google/gemini-3-1-flash-tts'),
    outputKind: 'audio',
    params: [
      {
        key: 'speakers',
        type: 'object[]',
        label: 'Speakers',
        describe: 'The voice cast. Every dialogue turn names one of these.',
        group: 'core',
        required: true,
        fields: [
          {
            key: 'speaker_id',
            type: 'string',
            label: 'Speaker id',
            describe: 'Must be in "Speaker N" format, e.g. "Speaker 1".',
            group: 'core',
            required: true,
          },
          {
            key: 'voice_name',
            type: 'enum',
            label: 'Voice',
            describe:
              'One of 30 preset voices. Capitalized here; the omni-audio endpoint spells the same names lowercase.',
            group: 'core',
            required: true,
            enum: TTS_VOICES,
          },
          {
            key: 'accent',
            type: 'enum',
            label: 'Accent',
            describe: 'Required alongside the voice.',
            group: 'core',
            required: true,
            enum: [
              'Neutral',
              'American (Gen)',
              'American (Valley)',
              'American (South)',
              'British (RP)',
              'British (Brixton)',
              'Transatlantic',
              'Australian',
            ],
          },
          {
            key: 'audio_profile',
            type: 'string',
            label: 'Audio profile',
            describe: 'Free text, e.g. "A warm and soothing narrator".',
            group: 'advanced',
          },
          {
            key: 'style',
            type: 'enum',
            label: 'Style',
            describe: 'Emotional style.',
            group: 'advanced',
            enum: [
              'Vocal Smile',
              'Newscaster',
              'Whisper',
              'Empathetic',
              'Promo/Hype',
              'Deadpan',
            ],
          },
          {
            key: 'pace',
            type: 'enum',
            label: 'Pace',
            describe: 'Delivery speed.',
            group: 'advanced',
            enum: ['Natural', 'Rapid Fire', 'The Drift', 'Staccato'],
          },
        ],
      },
      {
        key: 'dialogue_turns',
        type: 'object[]',
        label: 'Dialogue',
        describe: 'The script. Rendered in order.',
        group: 'core',
        required: true,
        fields: [
          {
            key: 'speaker_id',
            type: 'string',
            label: 'Speaker id',
            describe: 'Must match one of the speakers above.',
            group: 'core',
            required: true,
          },
          {
            key: 'text',
            type: 'text',
            label: 'Text',
            describe: 'What this speaker says. May contain tone tags.',
            group: 'core',
            required: true,
            maxLength: 10000,
          },
        ],
      },
      {
        key: 'scene',
        type: 'text',
        label: 'Scene',
        describe: 'e.g. "A quiet, warm room with a fireplace crackling softly."',
        group: 'advanced',
        default: '',
      },
      {
        key: 'sample_context',
        type: 'text',
        label: 'Sample context',
        describe: 'Overall tone, e.g. "Audiobook style narration. Gentle and inviting."',
        group: 'advanced',
        default: '',
      },
      {
        key: 'temperature',
        type: 'number',
        label: 'Temperature',
        describe: 'Sampling temperature.',
        group: 'advanced',
        min: 0,
        max: 2,
        step: 0.1,
        default: 1,
      },
    ],
    notes:
      'The only model in the catalog with NO prompt field — the text lives in dialogue_turns. Filed under ' +
      'Music Models in the docs but it is speech, not music. Voice names are Capitalized here and lowercase ' +
      'on the gemini-omni-audio endpoint; the two lists are not interchangeable.',
  },

  veo({
    slug: 'veo3',
    label: 'Veo 3.1 Quality',
    supportsReference: false,
    notes: `The Quality tier. Reference-to-video is documented for veo3_fast and veo3_lite only, so generationType offers two values here rather than three. ${VEO_SHARED_NOTES}`,
  }),
  veo({
    slug: 'veo3_fast',
    label: 'Veo 3.1 Fast',
    supportsReference: true,
    notes: `Supports reference-to-video, which renders 8-second clips only. ${VEO_SHARED_NOTES}`,
  }),
  veo({
    slug: 'veo3_lite',
    label: 'Veo 3.1 Lite',
    supportsReference: true,
    notes: `The cheapest Veo tier — use it for smoke tests. Supports reference-to-video, which renders 8-second clips only. ${VEO_SHARED_NOTES}`,
  }),
]
