import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { requireModel } from './registry/index.ts'
import { isPresent, validateInput } from './validate.ts'

const seedance2 = requireModel('bytedance/seedance-2')
const klingStandard = requireModel('kling/v2-1-standard')
const omni = requireModel('kling-3.0-omni/text-to-video')
const wan30 = requireModel('wan/3-0-video')
const wan27Image = requireModel('wan/2-7-image')
const wanR2v = requireModel('wan/2-7-r2v')
const kling30 = requireModel('kling-3.0/video')

const PROMPT = 'A serene beach at sunset with waves crashing on the shore.'

function messages(result: ReturnType<typeof validateInput>) {
  return result.issues.map((i) => i.message).join(' | ')
}

describe('Seedance 2.0 mutually exclusive input modes', () => {
  // The Phase 2 exit criterion.
  it('rejects a first frame combined with reference images', () => {
    const result = validateInput(seedance2, {
      prompt: PROMPT,
      first_frame_url: 'https://x/first.png',
      reference_image_urls: ['https://x/ref.png'],
    })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((i) => i.code === 'constraint'))
    assert.match(messages(result), /one input mode per generation/)
  })

  it('accepts a first frame alone', () => {
    const result = validateInput(seedance2, {
      prompt: PROMPT,
      first_frame_url: 'https://x/first.png',
    })
    assert.equal(result.ok, true, messages(result))
  })

  it('accepts reference images alone', () => {
    const result = validateInput(seedance2, {
      prompt: PROMPT,
      reference_image_urls: ['https://x/ref.png'],
    })
    assert.equal(result.ok, true, messages(result))
  })

  it('accepts first and last frames together', () => {
    const result = validateInput(seedance2, {
      prompt: PROMPT,
      first_frame_url: 'https://x/first.png',
      last_frame_url: 'https://x/last.png',
    })
    assert.equal(result.ok, true, messages(result))
  })

  it('allows reference images, videos and audio to combine', () => {
    // These live in one group — multimodal reference genuinely mixes them.
    const result = validateInput(seedance2, {
      prompt: PROMPT,
      reference_image_urls: ['https://x/ref.png'],
      reference_video_urls: ['https://x/ref.mp4'],
      reference_audio_urls: ['https://x/ref.mp3'],
    })
    assert.equal(result.ok, true, messages(result))
  })

  it('rejects a last frame with no first frame', () => {
    const result = validateInput(seedance2, {
      prompt: PROMPT,
      last_frame_url: 'https://x/last.png',
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /last frame needs a first frame/)
  })

  it('treats an empty array as absent, so a cleared field resolves the conflict', () => {
    const result = validateInput(seedance2, {
      prompt: PROMPT,
      first_frame_url: 'https://x/first.png',
      reference_image_urls: [],
    })
    assert.equal(result.ok, true, messages(result))
  })
})

describe('required fields', () => {
  it('rejects a missing prompt', () => {
    const result = validateInput(seedance2, { first_frame_url: 'https://x/a.png' })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((i) => i.key === 'prompt' && i.code === 'required'))
  })

  it('rejects a missing required asset', () => {
    const result = validateInput(klingStandard, { prompt: PROMPT })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((i) => i.key === 'image_url' && i.code === 'required'))
  })

  it('lets a documented default satisfy a required field', () => {
    // kling-2.6/text-to-video marks aspect_ratio and duration required, but both
    // carry defaults the API applies.
    const model = requireModel('kling-2.6/text-to-video')
    const result = validateInput(model, { prompt: PROMPT, sound: true })
    assert.equal(result.ok, true, messages(result))
  })

  it('still demands a required field that has no default', () => {
    const model = requireModel('kling-2.6/text-to-video')
    const result = validateInput(model, { prompt: PROMPT })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((i) => i.key === 'sound'))
  })
})

