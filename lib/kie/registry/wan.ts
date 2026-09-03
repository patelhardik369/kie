import { docUrl, type ModelDefinition, type ParamDef } from './types.ts'

/**
 * Wan — 20 models (18 video, 2 image).
 * Transcribed from .claude/skills/kie-models/references/wan.md.
 *
 * Three parameter dialects live in this family. Never carry a field name across
 * generations:
 *   2.2 A14B  aspect_ratio | frame-count timing   | enable_prompt_expansion
 *   2.5       aspect_ratio | duration as STRING   | enable_prompt_expansion
 *   2.6       no aspect    | duration as STRING   | (none)
 *   2.7       `ratio` on t2v, aspect_ratio else   | duration INTEGER | prompt_extend
 *   3.0       aspect_ratio | duration INTEGER     | (none)
 *
 * `resolution` casing also flips: 2.x uses lowercase `720p`, 3.0 uses `720P`.
 */

const nsfwChecker: ParamDef = {
  key: 'nsfw_checker',
  type: 'boolean',
  label: 'Content filtering',
  describe: 'When off, results are returned directly by the model without filtering.',
  group: 'advanced',
  default: false,
}

const seed = (fallback?: number): ParamDef => ({
  key: 'seed',
  type: 'seed',
  label: 'Seed',
  describe: 'Random seed for reproducibility.',
  group: 'advanced',
  min: 0,
  max: 2147483647,
  step: 1,
  ...(fallback === undefined ? {} : { default: fallback }),
})

const negativePrompt: ParamDef = {
  key: 'negative_prompt',
  type: 'text',
  label: 'Negative prompt',
  describe: 'Content that should not appear in the video.',
  group: 'advanced',
  maxLength: 500,
}

const resolution = (values: string[], fallback: string): ParamDef => ({
  key: 'resolution',
  type: 'enum',
  label: 'Resolution',
  describe: 'Output resolution tier.',
  group: 'framing',
  enum: values,
  default: fallback,
})

const enablePromptExpansion: ParamDef = {
  key: 'enable_prompt_expansion',
  type: 'boolean',
  label: 'Expand prompt',
  describe: 'Use an LLM to expand the prompt while keeping its meaning.',
  group: 'advanced',
}

const acceleration: ParamDef = {
  key: 'acceleration',
  type: 'enum',
  label: 'Acceleration',
  describe: 'More acceleration is faster but lower quality. none is recommended.',
  group: 'advanced',
  enum: ['none', 'regular'],
  default: 'none',
}

const multiShots: ParamDef = {
  key: 'multi_shots',
  type: 'boolean',
  label: 'Multi-shot',
  describe: 'One continuous shot, or several shots with transitions.',
  group: 'motion',
  default: false,
}

const promptExtend: ParamDef = {
  key: 'prompt_extend',
  type: 'boolean',
  label: 'Extend prompt',
  describe: 'Rewrite and expand the prompt. Usually helps short prompts; adds processing time.',
  group: 'advanced',
  default: true,
}

const watermark: ParamDef = {
  key: 'watermark',
  type: 'boolean',
  label: 'Watermark',
  describe: 'Stamps "AI generated" in the lower-right corner.',
  group: 'advanced',
  default: false,
}

const WAN_27_ASPECT = ['16:9', '9:16', '1:1', '4:3', '3:4']

const durationString = (values: string[], fallback: string): ParamDef => ({
  key: 'duration',
  type: 'enum',
  label: 'Duration',
  describe: 'Seconds. Sent as a string on this generation.',
  group: 'framing',
  enum: values,
  default: fallback,
})

