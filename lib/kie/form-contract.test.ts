import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'

import { deriveFields } from './constraints.ts'
import { ALL_MODELS, FAMILIES, requireModel } from './registry/index.ts'
import type { ParamType } from './registry/types.ts'

/**
 * Phase 3's exit criterion, checked mechanically:
 * all 97 models render from one generic form with NO model-specific branches.
 */

const COMPONENT_DIR = path.join(process.cwd(), 'components', 'param-form')

function componentSources(): { file: string; source: string }[] {
  return fs
    .readdirSync(COMPONENT_DIR)
    .filter((f) => f.endsWith('.tsx'))
    .map((file) => ({
      file,
      source: fs.readFileSync(path.join(COMPONENT_DIR, file), 'utf8'),
    }))
}

describe('no model-specific branches in component code', () => {
  it('mentions no model slug anywhere in the form components', () => {
    const sources = componentSources()
    assert.ok(sources.length >= 3, 'expected the param-form components to exist')

    for (const { file, source } of sources) {
      for (const model of ALL_MODELS) {
        assert.ok(
          !source.includes(model.slug),
          `${file} references model slug ${model.slug}`,
        )
      }
    }
  })

  it('branches on no family name', () => {
    for (const { file, source } of componentSources()) {
      for (const family of FAMILIES) {
        // Allow the word inside prose comments, not inside code comparisons.
        const codeUse = new RegExp(`['"\`]${family}['"\`]`)
        assert.ok(!codeUse.test(source), `${file} compares against family "${family}"`)
      }
    }
  })

  it('references no model-specific parameter key', () => {
    // Keys that only some models declare — a control keyed off one of these
    // would be a hidden special case.
    const suspects = [
      'kling_elements',
      'multi_prompt',
      'first_frame_url',
      'reference_image_urls',
      'thinking_mode',
      'enable_sequential',
      'customize_multi_shots',
      'bbox_list',
      'color_palette',
    ]
    for (const { file, source } of componentSources()) {
      // Strip comments first: naming an example key in prose is documentation,
      // whereas a quoted literal or property access would be a real branch.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/^\s*\/\/.*$/gm, '')

      for (const key of suspects) {
        const codeUse = new RegExp(`['"\`.]${key}\\b`)
        assert.ok(!codeUse.test(code), `${file} branches on parameter key ${key}`)
      }
    }
  })
})

describe('the schema layer covers every parameter in the registry', () => {
  const HANDLED: ParamType[] = [
    'text',
    'string',
    'enum',
    'number',
    'boolean',
    'url',
    'url[]',
    'string[]',
    'seed',
    'object[]',
    'color[]',
    'bbox[][]',
  ]

  it('uses only types the Field dispatch handles', () => {
    for (const model of ALL_MODELS) {
      for (const param of model.params) {
        assert.ok(HANDLED.includes(param.type), `${model.slug}.${param.key}: ${param.type}`)
        for (const field of param.fields ?? []) {
          assert.ok(
            HANDLED.includes(field.type),
            `${model.slug}.${param.key}.${field.key}: ${field.type}`,
          )
        }
      }
    }
  })

  it('has a control for every declared ParamType', () => {
    // If a type is declared but never used, the control still has to exist —
    // otherwise the next model to use it silently renders nothing.
    const { source } = componentSources().find((s) => s.file === 'Field.tsx')!
    for (const type of HANDLED) {
      assert.ok(source.includes(`case '${type}'`), `Field.tsx has no case for ${type}`)
    }
  })
})

describe('the four hardest models', () => {
  it('kling-3.0/video exposes both repeating groups', () => {
    const model = requireModel('kling-3.0/video')
    const elements = model.params.find((p) => p.key === 'kling_elements')!
    const shots = model.params.find((p) => p.key === 'multi_prompt')!

    assert.equal(elements.type, 'object[]')
    assert.equal(shots.type, 'object[]')
    assert.equal(elements.fields?.length, 6)
    assert.equal(shots.fields?.length, 2)

    // Shots become required the moment multi-shot is switched on.
    assert.equal(deriveFields(model, { multi_shots: true }).multi_prompt!.required, true)
  })

  it('kling-3.0-omni/reference-to-video keeps all three input scenarios reachable', () => {
    const model = requireModel('kling-3.0-omni/reference-to-video')

    // Neither reference input may be disabled up front, or the requiresOneOf
    // rule would be impossible to satisfy.
    const fresh = deriveFields(model, {})
    assert.equal(fresh.image_urls!.disabled, false)
    assert.equal(fresh.video_urls!.disabled, false)

    // Images and video may be combined (scenario three).
    const both = deriveFields(model, {
      image_urls: ['https://x/a.png'],
      video_urls: ['https://x/a.mp4'],
    })
    assert.equal(both.image_urls!.disabled, false)
    assert.equal(both.video_urls!.disabled, false)
  })

  it('wan/3-0-video cross-excludes its seven input arrays correctly', () => {
    const model = requireModel('wan/3-0-video')
    const inputs = [
      'first_frame_url',
      'last_frame_url',
      'reference_image_urls',
      'reference_video_urls',
      'reference_audio_urls',
      'reference_file_urls',
      'reference_link_urls',
    ]
    for (const key of inputs) {
      assert.ok(model.params.some((p) => p.key === key), `missing ${key}`)
    }

    const withFrame = deriveFields(model, { first_frame_url: 'https://x/a.png' })
    assert.equal(withFrame.reference_image_urls!.disabled, true)
    assert.equal(withFrame.reference_link_urls!.disabled, true)
    assert.equal(withFrame.last_frame_url!.disabled, false)

    const withRefs = deriveFields(model, { reference_image_urls: ['https://x/a.png'] })
    assert.equal(withRefs.first_frame_url!.disabled, true)
    // Same group — still combinable.
    assert.equal(withRefs.reference_audio_urls!.disabled, false)
  })

  it('wan/2-7-image adjusts both its conditional rules', () => {
    const model = requireModel('wan/2-7-image')

    const standard = deriveFields(model, { enable_sequential: false })
    assert.equal(standard.n!.max, 4)
    assert.equal(standard.thinking_mode!.disabled, false)

    const sequential = deriveFields(model, { enable_sequential: true })
    assert.equal(sequential.n!.max, 12)
    assert.equal(sequential.thinking_mode!.disabled, true)
    assert.ok(sequential.thinking_mode!.reason)
  })
})

describe('every model is usable out of the box', () => {
  it('has at least one always-visible parameter', () => {
    for (const model of ALL_MODELS) {
      const visible = model.params.filter(
        (p) => p.group === 'core' || p.group === 'framing',
      )
      assert.ok(visible.length > 0, `${model.slug} renders nothing above the fold`)
    }
  })

  it('never leaves a model with zero editable parameters', () => {
    for (const model of ALL_MODELS) {
      const fields = deriveFields(model, {})
      const editable = model.params.filter((p) => !fields[p.key]!.disabled)
      assert.ok(editable.length > 0, model.slug)
    }
  })
})
