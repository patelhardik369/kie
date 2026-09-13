import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ALL_MODELS, requireModel } from '../kie/registry/index.ts'
import { canMarkUp, modelSupportsMarkup, promptKeyOf } from './targets.ts'

/**
 * These assertions are the "no model branches" rule in executable form. If the
 * markup editor ever needs to know a slug, one of them stops being true.
 */

describe('which models offer markup', () => {
  const supported = ALL_MODELS.filter(modelSupportsMarkup)

  it('covers every model that takes an image and has a prompt', () => {
    const withImage = ALL_MODELS.filter((model) =>
      model.params.some(
        (param) =>
          (param.type === 'url' || param.type === 'url[]') &&
          (param.accept ?? []).includes('image'),
      ),
    )
    // 57 take an image; 5 of them have no prompt to name a mark in.
    assert.equal(withImage.length, 57)
    assert.equal(supported.length, 52)
  })

  it('excludes exactly the prompt-less image endpoints, by their own data', () => {
    const excluded = ALL_MODELS.filter(
      (model) =>
        !modelSupportsMarkup(model) &&
        model.params.some((param) => (param.accept ?? []).includes('image')),
    ).map((model) => model.slug)

    assert.deepEqual(excluded.sort(), [
      'recraft/crisp-upscale',
      'recraft/remove-background',
      'topaz/image-upscale',
      'wan/2-2-animate-move',
      'wan/2-2-animate-replace',
    ])
  })

  it('offers it on the endpoint that prompted the feature', () => {
    const model = requireModel('gpt-image-2-5-flare-image-to-image')
    assert.ok(modelSupportsMarkup(model))
    const field = model.params.find((param) => param.key === 'input_urls')!
    assert.ok(canMarkUp(model, field))
  })

  it('never offers it on a text-to-image model, which has no image to mark', () => {
    const model = requireModel('gpt-image-2-5-flare-text-to-image')
    assert.ok(!modelSupportsMarkup(model))
  })
})

describe('choosing the field the legend goes into', () => {
  it('finds the prompt on every model that offers markup', () => {
    for (const model of ALL_MODELS.filter(modelSupportsMarkup)) {
      assert.ok(promptKeyOf(model), model.slug)
    }
  })

  it('never picks a negative prompt', () => {
    // Appending the legend there would tell the model to avoid the very edit
    // that was asked for — the worst way for this to be quietly wrong.
    for (const model of ALL_MODELS) {
      const key = promptKeyOf(model)
      if (key) assert.ok(!/negative/i.test(key), `${model.slug} → ${key}`)
    }
  })

  it('picks a field the model actually declares', () => {
    for (const model of ALL_MODELS) {
      const key = promptKeyOf(model)
      if (!key) continue
      assert.ok(
        model.params.some((param) => param.key === key && param.type === 'text'),
        `${model.slug} → ${key}`,
      )
    }
  })
})

describe('which fields within a model', () => {
  it('refuses a video or audio field on a model that does support markup', () => {
    const model = requireModel('bytedance/seedance-2')
    for (const param of model.params) {
      if (param.type !== 'url' && param.type !== 'url[]') continue
      const accepts = param.accept ?? []
      if (!accepts.includes('image')) {
        assert.ok(!canMarkUp(model, param), `${model.slug}.${param.key}`)
      }
    }
  })

  it('refuses a non-URL field outright', () => {
    const model = requireModel('nano-banana-2')
    const prompt = model.params.find((param) => param.key === 'prompt')!
    assert.ok(!canMarkUp(model, prompt))
  })
})