/** Wan 3.0 shares one schema between the standard and prime tiers. */
function wan30(slug: string, label: string, page: string, withNsfw: boolean): ModelDefinition {
  return {
    slug,
    family: 'wan',
    capability: 'reference-to-video',
    alsoSupports: ['text-to-video', 'image-to-video', 'video-to-video'],
    label,
    docUrl: docUrl(page),
    outputKind: 'video',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe:
          'Chinese and English supported. Beyond 20,000 characters it is truncated automatically. In reference mode, address inputs as Image1 / Video1 / Audio1.',
        group: 'core',
        required: true,
        maxLength: 20000,
      },
      {
        key: 'first_frame_url',
        type: 'url',
        label: 'First frame',
        describe:
          'jpeg/jpg/png/bmp/webp, 240-8000px per side, aspect up to 8:1, under 20MB. Cannot combine with reference assets.',
        group: 'core',
        accept: ['image'],
      },
      {
        key: 'last_frame_url',
        type: 'url',
        label: 'Last frame',
        describe: 'Same limits as the first frame. Cannot combine with reference assets.',
        group: 'core',
        accept: ['image'],
      },
      {
        key: 'reference_image_urls',
        type: 'url[]',
        label: 'Reference images',
        describe: 'All-purpose reference mode.',
        group: 'core',
        maxItems: 10,
        accept: ['image'],
      },
      {
        key: 'reference_video_urls',
        type: 'url[]',
        label: 'Reference videos',
        describe: 'mp4/mov, 1-15s each, 15s combined, 240-4096px, under 100MB each.',
        group: 'core',
        maxItems: 5,
        accept: ['video'],
      },
      {
        key: 'reference_audio_urls',
        type: 'url[]',
        label: 'Reference audio',
        describe: 'wav/mp3, 1-15s each, 15s combined, under 15MB.',
        group: 'audio',
        maxItems: 5,
        accept: ['audio'],
      },
      {
        key: 'reference_file_urls',
        type: 'url[]',
        label: 'Reference document',
        describe:
          'docx/doc/xlsx/xls/pptx/ppt/pdf/txt/key/pages/numbers/md, under 100MB, up to 50 pages.',
        group: 'core',
        maxItems: 1,
        accept: ['file'],
      },
      {
        key: 'reference_link_urls',
        type: 'url[]',
        label: 'Reference link',
        describe: 'One publicly accessible webpage that does not require login.',
        group: 'core',
        maxItems: 1,
      },
      {
        key: 'resolution',
        type: 'enum',
        label: 'Resolution',
        describe: 'Output resolution. Note the uppercase P, unlike every Wan 2.x model.',
        group: 'framing',
        enum: ['480P', '720P', '1080P'],
        default: '1080P',
      },
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe: 'adaptive picks a ratio from the input media and intent.',
        group: 'framing',
        enum: ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'],
        default: 'adaptive',
      },
      {
        key: 'duration',
        type: 'number',
        label: 'Duration',
        describe:
          'Seconds, 2 to 30. Pass -1 to let the model decide. Input video duration plus this must total 30s or less.',
        group: 'framing',
        min: -1,
        max: 30,
        step: 1,
        default: 5,
      },
      {
        key: 'audio',
        type: 'boolean',
        label: 'Audio',
        describe: 'Include an audio track.',
        group: 'audio',
        default: true,
      },
      seed(),
      ...(withNsfw ? [nsfwChecker] : []),
    ],
    constraints: [
      {
        kind: 'mutuallyExclusiveGroups',
        groups: [
          ['first_frame_url', 'last_frame_url'],
          [
            'reference_image_urls',
            'reference_video_urls',
            'reference_audio_urls',
            'reference_file_urls',
            'reference_link_urls',
          ],
        ],
        message:
          'Frame images and reference assets cannot be combined. Use first/last frames, or references — not both.',
      },
      {
        kind: 'mutuallyExclusive',
        keys: ['reference_file_urls', 'reference_link_urls'],
        message: 'A reference document and a reference link cannot be used together.',
      },
      {
        kind: 'requires',
        keys: ['last_frame_url'],
        requires: 'first_frame_url',
        message: 'A last frame needs a first frame.',
      },
    ],
  }
}

