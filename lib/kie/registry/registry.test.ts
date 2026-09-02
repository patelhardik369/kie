import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ALL_MODELS,
  BYTEDANCE_MODELS,
  CAPABILITIES,
  KLING_MODELS,
  WAN_MODELS,
  capabilitiesOf,
  flattenParams,
  getModel,
  modelsByCapability,
  modelsByFamily,
  requireModel,
  type ModelDefinition,
  type ParamDef,
} from './index.ts'

describe('catalog completeness', () => {
  it('holds all 59 in-scope models', () => {
    assert.equal(KLING_MODELS.length, 19)
    assert.equal(BYTEDANCE_MODELS.length, 20)
    assert.equal(WAN_MODELS.length, 20)
    assert.equal(ALL_MODELS.length, 59)
  })

  it('has 20 ByteDance models split 10 video / 10 image', () => {
    const video = BYTEDANCE_MODELS.filter((m) => m.outputKind === 'video')
    const image = BYTEDANCE_MODELS.filter((m) => m.outputKind === 'image')
    assert.equal(video.length, 10)
    assert.equal(image.length, 10)
  })

  it('has 20 Wan models split 18 video / 2 image', () => {
    assert.equal(WAN_MODELS.filter((m) => m.outputKind === 'video').length, 18)
    assert.equal(WAN_MODELS.filter((m) => m.outputKind === 'image').length, 2)
  })

  it('gives every model a unique slug', () => {
    const slugs = ALL_MODELS.map((m) => m.slug)
    assert.equal(new Set(slugs).size, slugs.length)
  })

  it('files every model under the family its list belongs to', () => {
    for (const m of KLING_MODELS) assert.equal(m.family, 'kling', m.slug)
    for (const m of BYTEDANCE_MODELS) assert.equal(m.family, 'bytedance', m.slug)
    for (const m of WAN_MODELS) assert.equal(m.family, 'wan', m.slug)
  })

  it('populates docUrl for every model', () => {
    for (const m of ALL_MODELS) {
      assert.ok(m.docUrl, `${m.slug} has no docUrl`)
      assert.match(m.docUrl, /^https:\/\/docs\.kie\.ai\/market\/.+\.md$/, m.slug)
    }
  })

  it('uses only declared capabilities', () => {
    for (const m of ALL_MODELS) {
      for (const capability of capabilitiesOf(m)) {
        assert.ok(CAPABILITIES.includes(capability), `${m.slug}: ${capability}`)
      }
    }
  })

  it('never repeats a capability between primary and alsoSupports', () => {
    for (const m of ALL_MODELS) {
      const all = capabilitiesOf(m)
      assert.equal(new Set(all).size, all.length, m.slug)
    }
  })
})

describe('slugs are verbatim', () => {
  it('keeps the punctuation that differs between sibling models', () => {
    // These look like typos and are not. See references/bytedance.md.
    assert.ok(getModel('bytedance/seedance-1.5-pro'), 'dot-versioned slug')
    assert.ok(getModel('bytedance/seedance-2-5'), 'dash-versioned slug')
    assert.ok(getModel('seedream/4.5-edit'), 'bare seedream prefix with a dot')
    assert.ok(getModel('bytedance/seedream-v4-edit'), 'bytedance prefix')
  })

  it('keeps the kling-2.6 and omni prefixes', () => {
    assert.ok(getModel('kling-2.6/text-to-video'))
    assert.ok(getModel('kling-3.0-omni/reference-to-video'))
    assert.ok(getModel('kling-3.0/video'))
    // The bare `kling/text-to-video` form does NOT exist.
    assert.equal(getModel('kling/text-to-video'), undefined)
  })
})

describe('parameter shape', () => {
  function eachParam(fn: (param: ParamDef, model: ModelDefinition) => void) {
    for (const model of ALL_MODELS) {
      for (const param of flattenParams(model)) fn(param, model)
    }
  }

  it('gives every parameter a key, label, describe and group', () => {
    eachParam((p, m) => {
      assert.ok(p.key, `${m.slug}: parameter without a key`)
      assert.ok(p.label, `${m.slug}.${p.key}: no label`)
      assert.ok(p.describe, `${m.slug}.${p.key}: no describe`)
      assert.ok(p.group, `${m.slug}.${p.key}: no group`)
    })
  })

  it('has no duplicate parameter keys within a model', () => {
    for (const model of ALL_MODELS) {
      const keys = model.params.map((p) => p.key)
      assert.equal(new Set(keys).size, keys.length, model.slug)
    }
  })

  it('gives every enum parameter a non-empty enum', () => {
    eachParam((p, m) => {
      if (p.type === 'enum') {
        assert.ok(p.enum && p.enum.length > 0, `${m.slug}.${p.key}`)
      }
    })
  })

  it('only ever defaults to a value inside the enum', () => {
    eachParam((p, m) => {
      if (p.enum && p.default !== undefined) {
        assert.ok(
          p.enum.includes(p.default as string | number),
          `${m.slug}.${p.key}: default ${JSON.stringify(p.default)} not in enum`,
        )
      }
    })
  })

  it('keeps numeric defaults inside their documented range', () => {
    eachParam((p, m) => {
      if (typeof p.default !== 'number') return
      if (p.min !== undefined) {
        assert.ok(p.default >= p.min, `${m.slug}.${p.key} default below min`)
      }
      if (p.max !== undefined) {
        assert.ok(p.default <= p.max, `${m.slug}.${p.key} default above max`)
      }
    })
  })

  it('keeps min below max everywhere', () => {
    eachParam((p, m) => {
      if (p.min !== undefined && p.max !== undefined) {
        assert.ok(p.min < p.max, `${m.slug}.${p.key}`)
      }
      if (p.minItems !== undefined && p.maxItems !== undefined) {
        assert.ok(p.minItems <= p.maxItems, `${m.slug}.${p.key}`)
      }
      if (p.minLength !== undefined && p.maxLength !== undefined) {
        assert.ok(p.minLength <= p.maxLength, `${m.slug}.${p.key}`)
      }
    })
  })

  it('gives every object[] parameter its field definitions', () => {
    eachParam((p, m) => {
      if (p.type === 'object[]') {
        assert.ok(p.fields && p.fields.length > 0, `${m.slug}.${p.key}`)
      }
    })
  })

  it('never declares an empty accept list', () => {
    eachParam((p, m) => {
      if (p.accept) assert.ok(p.accept.length > 0, `${m.slug}.${p.key}`)
    })
  })

  it('requires a prompt on every generation model that takes one', () => {
    // Only three models make the prompt optional, all documented as such.
    const optionalPrompt = ALL_MODELS.filter((m) => {
      const p = m.params.find((x) => x.key === 'prompt')
      return p && !p.required
    }).map((m) => m.slug)

    assert.deepEqual(optionalPrompt.sort(), [
      'kling-2.6/motion-control',
      'kling-3.0/motion-control',
      'kling-3.0/video',
      'seedream/5-pro-layer-decomposition',
      'wan/2-7-videoedit',
    ])
  })
})

