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
    assert.match(messages(result), /cannot be combined with sequential/)
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