/** Wan 2.7 Image and Image Pro share one schema; the slug picks the tier. */
function wan27Image(slug: string, label: string, page: string): ModelDefinition {
  return {
    slug,
    family: 'wan',
    capability: 'text-to-image',
    alsoSupports: ['image-to-image'],
    label,
    docUrl: docUrl(page),
    outputKind: 'image',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Generation or editing prompt. Chinese and English supported.',
        group: 'core',
        required: true,
        maxLength: 5000,
      },
      {
        key: 'input_urls',
        type: 'url[]',
        label: 'Input images',
        describe: 'Supplying images switches the model into edit mode.',
        group: 'core',
        maxItems: 9,
        accept: ['image'],
      },
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe:
          'Applies only when no input image is supplied — in edit mode the output follows the input image.',
        group: 'framing',
        enum: ['1:1', '16:9', '4:3', '21:9', '3:4', '9:16', '8:1', '1:8'],
      },
      {
        key: 'enable_sequential',
        type: 'boolean',
        label: 'Sequential mode',
        describe: 'Generate a related group of images rather than independent ones.',
        group: 'core',
        default: false,
      },
      {
        key: 'n',
        type: 'number',
        label: 'Images',
        describe:
          'How many images to generate. 1-4 normally (Kie defaults to 4), ' +
          '1-12 in sequential mode (Kie defaults to 12).',
        group: 'core',
        min: 1,
        max: 12,
        step: 1,
        default: 4,
      },
      {
        key: 'resolution',
        type: 'enum',
        label: 'Resolution',
        describe:
          '4K is available only for text-to-image in standard mode — adding an input image or turning on sequential mode caps it at 2K.',
        group: 'framing',
        enum: ['1K', '2K', '4K'],
        default: '2K',
      },
      {
        key: 'thinking_mode',
        type: 'boolean',
        label: 'Thinking mode',
        describe: 'Unavailable with sequential mode or input images.',
        group: 'advanced',
        default: false,
      },
      {
        key: 'color_palette',
        type: 'color[]',
        label: 'Color palette',
        describe:
          'Custom color theme, each colour paired with the share of the image it ' +
          'should occupy. Between 3 and 10 colours; 8 is recommended. ' +
          'Unavailable in sequential mode.',
        group: 'advanced',
        minItems: 3,
        maxItems: 10,
      },
      {
        key: 'bbox_list',
        type: 'bbox[][]',
        label: 'Edit regions',
        // One entry per input image, in the same order. `maxItems` is the
        // per-image ceiling here, not the length of the outer list.
        drawsOn: 'input_urls',
        describe:
          'Regions to edit, drawn on each input image. Up to 2 per image, in the ' +
          "source image's own pixels as [x1, y1, x2, y2].",
        group: 'advanced',
        maxItems: 2,
      },
      watermark,
      seed(0),
      nsfwChecker,
    ],
    constraints: [
      {
        kind: 'forbiddenWhen',
        keys: ['thinking_mode', 'color_palette'],
        when: { key: 'enable_sequential', equals: true },
        message: 'Thinking mode and the colour palette are unavailable in sequential mode.',
      },
      {
        // The second half of the thinking-mode rule: the doc says it is only
        // available when input_urls is EMPTY, which no `equals` test can express.
        kind: 'forbiddenWhen',
        keys: ['thinking_mode'],
        when: { key: 'input_urls', present: true },
        message: 'Thinking mode is text-to-image only — it is unavailable once an input image is supplied.',
      },
      {
        kind: 'maxWhen',
        keys: ['n'],
        when: { key: 'enable_sequential', equals: false },
        max: 4,
        message: 'Outside sequential mode this model generates at most 4 images.',
      },
      {
        /*
         * "4K is available only for text-to-image in standard mode" — the same
         * two-part shape as the thinking_mode rule above, and until now it lived
         * only in the field's `describe`, where nothing could enforce it.
         *
         * CONFIRMED AGAINST THE LIVE API: 4K with input_urls set is refused at
         * createTask with `{"code":500,"msg":"resolution is not within the range
         * of allowed options"}` — a submit-time failure, so the run never even
         * reaches the poller.
         */
        kind: 'allowedValuesWhen',
        keys: ['resolution'],
        when: { key: 'input_urls', present: true },
        values: ['1K', '2K'],
        message:
          'Editing an image caps the output at 2K — 4K is text-to-image only. Remove the input images to reach 4K.',
      },
      {
        kind: 'allowedValuesWhen',
        keys: ['resolution'],
        when: { key: 'enable_sequential', equals: true },
        values: ['1K', '2K'],
        message: 'Sequential mode caps the output at 2K.',
      },
      {
        /*
         * The doc is explicit that this field is read only in text-to-image:
         * "(Optional) Output aspect ratio when no image input is provided."
         *
         * Disabled rather than left alone, because being silently ignored is the
         * worse failure: it does not error, so you get a landscape edit back
         * having asked for 9:16 and nothing anywhere says why.
         */
        kind: 'forbiddenWhen',
        keys: ['aspect_ratio'],
        when: { key: 'input_urls', present: true },
        message:
          'In edit mode the output takes its shape from the input image, so the aspect ratio is ignored.',
      },
      {
        // The outer list is per input image, so regions without images have
        // nothing to attach to and Kie would reject the length mismatch.
        kind: 'requires',
        keys: ['bbox_list'],
        requires: 'input_urls',
        message: 'Edit regions are drawn on input images — add at least one image first.',
      },
    ],
    notes:
      'Widest aspect-ratio set of any in-scope model. color_palette items are ' +
      '{ hex, ratio } objects, not bare hex strings, and bbox_list is one list of ' +
      'boxes PER input image — both are transcribed wrong easily and fail as a 422. ' +
      'RESOLUTION CEILING: 4K is text-to-image, standard-mode only. The input_urls half ' +
      'is confirmed against the live API (createTask returns code 500, "resolution is not ' +
      'within the range of allowed options"); the sequential half comes from this ' +
      "project's reference table and is not restated in the doc's current revision, which " +
      'dropped the wording from the resolution field entirely. aspect_ratio is likewise ' +
      'read only in text-to-image — in edit mode Kie ignores it rather than rejecting it.',
  }
}

