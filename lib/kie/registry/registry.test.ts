import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { FAMILIES as DB_FAMILIES } from '../../db/schema.ts'
import {
  ALL_MODELS,
  BYTEDANCE_MODELS,
  CAPABILITIES,
  ENHANCE_MODELS,
  FAMILIES,
  GOOGLE_MODELS,
  KLING_MODELS,
  OPENAI_MODELS,
  WAN_MODELS,
  capabilitiesOf,
  flattenParams,
  getModel,
  modelsByCapability,
  modelsByFamily,
  requireModel,
  transportOf,
  type ModelDefinition,
  type ParamDef,
} from './index.ts'

describe('catalog completeness', () => {
  it('holds all 82 in-scope models', () => {
    assert.equal(KLING_MODELS.length, 19)
    assert.equal(BYTEDANCE_MODELS.length, 20)
    assert.equal(WAN_MODELS.length, 20)
    assert.equal(GOOGLE_MODELS.length, 14)
    assert.equal(OPENAI_MODELS.length, 4)
    assert.equal(ENHANCE_MODELS.length, 5)
    assert.equal(ALL_MODELS.length, 82)
  })

  it('splits Google 5 video / 8 image / 1 audio', () => {
    assert.equal(GOOGLE_MODELS.filter((m) => m.outputKind === 'video').length, 5)
    assert.equal(GOOGLE_MODELS.filter((m) => m.outputKind === 'image').length, 8)
    assert.equal(GOOGLE_MODELS.filter((m) => m.outputKind === 'audio').length, 1)
  })

  it('splits Enhance 3 image / 2 video', () => {
    assert.equal(ENHANCE_MODELS.filter((m) => m.outputKind === 'image').length, 3)
    assert.equal(ENHANCE_MODELS.filter((m) => m.outputKind === 'video').length, 2)
  })

  /*
   * The db schema keeps its own copy of FAMILIES so drizzle-kit can load it
   * without pulling in the registry. Nothing enforces that at the type level, so
   * it is enforced here — a family added to one and not the other writes rows
   * the gallery filter cannot see.
   */
  it('keeps the db schema family list in step with the registry', () => {
    assert.deepEqual([...DB_FAMILIES], [...FAMILIES])
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
    for (const m of GOOGLE_MODELS) assert.equal(m.family, 'google', m.slug)
    for (const m of OPENAI_MODELS) assert.equal(m.family, 'openai', m.slug)
    for (const m of ENHANCE_MODELS) assert.equal(m.family, 'enhance', m.slug)
  })

  it('populates docUrl for every model', () => {
    for (const m of ALL_MODELS) {
      assert.ok(m.docUrl, `${m.slug} has no docUrl`)
      // Veo is documented outside /market — it predates the market catalog.
      const pattern =
        transportOf(m) === 'veo'
          ? /^https:\/\/docs\.kie\.ai\/veo3-api\/.+\.md$/
          : /^https:\/\/docs\.kie\.ai\/market\/.+\.md$/
      assert.match(m.docUrl, pattern, m.slug)
    }
  })

  it('keeps the veo transport to the three Veo models', () => {
    const veo = ALL_MODELS.filter((m) => transportOf(m) === 'veo').map((m) => m.slug)
    assert.deepEqual(veo, ['veo3', 'veo3_fast', 'veo3_lite'])
    // Everything else must not declare one at all, so `jobs` stays the default
    // rather than something each new model has to remember to write.
    for (const m of ALL_MODELS) {
      if (veo.includes(m.slug)) continue
      assert.equal(m.transport, undefined, `${m.slug} declares a transport`)
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

  it('keeps the vendor prefix off the slugs that do not have one', () => {
    // The doc pages live under market/google/ and market/gpt/, but the `model`
    // enum on those pages is unprefixed. Adding the prefix back is a 422.
    assert.ok(getModel('nano-banana-2'), 'unprefixed Nano Banana 2')
    assert.ok(getModel('nano-banana-2-lite'))
    assert.ok(getModel('nano-banana-pro'))
    assert.ok(getModel('gpt-image-2-text-to-image'))
    assert.equal(getModel('google/nano-banana-2'), undefined)
    assert.equal(getModel('gpt/gpt-image-2-text-to-image'), undefined)

    // …while its own predecessor IS prefixed.
    assert.ok(getModel('google/nano-banana'), 'prefixed Nano Banana 1')
    assert.equal(getModel('nano-banana'), undefined)
  })

  it('keeps the dot in GPT Image 1.5 and the underscores in Veo', () => {
    assert.ok(getModel('gpt-image/1.5-text-to-image'))
    assert.equal(getModel('gpt-image/1-5-text-to-image'), undefined)
    assert.ok(getModel('veo3_fast'))
    assert.equal(getModel('veo3-fast'), undefined)
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
    assert.equal(modelsByFamily('google').length, 14)
    assert.equal(modelsByFamily('openai').length, 4)
    assert.equal(modelsByFamily('enhance').length, 5)
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

  it('types Imagen 4 seed as a string but Imagen 4 Fast seed as a number', () => {
    const seedOf = (slug: string) =>
      getModel(slug)!.params.find((p) => p.key === 'seed')!
    assert.equal(seedOf('google/imagen4').type, 'string')
    assert.equal(seedOf('google/imagen4-ultra').type, 'string')
    // `seed` (not `string`) is what renders the dice and validates as a number.
    assert.equal(seedOf('google/imagen4-fast').type, 'seed')
  })

  it('spells Nano Banana 1 output "jpeg" and Nano Banana 2 output "jpg"', () => {
    const formatOf = (slug: string) =>
      getModel(slug)!.params.find((p) => p.key === 'output_format')!
    assert.deepEqual(formatOf('google/nano-banana').enum, ['png', 'jpeg'])
    assert.deepEqual(formatOf('nano-banana-2').enum, ['png', 'jpg'])
    assert.deepEqual(formatOf('nano-banana-pro').enum, ['png', 'jpg'])
  })

  it('names the Nano Banana image input differently per generation', () => {
    const has = (slug: string, key: string) =>
      getModel(slug)!.params.some((p) => p.key === key)
    assert.ok(has('google/nano-banana-edit', 'image_urls'))
    assert.ok(has('nano-banana-2', 'image_input'))
    assert.ok(has('nano-banana-pro', 'image_input'))
    // The Lite tier breaks its own generation's convention.
    assert.ok(has('nano-banana-2-lite', 'image_urls'))
    assert.ok(!has('nano-banana-2-lite', 'image_input'))
  })

  it('keeps the deprecated fields reachable rather than dropping them', () => {
    const imageSize = getModel('google/nano-banana')!.params.find(
      (p) => p.key === 'image_size',
    )!
    assert.equal(imageSize.deprecated, true)
    const fallback = getModel('veo3')!.params.find((p) => p.key === 'enableFallback')!
    assert.equal(fallback.deprecated, true)
  })

  it('offers reference-to-video on the fast and lite Veo tiers only', () => {
    const typesOf = (slug: string) =>
      getModel(slug)!.params.find((p) => p.key === 'generationType')!.enum!
    assert.ok(!typesOf('veo3').includes('REFERENCE_2_VIDEO'))
    assert.ok(typesOf('veo3_fast').includes('REFERENCE_2_VIDEO'))
    assert.ok(typesOf('veo3_lite').includes('REFERENCE_2_VIDEO'))
  })

  it('keeps Veo`s capital Auto and its camelCase imageUrls', () => {
    const veo = getModel('veo3')!
    assert.deepEqual(
      veo.params.find((p) => p.key === 'aspect_ratio')!.enum,
      ['16:9', '9:16', 'Auto'],
    )
    assert.ok(veo.params.some((p) => p.key === 'imageUrls'))
    assert.ok(!veo.params.some((p) => p.key === 'image_urls'))
  })

  it('names every enhance model`s input field differently, as documented', () => {
    const inputKey = (slug: string) => getModel(slug)!.params[0]!.key
    assert.equal(inputKey('topaz/image-upscale'), 'image_url')
    assert.equal(inputKey('recraft/crisp-upscale'), 'image')
    assert.equal(inputKey('recraft/remove-background'), 'image')
    assert.equal(inputKey('topaz/video-upscale'), 'video_url')
    assert.equal(inputKey('grok-imagine/upscale'), 'task_id')
  })

  it('requires the Topaz upscale factor on images but not on video', () => {
    const factorOf = (slug: string) =>
      getModel(slug)!.params.find((p) => p.key === 'upscale_factor')!
    assert.equal(factorOf('topaz/image-upscale').required, true)
    assert.equal(factorOf('topaz/video-upscale').required, undefined)
    // Same enum and default either way — only requiredness differs.
    assert.deepEqual(factorOf('topaz/image-upscale').enum, ['1', '2', '4'])
    assert.equal(factorOf('topaz/video-upscale').default, '2')
  })

  it('records the grok-imagine/upscale source-model ambiguity', () => {
    assert.match(getModel('grok-imagine/upscale')!.notes ?? '', /DOC AMBIGUITY/)
  })

  it('gives Gemini TTS no prompt at all', () => {
    const tts = getModel('google/gemini-3-1-flash-tts')!
    assert.ok(!tts.params.some((p) => p.key === 'prompt'))
    assert.equal(tts.outputKind, 'audio')
  })

  it('types the Gemini Omni id lists as opaque strings, not URLs', () => {
    const omni = getModel('gemini-omni-video')!
    // They come from /omni/audio/create and /omni/character/create, so an
    // upload button would promise a path that does not exist.
    assert.equal(omni.params.find((p) => p.key === 'audio_ids')!.type, 'string[]')
    assert.equal(omni.params.find((p) => p.key === 'character_ids')!.type, 'string[]')
  })
})

describe('allowedValuesWhen narrows, never invents', () => {
  it('only ever narrows to values the parameter already declares', () => {
    for (const model of ALL_MODELS) {
      for (const c of model.constraints ?? []) {
        if (c.kind !== 'allowedValuesWhen') continue
        for (const key of c.keys) {
          const param = model.params.find((p) => p.key === key)!
          if (!param.enum) continue
          for (const value of c.values) {
            assert.ok(
              param.enum.includes(value),
              `${model.slug}.${key}: ${JSON.stringify(value)} is not in its enum`,
            )
          }
        }
      }
    }
  })

  it('gates GPT Image 2 resolution on the chosen aspect ratio', () => {
    const model = getModel('gpt-image-2-text-to-image')!
    const gates = (model.constraints ?? []).filter(
      (c) => c.kind === 'allowedValuesWhen',
    )
    // auto -> 1K, unset -> 1K, 1:1 -> no 4K, plus the five 1K-only ratios.
    assert.equal(gates.length, 8)
    const square = gates.find(
      (c) => 'when' in c && c.when.key === 'aspect_ratio' && c.when.equals === '1:1',
    )!
    assert.deepEqual(square.kind === 'allowedValuesWhen' ? square.values : [], [
      '1K',
      '2K',
    ])
  })

  it('restricts fewer ratios on GPT Image 2 image-to-image than text-to-image', () => {
    const count = (slug: string) =>
      (getModel(slug)!.constraints ?? []).filter((c) => c.kind === 'allowedValuesWhen')
        .length
    assert.equal(count('gpt-image-2-text-to-image'), 8)
    assert.equal(count('gpt-image-2-image-to-image'), 5)
  })
})
