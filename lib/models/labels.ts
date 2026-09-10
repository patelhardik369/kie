import type { Capability, Family } from '../kie/registry/types.ts'

/**
 * Display names for registry enums.
 *
 * Pure module, no React — imported by server components, client components and
 * the home page alike.
 *
 * These lived as three identical copies (the generate picker, the model browser,
 * the gallery filters) until the catalog grew past three families; adding one
 * family meant editing the same map in three places and finding out at the type
 * level only if you missed one. `Record<Family, string>` is exhaustive, so the
 * compiler now names any family or capability that has no label.
 */

export const FAMILY_LABEL: Record<Family, string> = {
  kling: 'Kling',
  bytedance: 'ByteDance',
  wan: 'Wan',
  google: 'Google',
  openai: 'OpenAI',
  enhance: 'Enhance',
}

/** One-line summaries, for the home page's family cards. */
export const FAMILY_BLURB: Record<Family, string> = {
  kling: 'Video, avatars, motion control',
  bytedance: 'Seedance video, Seedream image',
  wan: 'Video, image, layer decomposition',
  google: 'Veo, Gemini Omni, Imagen 4, Nano Banana',
  openai: 'GPT Image 1.5, 2 and 2.5',
  // Named for what it does, not who made it — see lib/kie/registry/enhance.ts.
  enhance: 'Upscale and background removal',
}

export const CAPABILITY_LABEL: Record<Capability, string> = {
  'text-to-video': 'Text to video',
  'image-to-video': 'Image to video',
  'reference-to-video': 'Reference to video',
  'video-to-video': 'Video to video',
  'speech-to-video': 'Speech to video',
  'motion-control': 'Motion control',
  avatar: 'Avatar',
  'text-to-image': 'Text to image',
  'image-to-image': 'Image to image',
  'layer-decomposition': 'Layer decomposition',
  'text-to-speech': 'Text to speech',
  upscale: 'Upscale',
  'background-removal': 'Background removal',
}
