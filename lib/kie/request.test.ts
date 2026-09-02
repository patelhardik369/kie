import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { requireModel } from './registry/index.ts'
import { buildRequestInput, missingRequired } from './request.ts'

const seedreamLite = requireModel('seedream/5-lite-text-to-image')
const kling26 = requireModel('kling-2.6/text-to-video')
const seedance2 = requireModel('bytedance/seedance-2')

const PROMPT = 'A single ripe lemon on a plain white studio background.'

describe('buildRequestInput', () => {
  it('fills required fields from their documented defaults', () => {
    // Verified against the live API: omitting aspect_ratio here returns
    // "This field is required" despite the doc listing a default of 1:1.
    const payload = buildRequestInput(seedreamLite, { prompt: PROMPT })
    assert.equal(payload.aspect_ratio, '1:1')
    assert.equal(payload.quality, 'basic')
  })

  it('does not override a value the caller chose', () => {
    const payload = buildRequestInput(seedreamLite, {
      prompt: PROMPT,
      aspect_ratio: '16:9',
      quality: 'ultra',
    })
    assert.equal(payload.aspect_ratio, '16:9')
    assert.equal(payload.quality, 'ultra')
  })

  it('leaves optional fields out entirely', () => {
    const payload = buildRequestInput(seedreamLite, { prompt: PROMPT })
    // output_format and nsfw_checker are optional — the API applies its own.
    assert.ok(!('output_format' in payload))
    assert.ok(!('nsfw_checker' in payload))
  })

  it('cannot invent a required field that has no default', () => {
    // kling-2.6/text-to-video marks `sound` required with no documented default.
    const payload = buildRequestInput(kling26, { prompt: PROMPT })
    assert.ok(!('sound' in payload))
    assert.deepEqual(missingRequired(kling26, payload), ['sound'])
  })

  it('keeps false and 0 rather than treating them as empty', () => {
    const payload = buildRequestInput(seedance2, {
      prompt: PROMPT,
      generate_audio: false,
      duration: 4,
    })
    assert.equal(payload.generate_audio, false)
    assert.equal(payload.duration, 4)
  })

  it('drops empty strings and empty arrays', () => {
    // An empty array would otherwise trip the API's own required checks and,
    // locally, a mutual-exclusion rule the user thought they had cleared.
    const payload = buildRequestInput(seedance2, {
      prompt: PROMPT,
      first_frame_url: 'https://x/a.png',
      reference_image_urls: [],
      last_frame_url: '',
    })
    assert.ok(!('reference_image_urls' in payload))
    assert.ok(!('last_frame_url' in payload))
    assert.equal(payload.first_frame_url, 'https://x/a.png')
  })

  it('produces exactly the payload that succeeded against the live API', () => {
    const payload = buildRequestInput(seedreamLite, { prompt: PROMPT, quality: 'basic' })
    assert.deepEqual(payload, {
      prompt: PROMPT,
      quality: 'basic',
      aspect_ratio: '1:1',
    })
  })
})

describe('missingRequired', () => {
  it('lists only fields with no value and no default', () => {
    assert.deepEqual(missingRequired(seedreamLite, {}), ['prompt'])
    assert.deepEqual(missingRequired(seedreamLite, { prompt: PROMPT }), [])
  })

  it('treats an empty string as missing', () => {
    assert.deepEqual(missingRequired(seedreamLite, { prompt: '   ' }), ['prompt'])
  })
})
