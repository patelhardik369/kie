import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { requireModel } from '../kie/registry/index.ts'
import type { ModelDefinition } from '../kie/registry/types.ts'
import { applyPreset, presetableValues, summarizePreset } from './apply.ts'

const model = requireModel('wan/2-7-image')

/**
 * Registry drift, simulated by applying a preset to a model that has since
 * changed shape. This is the Phase 6 exit criterion: a preset saved before a
 * registry change still applies, and reports what it dropped.
 */
function withParams(base: ModelDefinition, mutate: (m: ModelDefinition) => ModelDefinition) {
  return mutate({ ...base, params: base.params.map((p) => ({ ...p })) })
}

describe('applyPreset — the happy case', () => {
  it('carries every still-valid value through', () => {
    const result = applyPreset(model, { resolution: '2K', n: 4, seed: 42 })

    assert.deepEqual(result.values, { resolution: '2K', n: 4, seed: 42 })
    assert.deepEqual(result.dropped, [])
    assert.equal(result.clean, true)
  })

  it('applies an empty preset without complaint', () => {
    const result = applyPreset(model, {})
    assert.deepEqual(result.values, {})
    assert.equal(result.clean, true)
  })

  it('does not invent values for parameters the preset omits', () => {
    // A preset is a starting point; the rest falls back to documented defaults
    // at submit time, not here.
    const result = applyPreset(model, { seed: 7 })
    assert.deepEqual(Object.keys(result.values), ['seed'])
  })
})

describe('applyPreset — registry drift', () => {
  it('drops a parameter the model no longer has, and says which', () => {
    const preset = { resolution: '2K', cfg_scale: 7.5 }
    const result = applyPreset(model, preset)

    assert.deepEqual(result.values, { resolution: '2K' })
    assert.equal(result.clean, false)
    assert.equal(result.dropped.length, 1)
    assert.equal(result.dropped[0]!.key, 'cfg_scale')
    assert.equal(result.dropped[0]!.reason, 'unknown_key')
    assert.equal(result.dropped[0]!.value, 7.5)
    assert.match(result.dropped[0]!.message, /no longer has a "cfg_scale" parameter/)
  })

  it('drops a value that is no longer in the enum', () => {
    // Kie narrows enums between model revisions; a preset holding the removed
    // value must not apply it and fail later as a 422.
    const narrowed = withParams(model, (m) => {
      const resolution = m.params.find((p) => p.key === 'resolution')!
      resolution.enum = ['1K', '2K']
      return m
    })

    const result = applyPreset(narrowed, { resolution: '4K', seed: 1 })

    assert.deepEqual(result.values, { seed: 1 })
    assert.equal(result.dropped.length, 1)
    assert.equal(result.dropped[0]!.key, 'resolution')
    assert.equal(result.dropped[0]!.reason, 'invalid_value')
  })

  it('drops a value that falls outside a narrowed range', () => {
    const narrowed = withParams(model, (m) => {
      const n = m.params.find((p) => p.key === 'n')!
      n.max = 2
      return m
    })

    const result = applyPreset(narrowed, { n: 4 })
    assert.deepEqual(result.values, {})
    assert.equal(result.dropped[0]!.reason, 'invalid_value')
  })

  it('drops a value whose type changed under it', () => {
    const retyped = withParams(model, (m) => {
      const seed = m.params.find((p) => p.key === 'seed')!
      seed.type = 'string'
      return m
    })

    const result = applyPreset(retyped, { seed: 12345 })
    assert.deepEqual(result.values, {})
    assert.equal(result.dropped[0]!.reason, 'invalid_value')
  })

  it('never throws, however wrong the stored preset is', () => {
    const result = applyPreset(model, {
      gone: 'x',
      alsoGone: { nested: true },
      resolution: 'not-a-resolution',
      n: 'four',
      seed: 3,
    })

    // Whatever survives is usable, and everything else is listed.
    assert.deepEqual(result.values, { seed: 3 })
    assert.equal(result.dropped.length, 4)
    assert.equal(result.clean, false)
  })

  it('does not mistake a missing required field for a drop', () => {
    // A one-key preset is obviously missing this model's required prompt. That
    // is not the preset's fault and must not be reported as dropped.
    const result = applyPreset(model, { seed: 1 })
    assert.deepEqual(result.dropped, [])
  })

  it('does not let a constraint on the whole payload drop a valid field', () => {
    // thinking_mode conflicts with enable_sequential, but a preset carrying
    // only one of them is not in conflict with anything.
    const result = applyPreset(model, { thinking_mode: true })
    assert.deepEqual(result.values, { thinking_mode: true })
    assert.deepEqual(result.dropped, [])
  })
})

describe('presetableValues', () => {
  it('excludes asset URLs, which expire in about 24 hours', () => {
    // A preset carrying an upload URL would apply cleanly and then fail at
    // submit with a dead link.
    const imageModel = requireModel('kling-2.6/image-to-video')
    const values = presetableValues(imageModel, {
      prompt: 'a lemon',
      image_urls: ['https://kieai.redpandaai.co/uploads/x.png'],
      duration: '5',
    })

    assert.deepEqual(values, { prompt: 'a lemon', duration: '5' })
  })

  it('drops keys the model does not have', () => {
    assert.deepEqual(presetableValues(model, { nope: 1, seed: 2 }), { seed: 2 })
  })

  it('keeps false and zero, which are real values', () => {
    const values = presetableValues(model, { watermark: false, seed: 0 })
    assert.deepEqual(values, { watermark: false, seed: 0 })
  })
})

describe('summarizePreset', () => {
  it('lists the parameters', () => {
    assert.equal(summarizePreset({ resolution: '2K', n: 4 }), 'resolution="2K" · n=4')
  })

  it('truncates past a handful', () => {
    const summary = summarizePreset({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 })
    assert.match(summary, /\+2 more$/)
  })

  it('compacts values that would not fit', () => {
    assert.match(summarizePreset({ prompt: 'x'.repeat(80) }), /…/)
    assert.equal(summarizePreset({ urls: [1, 2, 3] }), 'urls=[3]')
  })

  it('says so when there is nothing in it', () => {
    assert.equal(summarizePreset({}), 'No parameters')
  })
})