describe('enums and types', () => {
  it('rejects a value outside the enum', () => {
    const result = validateInput(klingStandard, {
      prompt: PROMPT,
      image_url: 'https://x/a.png',
      duration: '7',
    })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((i) => i.code === 'enum' && i.key === 'duration'))
  })

  it('rejects a number where Kling wants a duration string', () => {
    // The single most common 422 in this family.
    const result = validateInput(klingStandard, {
      prompt: PROMPT,
      image_url: 'https://x/a.png',
      duration: 5,
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /Duration/)
  })

  // Omni defaults customize_multi_shots to true, which makes multi_prompt
  // required — so single-shot payloads must turn it off explicitly.
  const omniSingleShot = { prompt: PROMPT, customize_multi_shots: false }

  it('accepts an integer duration on Kling Omni', () => {
    const result = validateInput(omni, { ...omniSingleShot, duration: 12 })
    assert.equal(result.ok, true, messages(result))
  })

  it('rejects a string duration on Kling Omni', () => {
    const result = validateInput(omni, { ...omniSingleShot, duration: '12' })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((i) => i.code === 'type'))
  })

  it('rejects an out-of-range number', () => {
    const result = validateInput(omni, { ...omniSingleShot, duration: 60 })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((i) => i.code === 'range'))
  })

  it('rejects a non-boolean for a boolean field', () => {
    const result = validateInput(omni, { ...omniSingleShot, audio: 'yes' })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((i) => i.code === 'type' && i.key === 'audio'))
  })

  it('enforces the step on num_frames', () => {
    const speech = requireModel('wan/2-2-a14b-speech-to-video-turbo')
    const base = {
      prompt: PROMPT,
      image_url: 'https://x/a.png',
      audio_url: 'https://x/a.mp3',
    }
    assert.equal(validateInput(speech, { ...base, num_frames: 80 }).ok, true)
    const bad = validateInput(speech, { ...base, num_frames: 81 })
    assert.equal(bad.ok, false)
    assert.ok(bad.issues.some((i) => i.code === 'step'))
  })
})

describe('lengths and item counts', () => {
  it('rejects an over-long prompt', () => {
    const result = validateInput(klingStandard, {
      prompt: 'x'.repeat(5001),
      image_url: 'https://x/a.png',
    })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((i) => i.code === 'length'))
  })

  it('rejects too many array items', () => {
    const result = validateInput(seedance2, {
      prompt: PROMPT,
      reference_image_urls: Array.from({ length: 10 }, (_, i) => `https://x/${i}.png`),
    })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((i) => i.code === 'items'))
  })

  it('accepts exactly the documented maximum', () => {
    const result = validateInput(seedance2, {
      prompt: PROMPT,
      reference_image_urls: Array.from({ length: 9 }, (_, i) => `https://x/${i}.png`),
    })
    assert.equal(result.ok, true, messages(result))
  })
})

describe('unknown keys', () => {
  it('rejects a parameter the model does not declare', () => {
    const result = validateInput(klingStandard, {
      prompt: PROMPT,
      image_url: 'https://x/a.png',
      aspect_ratio: '16:9', // kling/v2-1-standard has no aspect_ratio
    })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((i) => i.code === 'unknown_key'))
  })
})

describe('nested object[] validation', () => {
  it('rejects a shot missing its required fields', () => {
    const result = validateInput(kling30, {
      multi_shots: true,
      multi_prompt: [{ prompt: 'A wide shot.' }],
    })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((i) => i.key === 'multi_prompt[0].duration'))
  })

  it('validates ranges inside a repeating group', () => {
    const result = validateInput(kling30, {
      multi_shots: true,
      multi_prompt: [{ prompt: 'A wide shot.', duration: 99 }],
    })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((i) => i.key === 'multi_prompt[0].duration'))
  })

  it('accepts a well-formed shot list', () => {
    const result = validateInput(kling30, {
      multi_shots: true,
      multi_prompt: [
        { prompt: 'A wide shot of the street.', duration: 3 },
        { prompt: 'A close-up on the character.', duration: 2 },
      ],
    })
    assert.equal(result.ok, true, messages(result))
  })
})

