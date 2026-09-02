import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { deriveFields, pendingRequirements } from './constraints.ts'
import { ALL_MODELS, requireModel } from './registry/index.ts'

const seedance2 = requireModel('bytedance/seedance-2')
const omni = requireModel('kling-3.0-omni/reference-to-video')
const omniText = requireModel('kling-3.0-omni/text-to-video')
const wan30 = requireModel('wan/3-0-video')
const wan27Image = requireModel('wan/2-7-image')

describe('mutually exclusive groups disable the other side', () => {
  it('disables reference assets once a first frame is chosen', () => {
    const fields = deriveFields(seedance2, { first_frame_url: 'https://x/a.png' })

    assert.equal(fields.reference_image_urls!.disabled, true)
    assert.equal(fields.reference_video_urls!.disabled, true)
    assert.equal(fields.reference_audio_urls!.disabled, true)
    assert.match(fields.reference_image_urls!.reason!, /one input mode/)

    // The chosen group stays usable.
    assert.equal(fields.first_frame_url!.disabled, false)
    assert.equal(fields.last_frame_url!.disabled, false)
  })

  it('disables the frame fields once a reference asset is chosen', () => {
    const fields = deriveFields(seedance2, {
      reference_image_urls: ['https://x/a.png'],
    })
    assert.equal(fields.first_frame_url!.disabled, true)
    assert.equal(fields.last_frame_url!.disabled, true)
    assert.equal(fields.reference_video_urls!.disabled, false)
  })

  it('re-enables everything once the field is cleared', () => {
    // The user must always be able to undo their way out of a conflict.
    const fields = deriveFields(seedance2, {
      first_frame_url: '',
      reference_image_urls: [],
    })
    for (const key of [
      'first_frame_url',
      'last_frame_url',
      'reference_image_urls',
      'reference_video_urls',
    ]) {
      assert.equal(fields[key]!.disabled, false, key)
    }
  })

  it('separates frames from references on Wan 3.0', () => {
    const fields = deriveFields(wan30, { reference_file_urls: ['https://x/a.pdf'] })
    assert.equal(fields.first_frame_url!.disabled, true)
    // Same group — still selectable alongside a document.
    assert.equal(fields.reference_image_urls!.disabled, false)
    // Separate mutuallyExclusive rule.
    assert.equal(fields.reference_link_urls!.disabled, true)
  })
})

describe('mutually exclusive single keys', () => {
  it('disables the opposite multi-shot toggle', () => {
    const fields = deriveFields(omniText, { customize_multi_shots: true })
    assert.equal(fields.prefer_multi_shots!.disabled, true)
    assert.match(fields.prefer_multi_shots!.reason!, /cannot both be on/)
  })
})

describe('conditional requirement', () => {
  it('marks shots required while custom multi-shot is on', () => {
    const fields = deriveFields(omniText, { customize_multi_shots: true })
    assert.equal(fields.multi_prompt!.required, true)
  })

  it('disables shots while custom multi-shot is off', () => {
    const fields = deriveFields(omniText, { customize_multi_shots: false })
    assert.equal(fields.multi_prompt!.disabled, true)
    assert.match(fields.multi_prompt!.reason!, /only apply when/)
  })

  it('applies the documented default when the toggle is untouched', () => {
    // customize_multi_shots defaults to true on this model.
    const fields = deriveFields(omniText, {})
    assert.equal(fields.multi_prompt!.required, true)
  })
})

describe('conditional maximum', () => {
  it('lowers n to 4 outside sequential mode', () => {
    assert.equal(deriveFields(wan27Image, { enable_sequential: false }).n!.max, 4)
    assert.equal(deriveFields(wan27Image, {}).n!.max, 4)
  })

  it('restores the full range of 12 in sequential mode', () => {
    assert.equal(deriveFields(wan27Image, { enable_sequential: true }).n!.max, 12)
  })

  it('disables thinking mode in sequential mode', () => {
    const fields = deriveFields(wan27Image, { enable_sequential: true })
    assert.equal(fields.thinking_mode!.disabled, true)
  })
})

describe('pendingRequirements', () => {
  it('reports requiresOneOf until something is chosen', () => {
    assert.deepEqual(pendingRequirements(omni, {}).length, 1)
    assert.equal(
      pendingRequirements(omni, { image_urls: ['https://x/a.png'] }).length,
      0,
    )
  })

  it('reports a dependency that is not yet satisfied', () => {
    const messages = pendingRequirements(seedance2, {
      last_frame_url: 'https://x/b.png',
    })
    assert.match(messages.join(' '), /last frame needs a first frame/)
  })

  it('does not disable the fields behind requiresOneOf', () => {
    // Disabling them would make the rule impossible to satisfy.
    const fields = deriveFields(omni, {})
    assert.equal(fields.image_urls!.disabled, false)
    assert.equal(fields.video_urls!.disabled, false)
  })
})

describe('every model derives cleanly', () => {
  it('produces state for every parameter of all 59 models', () => {
    for (const model of ALL_MODELS) {
      const fields = deriveFields(model, {})
      for (const param of model.params) {
        assert.ok(fields[param.key], `${model.slug}.${param.key} missing`)
      }
    }
  })

  it('always explains a disabled control', () => {
    for (const model of ALL_MODELS) {
      // Exercise each boolean toggle both ways to reach the conditional rules.
      const toggles = model.params.filter((p) => p.type === 'boolean')
      for (const toggle of toggles) {
        for (const value of [true, false]) {
          const fields = deriveFields(model, { [toggle.key]: value })
          for (const [key, field] of Object.entries(fields)) {
            if (field.disabled) {
              assert.ok(field.reason, `${model.slug}.${key} disabled with no reason`)
            }
          }
        }
      }
    }
  })

  it('never disables a field that has no alternative', () => {
    // A model where every required field is disabled would be unusable.
    for (const model of ALL_MODELS) {
      const fields = deriveFields(model, {})
      const requiredDisabled = model.params
        .filter((p) => p.required && fields[p.key]!.disabled)
        .map((p) => p.key)
      assert.deepEqual(requiredDisabled, [], model.slug)
    }
  })
})