export const WAN_MODELS: ModelDefinition[] = [
  {
    slug: 'wan/2-2-a14b-text-to-video-turbo',
    family: 'wan',
    capability: 'text-to-video',
    label: 'Wan 2.2 A14B Turbo — Text to Video',
    docUrl: docUrl('wan/2-2-a14b-text-to-video-turbo'),
    outputKind: 'video',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Guides video generation.',
        group: 'core',
        required: true,
        maxLength: 5000,
      },
      resolution(['480p', '720p'], '720p'),
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe: 'Only landscape and portrait on this tier.',
        group: 'framing',
        enum: ['16:9', '9:16'],
        default: '16:9',
      },
      enablePromptExpansion,
      seed(0),
      acceleration,
      nsfwChecker,
    ],
  },
  {
    slug: 'wan/2-2-a14b-image-to-video-turbo',
    family: 'wan',
    capability: 'image-to-video',
    label: 'Wan 2.2 A14B Turbo — Image to Video',
    docUrl: docUrl('wan/2-2-a14b-image-to-video-turbo'),
    outputKind: 'video',
    params: [
      {
        key: 'image_url',
        type: 'url',
        label: 'Source image',
        describe:
          'jpeg/png/webp up to 10MB. Resized and center-cropped if it does not match the aspect ratio.',
        group: 'core',
        required: true,
        accept: ['image'],
      },
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Guides video generation.',
        group: 'core',
        required: true,
        maxLength: 5000,
      },
      resolution(['480p', '720p'], '720p'),
      enablePromptExpansion,
      seed(0),
      acceleration,
      nsfwChecker,
    ],
  },
  {
    slug: 'wan/2-2-a14b-speech-to-video-turbo',
    family: 'wan',
    capability: 'speech-to-video',
    label: 'Wan 2.2 A14B Turbo — Speech to Video',
    docUrl: docUrl('wan/2-2-a14b-speech-to-video-turbo'),
    outputKind: 'video',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Guides video generation.',
        group: 'core',
        required: true,
        maxLength: 5000,
      },
      {
        key: 'image_url',
        type: 'url',
        label: 'Source image',
        describe: 'jpeg/png/webp, up to 10MB.',
        group: 'core',
        required: true,
        accept: ['image'],
      },
      {
        key: 'audio_url',
        type: 'url',
        label: 'Speech audio',
        describe: 'mp3/wav/ogg/m4a/flac/aac/wma/mpeg, up to 10MB.',
        group: 'core',
        required: true,
        accept: ['audio'],
      },
      {
        key: 'num_frames',
        type: 'number',
        label: 'Frames',
        describe: 'Must be a multiple of 4. Output length is frames divided by fps.',
        group: 'framing',
        min: 40,
        max: 120,
        step: 4,
        default: 80,
      },
      {
        key: 'frames_per_second',
        type: 'number',
        label: 'Frames per second',
        describe: 'Final fps may shift with interpolation.',
        group: 'framing',
        min: 4,
        max: 60,
        step: 1,
        default: 16,
      },
      resolution(['480p', '580p', '720p'], '480p'),
      negativePrompt,
      seed(),
      {
        key: 'num_inference_steps',
        type: 'number',
        label: 'Inference steps',
        describe: 'Higher gives better quality but takes longer.',
        group: 'advanced',
        min: 2,
        max: 40,
        step: 1,
        default: 27,
      },
      {
        key: 'guidance_scale',
        type: 'number',
        label: 'Guidance scale',
        describe: 'Higher follows the prompt more closely but may cost quality.',
        group: 'advanced',
        min: 1,
        max: 10,
        step: 0.1,
        default: 3.5,
      },
      {
        key: 'shift',
        type: 'number',
        label: 'Shift',
        describe: 'Shift value for the video.',
        group: 'advanced',
        min: 1,
        max: 10,
        step: 0.1,
        default: 5,
      },
      nsfwChecker,
    ],
    notes:
      'The only in-scope model exposing raw diffusion controls. Output length is num_frames / frames_per_second — the form should show the derived seconds live, since neither field is in seconds.',
  },
  {
    slug: 'wan/2-2-animate-move',
    family: 'wan',
    capability: 'video-to-video',
    label: 'Wan Animate — Move',
    docUrl: docUrl('wan/2-2-animate-move'),
    outputKind: 'video',
    params: [
      {
        key: 'video_url',
        type: 'url',
        label: 'Driving video',
        describe: 'mp4/quicktime/x-matroska, up to 10MB.',
        group: 'core',
        required: true,
        accept: ['video'],
      },
      {
        key: 'image_url',
        type: 'url',
        label: 'Character image',
        describe: 'jpeg/png/webp up to 10MB. Resized and center-cropped.',
        group: 'core',
        required: true,
        accept: ['image'],
      },
      resolution(['480p', '580p', '720p'], '480p'),
      nsfwChecker,
    ],
    notes:
      'Transfers the video motion onto the image character. No prompt. The 10MB source-video ceiling is low — expect to compress clips.',
  },
  {
    slug: 'wan/2-2-animate-replace',
    family: 'wan',
    capability: 'video-to-video',
    label: 'Wan Animate — Replace',
    docUrl: docUrl('wan/2-2-animate-replace'),
    outputKind: 'video',
    params: [
      {
        key: 'video_url',
        type: 'url',
        label: 'Source video',
        describe: 'mp4/quicktime/x-matroska, up to 10MB.',
        group: 'core',
        required: true,
        accept: ['video'],
      },
      {
        key: 'image_url',
        type: 'url',
        label: 'Replacement character',
        describe: 'jpeg/png/webp up to 10MB. Resized and center-cropped.',
        group: 'core',
        required: true,
        accept: ['image'],
      },
      resolution(['480p', '580p', '720p'], '480p'),
      nsfwChecker,
    ],
    notes:
      'Swaps the character in the video for the one in the image. Identical schema to animate-move.',
  },
  {
    slug: 'wan/2-5-text-to-video',
    family: 'wan',
    capability: 'text-to-video',
    label: 'Wan 2.5 — Text to Video',
    docUrl: docUrl('wan/2-5-text-to-video'),
    outputKind: 'video',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Chinese and English supported. Shortest prompt limit in the family.',
        group: 'core',
        required: true,
        maxLength: 800,
      },
      {
        key: 'duration',
        type: 'enum',
        label: 'Duration',
        describe: 'Seconds. Required, with no documented default.',
        group: 'framing',
        required: true,
        enum: ['5', '10'],
      },
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe: 'Landscape, portrait or square. No documented default.',
        group: 'framing',
        enum: ['16:9', '9:16', '1:1'],
      },
      {
        key: 'resolution',
        type: 'enum',
        label: 'Resolution',
        describe: 'Output resolution tier. No documented default.',
        group: 'framing',
        enum: ['720p', '1080p'],
      },
      negativePrompt,
      enablePromptExpansion,
      seed(),
      nsfwChecker,
    ],
    notes:
      'The doc states no defaults for duration, aspect_ratio or resolution, so none are invented here.',
  },
  {
    slug: 'wan/2-5-image-to-video',
    family: 'wan',
    capability: 'image-to-video',
    label: 'Wan 2.5 — Image to Video',
    docUrl: docUrl('wan/2-5-image-to-video'),
    outputKind: 'video',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Describes the desired motion.',
        group: 'core',
        required: true,
        maxLength: 800,
      },
      {
        key: 'image_url',
        type: 'url',
        label: 'First frame',
        describe: 'jpeg/png/webp up to 10MB. Must be publicly accessible.',
        group: 'core',
        required: true,
        accept: ['image'],
      },
      {
        key: 'duration',
        type: 'enum',
        label: 'Duration',
        describe: 'Seconds. Required, with no documented default.',
        group: 'framing',
        required: true,
        enum: ['5', '10'],
      },
      {
        key: 'resolution',
        type: 'enum',
        label: 'Resolution',
        describe: 'Output resolution tier. No documented default.',
        group: 'framing',
        enum: ['720p', '1080p'],
      },
      negativePrompt,
      enablePromptExpansion,
      seed(),
      nsfwChecker,
    ],
  },
  {
    slug: 'wan/2-6-text-to-video',
    family: 'wan',
    capability: 'text-to-video',
    label: 'Wan 2.6 — Text to Video',
    docUrl: docUrl('wan/2-6-text-to-video'),
    outputKind: 'video',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Chinese and English supported.',
        group: 'core',
        required: true,
        minLength: 1,
        maxLength: 5000,
      },
      durationString(['5', '10', '15'], '5'),
      resolution(['720p', '1080p'], '1080p'),
      multiShots,
      nsfwChecker,
    ],
    notes: 'No aspect-ratio control anywhere in the 2.6 generation — framing follows the input.',
  },
  {
    slug: 'wan/2-6-image-to-video',
    family: 'wan',
    capability: 'image-to-video',
    label: 'Wan 2.6 — Image to Video',
    docUrl: docUrl('wan/2-6-image-to-video'),
    outputKind: 'video',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Chinese and English supported.',
        group: 'core',
        required: true,
        minLength: 2,
        maxLength: 5000,
      },
      {
        key: 'image_urls',
        type: 'url[]',
        label: 'Source image',
        describe: 'jpeg/png/webp up to 10MB, at least 256x256px.',
        group: 'core',
        required: true,
        minItems: 1,
        maxItems: 1,
        accept: ['image'],
      },
      durationString(['5', '10', '15'], '5'),
      resolution(['720p', '1080p'], '1080p'),
      multiShots,
      nsfwChecker,
    ],
  },
  {
    slug: 'wan/2-6-video-to-video',
    family: 'wan',
    capability: 'video-to-video',
    label: 'Wan 2.6 — Video to Video',
    docUrl: docUrl('wan/2-6-video-to-video'),
    outputKind: 'video',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Chinese and English supported.',
        group: 'core',
        required: true,
        minLength: 2,
        maxLength: 5000,
      },
      {
        key: 'video_urls',
        type: 'url[]',
        label: 'Source videos',
        describe: 'mp4/quicktime/x-matroska, up to 10MB.',
        group: 'core',
        required: true,
        minItems: 1,
        maxItems: 3,
        accept: ['video'],
      },
      durationString(['5', '10'], '5'),
      resolution(['720p', '1080p'], '1080p'),
      multiShots,
      nsfwChecker,
    ],
    notes: 'No 15s option on video-to-video, unlike the other 2.6 models.',
  },
  {
    slug: 'wan/2-6-flash-image-to-video',
    family: 'wan',
    capability: 'image-to-video',
    label: 'Wan 2.6 Flash — Image to Video',
    docUrl: docUrl('wan/2-6-flash-image-to-video'),
    outputKind: 'video',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Flash caps prompts far lower than standard 2.6.',
        group: 'core',
        required: true,
        maxLength: 1500,
      },
      {
        key: 'image_urls',
        type: 'url[]',
        label: 'Source image',
        describe: 'At least 256x256px.',
        group: 'core',
        required: true,
        minItems: 1,
        maxItems: 1,
        accept: ['image'],
      },
      durationString(['5', '10', '15'], '5'),
      resolution(['720p', '1080p'], '1080p'),
      {
        key: 'audio',
        type: 'boolean',
        label: 'Audio',
        describe: 'Required on this model. Audio directly affects cost.',
        group: 'audio',
        required: true,
      },
      multiShots,
      nsfwChecker,
    ],
  },
  {
    slug: 'wan/2-6-flash-video-to-video',
    family: 'wan',
    capability: 'video-to-video',
    label: 'Wan 2.6 Flash — Video to Video',
    docUrl: docUrl('wan/2-6-flash-video-to-video'),
    outputKind: 'video',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Chinese and English supported.',
        group: 'core',
        required: true,
        maxLength: 1500,
      },
      {
        key: 'video_urls',
        type: 'url[]',
        label: 'Source videos',
        describe: 'mp4/quicktime/x-matroska, up to 10MB.',
        group: 'core',
        required: true,
        minItems: 1,
        maxItems: 3,
        accept: ['video'],
      },
      durationString(['5', '10'], '5'),
      resolution(['720p', '1080p'], '1080p'),
      {
        key: 'audio',
        type: 'boolean',
        label: 'Audio',
        describe: 'Optional here, unlike flash image-to-video. Affects pricing.',
        group: 'audio',
      },
      multiShots,
      nsfwChecker,
    ],
  },
  {
    slug: 'wan/2-7-text-to-video',
    family: 'wan',
    capability: 'text-to-video',
    label: 'Wan 2.7 — Text to Video',
    docUrl: docUrl('wan/2-7-text-to-video'),
    outputKind: 'video',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Positive prompt for video generation.',
        group: 'core',
        required: true,
        minLength: 1,
        maxLength: 5000,
      },
      {
        key: 'negative_prompt',
        type: 'text',
        label: 'Negative prompt',
        describe: 'Content to keep out of the video.',
        group: 'advanced',
        minLength: 0,
        maxLength: 500,
      },
      {
        key: 'audio_url',
        type: 'url',
        label: 'Custom audio',
        describe: 'Supply your own audio track.',
        group: 'audio',
        accept: ['audio'],
      },
      resolution(['720p', '1080p'], '1080p'),
      {
        key: 'ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe:
          'The field is named `ratio` on this model, not `aspect_ratio` — unique across the family.',
        group: 'framing',
        enum: WAN_27_ASPECT,
        default: '16:9',
      },
      {
        key: 'duration',
        type: 'number',
        label: 'Duration',
        describe: 'Seconds, 2 to 15. An integer on the 2.7 generation.',
        group: 'framing',
        min: 2,
        max: 15,
        step: 1,
        default: 5,
      },
      promptExtend,
      watermark,
      seed(),
      nsfwChecker,
    ],
    notes: 'Uses `ratio` where every sibling uses `aspect_ratio`. Do not normalize it.',
  },
  {
    slug: 'wan/2-7-image-to-video',
    family: 'wan',
    capability: 'image-to-video',
    alsoSupports: ['video-to-video'],
    label: 'Wan 2.7 — Image to Video',
    docUrl: docUrl('wan/2-7-image-to-video'),
    outputKind: 'video',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Positive prompt for video generation.',
        group: 'core',
        required: true,
        maxLength: 5000,
      },
      negativePrompt,
      {
        key: 'first_frame_url',
        type: 'url',
        label: 'First frame',
        describe: 'Start the video from this image.',
        group: 'core',
        accept: ['image'],
      },
      {
        key: 'last_frame_url',
        type: 'url',
        label: 'Last frame',
        describe: 'End the video on this image. Requires a first frame.',
        group: 'core',
        accept: ['image'],
      },
      {
        key: 'first_clip_url',
        type: 'url',
        label: 'Clip to continue',
        describe: 'Video-continuation mode. Cannot be combined with frame images.',
        group: 'core',
        accept: ['video'],
      },
      {
        key: 'driving_audio_url',
        type: 'url',
        label: 'Driving audio',
        describe: 'Audio-guided motion.',
        group: 'audio',
        accept: ['audio'],
      },
      resolution(['720p', '1080p'], '1080p'),
      {
        key: 'duration',
        type: 'number',
        label: 'Duration',
        describe: 'Seconds, 2 to 15.',
        group: 'framing',
        min: 2,
        max: 15,
        step: 1,
        default: 5,
      },
      promptExtend,
      watermark,
      seed(),
      nsfwChecker,
    ],
    constraints: [
      {
        kind: 'mutuallyExclusiveGroups',
        groups: [['first_frame_url', 'last_frame_url'], ['first_clip_url']],
        message:
          'Choose one mode: frame images (first, optionally with last), or a clip to continue.',
      },
      {
        kind: 'requires',
        keys: ['last_frame_url'],
        requires: 'first_frame_url',
        message: 'A last frame needs a first frame.',
      },
      {
        kind: 'requiresOneOf',
        keys: ['first_frame_url', 'first_clip_url'],
        message: 'Provide a first frame or a clip to continue.',
      },
    ],
  },
  {
    slug: 'wan/2-7-videoedit',
    family: 'wan',
    capability: 'video-to-video',
    label: 'Wan 2.7 — Video Edit',
    docUrl: docUrl('wan/2-7-videoedit'),
    outputKind: 'video',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Optional on this model. Describes the expected result.',
        group: 'core',
        maxLength: 5000,
      },
      negativePrompt,
      {
        key: 'video_url',
        type: 'url',
        label: 'Source video',
        describe:
          'mp4/mov, 2-10 seconds, 240-4096px, aspect 1:8 to 8:1, up to 100MB. Only one video.',
        group: 'core',
        required: true,
        accept: ['video'],
      },
      {
        key: 'reference_image',
        type: 'url',
        label: 'Reference image',
        describe: 'Character, clothing or style guidance. jpeg/jpg/png/bmp/webp, 240-8000px.',
        group: 'core',
        accept: ['image'],
      },
      {
        key: 'resolution',
        type: 'enum',
        label: 'Resolution',
        describe: '1080p costs more than 720p.',
        group: 'framing',
        enum: ['720p', '1080p'],
        default: '1080p',
      },
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe: 'Omit to keep a ratio close to the input.',
        group: 'framing',
        enum: WAN_27_ASPECT,
      },
      {
        key: 'duration',
        type: 'number',
        label: 'Duration',
        describe: '0 means the full input duration with no truncation. Otherwise 2 to 10 seconds.',
        group: 'framing',
        min: 0,
        max: 10,
        step: 1,
        default: 0,
      },
      {
        key: 'audio_setting',
        type: 'enum',
        label: 'Audio handling',
        describe: 'auto lets the model decide; origin forces keeping the source audio.',
        group: 'audio',
        enum: ['auto', 'origin'],
        default: 'auto',
      },
      promptExtend,
      watermark,
      seed(),
      nsfwChecker,
    ],
  },
  {
    slug: 'wan/2-7-r2v',
    family: 'wan',
    capability: 'reference-to-video',
    label: 'Wan 2.7 — Reference to Video',
    docUrl: docUrl('wan/2-7-r2v'),
    outputKind: 'video',
    params: [
      {
        key: 'prompt',
        type: 'text',
        label: 'Prompt',
        describe: 'Chinese and English supported.',
        group: 'core',
        required: true,
        maxLength: 5000,
      },
      negativePrompt,
      {
        key: 'reference_image',
        type: 'url[]',
        label: 'Reference images',
        describe: 'An array despite the singular field name.',
        group: 'core',
        maxItems: 5,
        accept: ['image'],
      },
      {
        key: 'reference_video',
        type: 'url[]',
        label: 'Reference videos',
        describe: 'An array despite the singular field name.',
        group: 'core',
        maxItems: 5,
        accept: ['video'],
      },
      {
        key: 'first_frame',
        type: 'url',
        label: 'First frame',
        describe: 'When supplied, aspect ratio is ignored and follows this frame.',
        group: 'core',
        accept: ['image'],
      },
      {
        key: 'reference_voice',
        type: 'url',
        label: 'Voice reference',
        describe: 'wav or mp3, 1-10 seconds, up to 15MB. Sets the subject voice timbre.',
        group: 'audio',
        accept: ['audio'],
      },
      resolution(['720p', '1080p'], '1080p'),
      {
        key: 'aspect_ratio',
        type: 'enum',
        label: 'Aspect ratio',
        describe: 'Ignored when a first frame is provided.',
        group: 'framing',
        enum: WAN_27_ASPECT,
        default: '16:9',
      },
      {
        key: 'duration',
        type: 'number',
        label: 'Duration',
        describe: 'Seconds, 2 to 10.',
        group: 'framing',
        min: 2,
        max: 10,
        step: 1,
        default: 5,
      },
      promptExtend,
      watermark,
      seed(),
      nsfwChecker,
    ],
    constraints: [
      {
        kind: 'requiresOneOf',
        keys: ['reference_image', 'reference_video'],
        message: 'Provide at least one reference image or reference video.',
      },
      {
        /*
         * Same shape as wan/2-7-image's edit-mode rule: the doc says the ratio
         * "is ignored" once a first frame is set, and being silently ignored is
         * worse than being rejected — you get the frame's shape back having
         * asked for another, with nothing anywhere saying why.
         */
        kind: 'forbiddenWhen',
        keys: ['aspect_ratio'],
        when: { key: 'first_frame', present: true },
        message:
          'The output takes its shape from the first frame, so the aspect ratio is ignored.',
      },
    ],
    notes:
      'reference_image and reference_video are arrays despite their singular names — a frequent source of 422s. ' +
      'aspect_ratio is read only when there is no first_frame; with one, Kie ignores it rather than rejecting it.',
  },
  wan30('wan/3-0-video', 'Wan 3.0 — Video', 'wan/3-0-video', false),
  wan30('wan/3-0-video-prime', 'Wan 3.0 — Video Prime', 'wan/3-0-video-prime', true),
  wan27Image('wan/2-7-image', 'Wan 2.7 Image', 'wan/2-7-image'),
  wan27Image('wan/2-7-image-pro', 'Wan 2.7 Image Pro', 'wan/2-7-image-pro'),
]