describe('conditional constraints', () => {
  it('requires shots when custom multi-shot is on', () => {
    const result = validateInput(omni, { prompt: PROMPT, customize_multi_shots: true })
    assert.equal(result.ok, false)
    assert.match(messages(result), /at least one shot/)
  })

  it('forbids shots when custom multi-shot is off', () => {
    const result = validateInput(omni, {
      prompt: PROMPT,
      customize_multi_shots: false,
      multi_prompt: [{ prompt: 'A shot.', duration: 3 }],
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /only apply when Custom multi-shot is on/)
  })

  it('rejects both multi-shot modes being on at once', () => {
    const result = validateInput(omni, {
      prompt: PROMPT,
      customize_multi_shots: true,
      prefer_multi_shots: true,
      multi_prompt: [{ prompt: 'A shot.', duration: 3 }],
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /cannot both be on/)
  })

  it('resolves the condition against documented defaults', () => {
    // customize_multi_shots defaults to true on this model, so omitting it
    // still makes multi_prompt required.
    const result = validateInput(omni, { prompt: PROMPT })
    assert.equal(result.ok, false)
    assert.match(messages(result), /at least one shot/)
  })
})

describe('Wan 3.0 frame vs reference exclusion', () => {
  it('rejects a first frame combined with reference images', () => {
    const result = validateInput(wan30, {
      prompt: PROMPT,
      first_frame_url: 'https://x/a.png',
      reference_image_urls: ['https://x/b.png'],
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /cannot be combined/)
  })

  it('rejects a reference document combined with a reference link', () => {
    const result = validateInput(wan30, {
      prompt: PROMPT,
      reference_file_urls: ['https://x/a.pdf'],
      reference_link_urls: ['https://example.com'],
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /document and a reference link/)
  })

  it('accepts a prompt on its own', () => {
    assert.equal(validateInput(wan30, { prompt: PROMPT }).ok, true)
  })
})

describe('Wan 2.7 image conditional maximum', () => {
  it('rejects n above 4 outside sequential mode', () => {
    const result = validateInput(wan27Image, {
      prompt: PROMPT,
      enable_sequential: false,
      n: 12,
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /at most 4 images/)
  })

  it('allows n up to 12 in sequential mode', () => {
    const result = validateInput(wan27Image, {
      prompt: PROMPT,
      enable_sequential: true,
      n: 12,
    })
    assert.equal(result.ok, true, messages(result))
  })

  it('applies the default of enable_sequential when it is omitted', () => {
    const result = validateInput(wan27Image, { prompt: PROMPT, n: 12 })
    assert.equal(result.ok, false)
    assert.match(messages(result), /at most 4 images/)
  })

  it('rejects thinking mode combined with sequential mode', () => {
    const result = validateInput(wan27Image, {
      prompt: PROMPT,
      enable_sequential: true,
      thinking_mode: true,
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /unavailable in sequential mode/)
  })

  it('rejects thinking mode once an input image is supplied', () => {
    // The half of the rule no `equals` test can express: the doc says thinking
    // mode is available only while `input_urls` is EMPTY.
    const result = validateInput(wan27Image, {
      prompt: PROMPT,
      input_urls: ['https://x/a.png'],
      thinking_mode: true,
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /text-to-image only/)
  })

  it('allows thinking mode with no images and sequential off', () => {
    const result = validateInput(wan27Image, {
      prompt: PROMPT,
      thinking_mode: true,
    })
    assert.equal(result.ok, true, messages(result))
  })
})

describe('Wan 2.7 image colour palette', () => {
  const palette = [
    { hex: '#C2D1E6', ratio: '23.51%' },
    { hex: '#1A1A1A', ratio: '38.00%' },
    { hex: '#F0E6C2', ratio: '38.49%' },
  ]

  it('accepts { hex, ratio } objects', () => {
    const result = validateInput(wan27Image, { prompt: PROMPT, color_palette: palette })
    assert.equal(result.ok, true, messages(result))
  })

  it('rejects bare hex strings, which is what the form used to send', () => {
    const result = validateInput(wan27Image, {
      prompt: PROMPT,
      color_palette: ['#C2D1E6', '#1A1A1A', '#F0E6C2'],
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /hex.*ratio/s)
  })

  it('rejects a ratio that is not two decimals and a percent sign', () => {
    // Kie's pattern is `^\d{1,3}\.\d{2}%$` — "23.5%" and "24" both fail.
    for (const ratio of ['23.5%', '24', '23.510%', '23.51']) {
      const result = validateInput(wan27Image, {
        prompt: PROMPT,
        color_palette: [{ hex: '#C2D1E6', ratio }, ...palette.slice(1)],
      })
      assert.equal(result.ok, false, `${ratio} should be rejected`)
      assert.match(messages(result), /two decimal places/)
    }
  })

  it('rejects a malformed hex', () => {
    const result = validateInput(wan27Image, {
      prompt: PROMPT,
      color_palette: [{ hex: 'C2D1E6', ratio: '23.51%' }, ...palette.slice(1)],
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /#C2D1E6/)
  })

  it('still enforces the documented 3-10 range', () => {
    const result = validateInput(wan27Image, {
      prompt: PROMPT,
      color_palette: palette.slice(0, 2),
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /at least 3/)
  })

  it('rejects a palette in sequential mode', () => {
    const result = validateInput(wan27Image, {
      prompt: PROMPT,
      enable_sequential: true,
      color_palette: palette,
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /unavailable in sequential mode/)
  })
})

describe('Wan 2.7 image edit regions', () => {
  const image = 'https://x/a.png'

  it('accepts one list of boxes per input image', () => {
    const result = validateInput(wan27Image, {
      prompt: PROMPT,
      input_urls: [image, 'https://x/b.png'],
      bbox_list: [[[10, 10, 200, 200]], []],
    })
    assert.equal(result.ok, true, messages(result))
  })

  it('rejects the flat shape the form used to send', () => {
    const result = validateInput(wan27Image, {
      prompt: PROMPT,
      input_urls: [image],
      bbox_list: [[10, 10, 200, 200]],
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /one list of \[x1, y1, x2, y2\] boxes per input image/)
  })

  it('caps boxes per image rather than in total', () => {
    // Three boxes on one image is too many; three spread over two images is not.
    const tooMany = validateInput(wan27Image, {
      prompt: PROMPT,
      input_urls: [image],
      bbox_list: [[[0, 0, 1, 1], [2, 2, 3, 3], [4, 4, 5, 5]]],
    })
    assert.equal(tooMany.ok, false)
    assert.match(messages(tooMany), /at most 2 are allowed per image/)

    const spread = validateInput(wan27Image, {
      prompt: PROMPT,
      input_urls: [image, 'https://x/b.png'],
      bbox_list: [[[0, 0, 1, 1], [2, 2, 3, 3]], [[4, 4, 5, 5]]],
    })
    assert.equal(spread.ok, true, messages(spread))
  })

  it('rejects an outer list that does not match the image list', () => {
    // The outer list is indexed BY input_urls, so a mismatch does not fail
    // loudly — it applies regions to the wrong picture.
    const result = validateInput(wan27Image, {
      prompt: PROMPT,
      input_urls: [image, 'https://x/b.png'],
      bbox_list: [[[10, 10, 200, 200]]],
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /one entry per input_urls item/)
  })

  it('rejects a blank entry in the image list', () => {
    // buildRequestInput prunes these, so this only fires on a re-run, a preset,
    // or a hand-written payload — where "" would reach Kie as an unfetchable
    // image rather than as an omission.
    const result = validateInput(wan27Image, {
      prompt: PROMPT,
      input_urls: [image, ''],
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /item 2 is empty/)
  })

  it('rejects regions with no images to attach them to', () => {
    const result = validateInput(wan27Image, {
      prompt: PROMPT,
      bbox_list: [[[10, 10, 200, 200]]],
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /add at least one image/)
  })
})

describe('requiresOneOf', () => {
  it('rejects wan/2-7-r2v with no reference asset', () => {
    const result = validateInput(wanR2v, { prompt: PROMPT })
    assert.equal(result.ok, false)
    assert.match(messages(result), /at least one reference/)
  })

  it('accepts a reference image alone', () => {
    const result = validateInput(wanR2v, {
      prompt: PROMPT,
      reference_image: ['https://x/a.png'],
    })
    assert.equal(result.ok, true, messages(result))
  })

  it('rejects a bare string where an array is expected', () => {
    const result = validateInput(wanR2v, {
      prompt: PROMPT,
      reference_image: 'https://x/a.png',
    })
    assert.equal(result.ok, false)
    assert.ok(result.issues.some((i) => i.code === 'type'))
  })
})

describe('isPresent', () => {
  it('treats empty values as absent', () => {
    for (const value of [undefined, null, '', '   ', []]) {
      assert.equal(isPresent(value), false, JSON.stringify(value))
    }
  })

  it('treats false and 0 as present', () => {
    // A boolean switch set to false is a deliberate choice, not an empty field.
    assert.equal(isPresent(false), true)
    assert.equal(isPresent(0), true)
  })
})

describe('every model accepts a minimal valid payload', () => {
  it('has no model that is impossible to satisfy', () => {
    // A smoke check that required/constraint combinations are not contradictory.
    const model = requireModel('wan/2-6-text-to-video')
    assert.equal(validateInput(model, { prompt: PROMPT }).ok, true)
  })
})

const gptImage2 = requireModel('gpt-image-2-text-to-image')
const omniVideo = requireModel('gemini-omni-video')
const topazImage = requireModel('topaz/image-upscale')
const imagen4 = requireModel('google/imagen4')
const imagen4Fast = requireModel('google/imagen4-fast')
const tts = requireModel('google/gemini-3-1-flash-tts')

describe('string[] parameters', () => {
  it('accepts a list of opaque ids', () => {
    const result = validateInput(omniVideo, {
      prompt: PROMPT,
      duration: '8',
      audio_ids: ['audio_01hx8p0demo', 'audio_02'],
    })
    assert.equal(result.ok, true, messages(result))
  })

  it('rejects a bare string where a list is expected', () => {
    const result = validateInput(omniVideo, {
      prompt: PROMPT,
      duration: '8',
      audio_ids: 'audio_01hx8p0demo',
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /array of strings/)
  })

  it('rejects a blank row rather than sending an unresolvable id', () => {
    const result = validateInput(omniVideo, {
      prompt: PROMPT,
      duration: '8',
      character_ids: ['character_1', '  '],
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /item 2 is empty/)
  })

  it('enforces the documented item ceiling', () => {
    const result = validateInput(omniVideo, {
      prompt: PROMPT,
      duration: '8',
      audio_ids: ['a', 'b', 'c', 'd'],
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /at most 3/)
  })
})

describe('allowedValuesWhen at submit time', () => {
  it('rejects 4K on a square GPT Image 2 render', () => {
    const result = validateInput(gptImage2, {
      prompt: PROMPT,
      aspect_ratio: '1:1',
      resolution: '4K',
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /cannot be rendered at 4K/)
  })

  it('accepts 2K on the same square render', () => {
    const result = validateInput(gptImage2, {
      prompt: PROMPT,
      aspect_ratio: '1:1',
      resolution: '2K',
    })
    assert.equal(result.ok, true, messages(result))
  })

  it('rejects anything but 1K when the ratio is auto', () => {
    const result = validateInput(gptImage2, {
      prompt: PROMPT,
      aspect_ratio: 'auto',
      resolution: '2K',
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /1K only/)
  })

  it('says nothing when the gated field was never set', () => {
    // No resolution means Kie picks — there is nothing to complain about.
    const result = validateInput(gptImage2, { prompt: PROMPT, aspect_ratio: 'auto' })
    assert.equal(result.ok, true, messages(result))
  })

  it('rejects transparency above 1K', () => {
    const result = validateInput(gptImage2, {
      prompt: PROMPT,
      resolution: '4K',
      aspect_ratio: '16:9',
      background: 'transparent',
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /1K only/)
  })
})

describe('sibling models that disagree about a field`s type', () => {
  it('accepts a string seed on Imagen 4 and rejects a number', () => {
    assert.equal(validateInput(imagen4, { prompt: PROMPT, seed: '12345' }).ok, true)
    const wrong = validateInput(imagen4, { prompt: PROMPT, seed: 12345 })
    assert.equal(wrong.ok, false)
    assert.match(messages(wrong), /must be a string/)
  })

  it('accepts a number seed on Imagen 4 Fast and rejects a string', () => {
    assert.equal(validateInput(imagen4Fast, { prompt: PROMPT, seed: 12345 }).ok, true)
    assert.equal(validateInput(imagen4Fast, { prompt: PROMPT, seed: '12345' }).ok, false)
  })
})

describe('enhance models', () => {
  it('requires the Topaz upscale factor, unlike its video sibling', () => {
    const image = validateInput(topazImage, { image_url: 'https://x/a.png' })
    // A documented default satisfies a required field — the request builder
    // fills it in at the boundary.
    assert.equal(image.ok, true, messages(image))

    const bad = validateInput(topazImage, {
      image_url: 'https://x/a.png',
      upscale_factor: 2,
    })
    assert.equal(bad.ok, false)
    // Quoted strings, not numbers.
    assert.match(messages(bad), /must be one of "1", "2", "4"/)
  })

  it('rejects the wrong input field name between Topaz and Recraft', () => {
    const result = validateInput(topazImage, { image: 'https://x/a.png' })
    assert.equal(result.ok, false)
    assert.match(messages(result), /has no parameter "image"/)
  })

  it('takes a task id, not a URL, on the Grok upscaler', () => {
    const grok = requireModel('grok-imagine/upscale')
    const result = validateInput(grok, { task_id: 'task_grok_12345678' })
    assert.equal(result.ok, true, messages(result))
  })
})

describe('Gemini TTS nested groups', () => {
  it('accepts a minimal one-speaker script', () => {
    const result = validateInput(tts, {
      speakers: [{ speaker_id: 'Speaker 1', voice_name: 'Kore', accent: 'Neutral' }],
      dialogue_turns: [{ speaker_id: 'Speaker 1', text: 'Hello there.' }],
    })
    assert.equal(result.ok, true, messages(result))
  })

  it('reports a missing required field inside a row, by row number', () => {
    const result = validateInput(tts, {
      speakers: [{ speaker_id: 'Speaker 1', voice_name: 'Kore' }],
      dialogue_turns: [{ speaker_id: 'Speaker 1', text: 'Hello there.' }],
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /item 1: Accent is required/)
  })

  it('rejects a lowercase voice name', () => {
    // The omni-audio endpoint spells the same names lowercase; TTS does not.
    const result = validateInput(tts, {
      speakers: [{ speaker_id: 'Speaker 1', voice_name: 'kore', accent: 'Neutral' }],
      dialogue_turns: [{ speaker_id: 'Speaker 1', text: 'Hello there.' }],
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /Voice must be one of/)
  })

  it('validates the Gemini Omni video_list row shape', () => {
    const result = validateInput(omniVideo, {
      prompt: PROMPT,
      duration: '8',
      video_list: [{ url: 'https://x/a.mp4', start: 0 }],
    })
    assert.equal(result.ok, false)
    assert.match(messages(result), /item 1: End is required/)
  })
})

describe('GPT Image 2 treats an omitted aspect ratio as its own case', () => {
  it('rejects 2K when no aspect ratio was chosen at all', () => {
    // The doc restricts "auto OR without a specified aspect ratio parameter",
    // and this model documents no default — so an unset ratio is not `auto`.
    const result = validateInput(gptImage2, { prompt: PROMPT, resolution: '2K' })
    assert.equal(result.ok, false)
    assert.match(messages(result), /no aspect ratio chosen/)
  })

  it('accepts 1K with no aspect ratio', () => {
    const result = validateInput(gptImage2, { prompt: PROMPT, resolution: '1K' })
    assert.equal(result.ok, true, messages(result))
  })

  it('stops restricting once a real ratio is chosen', () => {
    const result = validateInput(gptImage2, {
      prompt: PROMPT,
      aspect_ratio: '16:9',
      resolution: '4K',
    })
    assert.equal(result.ok, true, messages(result))
  })
})