describe('constraints reference real parameters', () => {
  it('names only keys the model actually declares', () => {
    for (const model of ALL_MODELS) {
      const keys = new Set(model.params.map((p) => p.key))
      for (const c of model.constraints ?? []) {
        const referenced: string[] = []
        if ('keys' in c) referenced.push(...c.keys)
        if ('groups' in c) referenced.push(...c.groups.flat())
        if ('requires' in c) referenced.push(c.requires)
        if ('when' in c) referenced.push(c.when.key)

        for (const key of referenced) {
          assert.ok(keys.has(key), `${model.slug}: constraint references unknown "${key}"`)
        }
      }
    }
  })

  it('gives every constraint a user-facing message', () => {
    for (const model of ALL_MODELS) {
      for (const c of model.constraints ?? []) {
        assert.ok(c.message.length > 10, `${model.slug}: ${c.kind} message too terse`)
      }
    }
  })
})

describe('lookups', () => {
  it('finds a model by slug', () => {
    assert.equal(getModel('wan/3-0-video')?.family, 'wan')
    assert.equal(getModel('nope/does-not-exist'), undefined)
  })

  it('throws a useful error for an unknown slug', () => {
    assert.throws(() => requireModel('kling/nope'), /Unknown model "kling\/nope"/)
  })

  it('filters by family', () => {
    assert.equal(modelsByFamily('kling').length, 19)
    assert.equal(modelsByFamily('bytedance').length, 20)
    assert.equal(modelsByFamily('wan').length, 20)
  })

  it('includes secondary modes when filtering by capability', () => {
    const imageToVideo = modelsByCapability('image-to-video').map((m) => m.slug)
    // Primary capability.
    assert.ok(imageToVideo.includes('kling-2.6/image-to-video'))
    // Declared via alsoSupports.
    assert.ok(imageToVideo.includes('bytedance/seedance-2'))
  })

  it('covers every capability with at least one model', () => {
    for (const capability of CAPABILITIES) {
      assert.ok(
        modelsByCapability(capability).length > 0,
        `no model serves ${capability}`,
      )
    }
  })
})

describe('documented traps are encoded', () => {
  it('keeps Kling duration a string but Omni duration a number', () => {
    const kling = getModel('kling/v2-1-standard')!.params.find((p) => p.key === 'duration')!
    const omni = getModel('kling-3.0-omni/text-to-video')!.params.find(
      (p) => p.key === 'duration',
    )!
    assert.equal(kling.type, 'enum')
    assert.deepEqual(kling.enum, ['5', '10'])
    assert.equal(omni.type, 'number')
  })

  it('names Wan 2.7 text-to-video`s aspect field `ratio`', () => {
    const model = getModel('wan/2-7-text-to-video')!
    assert.ok(model.params.some((p) => p.key === 'ratio'))
    assert.ok(!model.params.some((p) => p.key === 'aspect_ratio'))
  })

  it('uses uppercase resolution on Wan 3.0 only', () => {
    const wan30 = getModel('wan/3-0-video')!.params.find((p) => p.key === 'resolution')!
    const wan26 = getModel('wan/2-6-text-to-video')!.params.find((p) => p.key === 'resolution')!
    assert.deepEqual(wan30.enum, ['480P', '720P', '1080P'])
    assert.deepEqual(wan26.enum, ['720p', '1080p'])
  })

  it('keeps Seedream Pro quality tiers lower than Lite', () => {
    const pro = getModel('seedream/5-pro-text-to-image')!.params.find(
      (p) => p.key === 'quality',
    )!
    const lite = getModel('seedream/5-lite-text-to-image')!.params.find(
      (p) => p.key === 'quality',
    )!
    assert.deepEqual(pro.enum, ['basic', 'high'])
    assert.deepEqual(lite.enum, ['basic', 'high', 'ultra'])
  })

  it('models wan/2-7-r2v reference fields as arrays despite singular names', () => {
    const model = getModel('wan/2-7-r2v')!
    assert.equal(model.params.find((p) => p.key === 'reference_image')!.type, 'url[]')
    assert.equal(model.params.find((p) => p.key === 'reference_video')!.type, 'url[]')
  })

  it('records the Kling 2.6 motion-control doc conflict', () => {
    assert.match(getModel('kling-2.6/motion-control')!.notes ?? '', /DOC CONFLICT/)
  })
})
