import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ALL_MODELS, requireModel } from './registry/index.ts'
import { openingValues, studioDefault, studioDefaults } from './studio-defaults.ts'
import { validateInput } from './validate.ts'

/**
 * The studio preferences: one output, 1K images, 720p video.
 *
 * Two things are worth pinning. The obvious one is that the preferences apply.
 * The one that would actually cost money is the second: a preference must never
 * put a value into a form that the model would reject, so the sweep at the
 * bottom checks every opening value of all 97 models against the registry's own
 * validator.
 */

describe('studio preferences', () => {
  it('opens Wan 2.7 Image on one 1K image, not four at 2K', () => {
    const model = requireModel('wan/2-7-image')
    const opening = openingValues(model)

    assert.equal(opening.n, 1)
    assert.equal(opening.resolution, '1K')

    // The documented defaults are untouched — they are what Kie does when the
    // field is omitted, and the control still prints them.
    assert.equal(model.params.find((p) => p.key === 'n')?.default, 4)
    assert.equal(model.params.find((p) => p.key === 'resolution')?.default, '2K')
  })

  it('opens video models on 720p, whichever way the family spells it', () => {
    assert.equal(openingValues(requireModel('wan/2-7-text-to-video')).resolution, '720p')
    // Wan 3.0 writes it uppercase, and the API takes only its own casing.
    assert.equal(openingValues(requireModel('wan/3-0-video')).resolution, '720P')
    // No documented default at all on 2.5 — the preference supplies one.
    assert.equal(openingValues(requireModel('wan/2-5-text-to-video')).resolution, '720p')
  })

  it('raises a 480p default to 720p as readily as it lowers a 1080p one', () => {
    assert.equal(
      openingValues(requireModel('wan/2-2-a14b-speech-to-video-turbo')).resolution,
      '720p',
    )
    assert.equal(openingValues(requireModel('wan/2-6-text-to-video')).resolution, '720p')
  })

  it('reports nothing for a parameter already on the preference', () => {
    // seedream v4 documents max_images: 1 and image_resolution: 1K already, so
    // there is no override to show under the control.
    const preferences = studioDefaults(requireModel('bytedance/seedream-v4-text-to-image'))
    assert.deepEqual(preferences, {})
  })

  it('leaves a model alone when the preference is not in its vocabulary', () => {
    // Layer decomposition sizes with `auto`, which follows the source image;
    // pinning it to 1K would silently downscale what is being decomposed.
    const model = requireModel('seedream/5-pro-layer-decomposition')
    assert.deepEqual(studioDefaults(model), {})
    assert.equal(openingValues(model).size, 'auto')
  })

  it('never proposes a value outside a parameter’s own enum or range', () => {
    for (const model of ALL_MODELS) {
      for (const param of model.params) {
        const preferred = studioDefault(model, param)
        if (preferred === undefined) continue

        if (param.enum) {
          assert.ok(
            param.enum.includes(preferred),
            `${model.slug}.${param.key}: ${preferred} is not a documented value`,
          )
        }
        if (typeof preferred === 'number') {
          assert.ok(preferred >= (param.min ?? -Infinity), `${model.slug}.${param.key} below min`)
          assert.ok(preferred <= (param.max ?? Infinity), `${model.slug}.${param.key} above max`)
        }
      }
    }
  })

  it('leaves every model’s opening form valid', () => {
    for (const model of ALL_MODELS) {
      const opening = openingValues(model)
      const issues = validateInput(model, opening).issues.filter(
        // A blank form is legitimately missing its prompt and input assets;
        // what must not appear is an issue about a value we put there.
        (issue) => issue.key !== undefined && opening[issue.key] !== undefined,
      )
      assert.deepEqual(
        issues,
        [],
        `${model.slug} opens on a value the validator rejects: ${JSON.stringify(issues)}`,
      )
    }
  })
})
