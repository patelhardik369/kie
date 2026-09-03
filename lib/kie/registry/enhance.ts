import { docUrl, type ModelDefinition, type ParamDef } from './types.ts'

/**
 * Enhance — 5 models (3 image, 2 video).
 * Transcribed from .claude/skills/kie-models/references/enhance.md.
 *
 * A CAPABILITY family, not a vendor: every upscaler and background remover in
 * the catalog lives here whoever built it. That is the whole reason
 * `grok-imagine/upscale` is in scope while the rest of Grok Imagine is not.
 *
 * Family-wide traps encoded below:
 *  - The input field is named differently on every single model: `image_url`
 *    (Topaz image), `image` (both Recraft), `video_url` (Topaz video), and
 *    `task_id` (Grok). Topaz vs Recraft is the easiest 422 in the catalog.
 *  - `upscale_factor` is REQUIRED on topaz/image-upscale and OPTIONAL on
 *    topaz/video-upscale, with the same enum and the same default.
 *  - Its values are quoted STRINGS ('2'), not numbers.
 */

/** Shared by both Topaz models — same enum, same default, different requiredness. */
function upscaleFactor(required: boolean): ParamDef {
  return {
    key: 'upscale_factor',
    type: 'enum',
    label: 'Upscale factor',
    describe: 'Multiplies width and height. Quoted strings, not numbers.',
    group: 'core',
    ...(required ? { required: true } : {}),
    enum: ['1', '2', '4'],
    default: '2',
  }
}

export const ENHANCE_MODELS: ModelDefinition[] = [
  {
    slug: 'topaz/image-upscale',
    family: 'enhance',
    capability: 'upscale',
    label: 'Topaz — Image Upscale',
    docUrl: docUrl('topaz/image-upscale'),
    outputKind: 'image',
    params: [
      {
        key: 'image_url',
        type: 'url',
        label: 'Image',
        describe: 'The image to upscale. jpeg, png or webp, max 10.0MB.',
        group: 'core',
        required: true,
        accept: ['image'],
      },
      upscaleFactor(true),
    ],
    notes:
      'Field is image_url; the two Recraft models use a bare `image`. upscale_factor is REQUIRED here but ' +
      'optional on topaz/video-upscale. DOC QUIRK: upscale_factor is described as "Factor to upscale the ' +
      'video by" — copied from the video model. It applies to the image.',
  },

  {
    slug: 'recraft/crisp-upscale',
    family: 'enhance',
    capability: 'upscale',
    label: 'Recraft — Crisp Upscale',
    docUrl: docUrl('recraft/crisp-upscale'),
    outputKind: 'image',
    params: [
      {
        key: 'image',
        type: 'url',
        label: 'Image',
        describe: 'The image to upscale. jpeg, png or webp, max 10.0MB.',
        group: 'core',
        required: true,
        accept: ['image'],
      },
    ],
    notes:
      'One parameter, no options — Recraft chooses the factor, unlike Topaz. Field is a bare `image`, not image_url.',
  },

  {
    slug: 'recraft/remove-background',
    family: 'enhance',
    capability: 'background-removal',
    label: 'Recraft — Remove Background',
    docUrl: docUrl('recraft/remove-background'),
    outputKind: 'image',
    params: [
      {
        key: 'image',
        type: 'url',
        label: 'Image',
        describe:
          'The image to cut out. PNG, JPG or WEBP, max 5MB, max 16MP, 256–4096px per side.',
        group: 'core',
        required: true,
        accept: ['image'],
      },
    ],
    notes:
      'The only model in the catalog with a documented MINIMUM dimension (256px). Its 5MB cap is half of ' +
      'every other image input here. Field is a bare `image`, not image_url.',
  },

  {
    slug: 'topaz/video-upscale',
    family: 'enhance',
    capability: 'upscale',
    label: 'Topaz — Video Upscale',
    docUrl: docUrl('topaz/video-upscale'),
    outputKind: 'video',
    params: [
      {
        key: 'video_url',
        type: 'url',
        label: 'Video',
        describe: 'The video to upscale. mp4, mov or mkv, max 50.0MB.',
        group: 'core',
        required: true,
        accept: ['video'],
      },
      upscaleFactor(false),
    ],
    notes:
      'upscale_factor is optional here but required on topaz/image-upscale, with the same enum and default.',
  },

  {
    slug: 'grok-imagine/upscale',
    family: 'enhance',
    capability: 'upscale',
    label: 'Grok Imagine — Video Upscale',
    docUrl: docUrl('grok-imagine/upscale'),
    outputKind: 'video',
    params: [
      {
        key: 'task_id',
        type: 'string',
        label: 'Source task id',
        describe:
          'The Kie task id of a previously successful video generation — not a URL and not an upload. Kie keeps results for 14 days.',
        group: 'core',
        required: true,
        maxLength: 100,
      },
      {
        key: 'resolution',
        type: 'enum',
        label: 'Resolution',
        describe: 'Target resolution.',
        group: 'framing',
        enum: ['720p', '1080p'],
        default: '720p',
      },
    ],
    notes:
      'The only enhance model that takes no asset: it re-renders a video Kie still holds, addressed by the ' +
      'taskId that generated it, so its source cannot come from the asset library. ' +
      'DOC AMBIGUITY: the page says only "Must be from a Kie AI video generation model (e.g. ' +
      'grok-imagine/text-to-video)" and "Only Kie AI-generated task IDs are supported". It does NOT state ' +
      'whether a Kling, Wan, Seedance or Veo task id is accepted, and the example is a Grok one. Read a 422 ' +
      'here as "that source model is not supported", not as a bad parameter. ' +
      'In scope because enhance is a capability family — the rest of Grok Imagine is not.',
  },
]
