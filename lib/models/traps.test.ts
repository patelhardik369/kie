import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ALL_MODELS, requireModel } from '../kie/registry/index.ts'
import type { ModelDefinition } from '../kie/registry/types.ts'
import { differentiator, findTraps, trapsForModel } from './traps.ts'

const traps = findTraps(ALL_MODELS)
const find = (kind: string, key?: string) =>
  traps.find((t) => t.kind === kind && (key === undefined || t.key === key))

/**
 * These assert against the REAL registry, so they double as a check that the
 * traps the PRD names are still being surfaced as the registry grows.
 */
describe('the traps docs/PRD.md F9 names', () => {
  it('finds that Kling durations are strings but Kling Omni durations are integers', () => {
    const trap = find('type', 'duration')
    assert.ok(trap, 'expected a duration type trap')
    assert.match(trap.detail, /as string:/)
    assert.match(trap.detail, /as number:/)
    assert.ok(trap.models.some((m) => m.startsWith('kling-3.0-omni/')))
    assert.ok(trap.models.some((m) => m.startsWith('kling-2.6/')))
  })

  it('finds that some models use `ratio` rather than `aspect_ratio`', () => {
    const trap = find('naming')
    assert.ok(trap, 'expected a naming trap')
    assert.match(trap.title, /aspect_ratio.*ratio/)
    // Copying a payload across silently drops the field — that is the cost.
    assert.match(trap.detail, /silently drops the field/)
  })

  it('surfaces the registry notes verbatim, for the quirks nothing can derive', () => {
    // Seedream's quality-tier difference is written down, not computable.
    const notes = traps.filter((t) => t.kind === 'note')
    assert.ok(notes.length > 20, `expected many models to carry notes, got ${notes.length}`)

    const withNotes = ALL_MODELS.find((m) => m.notes?.trim())!
    const trap = notes.find((t) => t.models[0] === withNotes.slug)
    assert.ok(trap)
    assert.equal(trap.detail, withNotes.notes!.trim())
  })
})

describe('type traps', () => {
  it('reports the wire type, not the ParamType', () => {
    // An enum of strings and a free-text string are both `string` to the API.
    // Reporting them as different would bury the difference that causes a 422.
    const stringEnum: ModelDefinition = {
      ...requireModel('kling-2.6/text-to-video'),
      slug: 'test/enum-duration',
    }
    const freeString: ModelDefinition = {
      ...requireModel('kling-2.6/text-to-video'),
      slug: 'test/string-duration',
      params: requireModel('kling-2.6/text-to-video').params.map((p) =>
        p.key === 'duration' ? { ...p, type: 'string' as const, enum: undefined } : p,
      ),
    }

    assert.equal(findTraps([stringEnum, freeString]).some((t) => t.kind === 'type'), false)
  })

  it('reports a genuine string-versus-number difference', () => {
    const base = requireModel('kling-2.6/text-to-video')
    const asNumber: ModelDefinition = {
      ...base,
      slug: 'test/number-duration',
      params: base.params.map((p) =>
        p.key === 'duration' ? { ...p, type: 'number' as const, enum: undefined } : p,
      ),
    }

    const found = findTraps([base, asNumber]).filter((t) => t.kind === 'type')
    assert.equal(found.length, 1)
    assert.equal(found[0]!.key, 'duration')
  })
})

describe('enum traps', () => {
  it('ignores a model that merely offers fewer options than its sibling', () => {
    // A strict subset is a capability difference, not a disagreement: nothing
    // valid on the smaller model is rejected by the larger one.
    const base = requireModel('wan/2-7-image')
    const fewer: ModelDefinition = {
      ...base,
      slug: 'test/fewer-resolutions',
      params: base.params.map((p) =>
        p.key === 'resolution' ? { ...p, enum: ['1K', '2K'] } : p,
      ),
    }

    const found = findTraps([base, fewer]).filter(
      (t) => t.kind === 'enum' && t.key === 'resolution',
    )
    assert.deepEqual(found, [])
  })

  it('reports two sets that genuinely diverge', () => {
    const base = requireModel('wan/2-7-image')
    const other: ModelDefinition = {
      ...base,
      slug: 'test/other-resolutions',
      params: base.params.map((p) =>
        p.key === 'resolution' ? { ...p, enum: ['480p', '720p'] } : p,
      ),
    }

    const found = findTraps([base, other]).filter(
      (t) => t.kind === 'enum' && t.key === 'resolution',
    )
    assert.equal(found.length, 1)
    assert.match(found[0]!.detail, /rejected on another/)
  })
})

describe('naming traps', () => {
  it('says nothing when only one spelling is in use', () => {
    // One spelling is not a trap; it is just the name.
    //
    // "declares aspect_ratio" is NOT the same set as "declares only
    // aspect_ratio": google/nano-banana declares its deprecated `image_size`
    // alongside it, which is a genuine trap and would be reported here.
    const siblings = ['ratio', 'image_size']
    const onlyAspectRatio = ALL_MODELS.filter(
      (m) =>
        m.params.some((p) => p.key === 'aspect_ratio') &&
        !m.params.some((p) => siblings.includes(p.key)),
    )
    const found = findTraps(onlyAspectRatio).filter((t) => t.kind === 'naming')
    assert.equal(
      found.some((t) => t.title.includes('ratio`')),
      false,
    )
  })

  it('reports a model that declares two spellings of the same idea itself', () => {
    // The deprecated field stays in the registry, so the browser has to say
    // that setting it and aspect_ratio means setting the same knob twice.
    const found = findTraps(ALL_MODELS).filter(
      (t) => t.kind === 'naming' && t.title.includes('image_size'),
    )
    assert.equal(found.length, 1)
    assert.ok(found[0]!.models.includes('google/nano-banana'))
  })

  it('reports the six spellings of "the image to work from"', () => {
    const found = findTraps(ALL_MODELS).filter(
      (t) => t.kind === 'naming' && t.title.includes('image_input'),
    )
    assert.equal(found.length, 1)
    // Recraft vs Topaz, and Nano Banana 2 vs 2 Lite, are each one character
    // away from a 422.
    for (const key of ['image', 'image_url', 'image_urls', 'input_urls', 'imageUrls']) {
      assert.ok(found[0]!.title.includes(key), key)
    }
  })
})

describe('trapsForModel', () => {
  it('returns only the traps that touch that model', () => {
    const slug = 'kling-3.0-omni/text-to-video'
    const forModel = trapsForModel(slug, traps)

    assert.ok(forModel.length > 0)
    for (const trap of forModel) assert.ok(trap.models.includes(slug))
  })

  it('is empty for a model nothing applies to', () => {
    assert.deepEqual(trapsForModel('not/a-model', traps), [])
  })
})

describe('differentiator', () => {
  it('tells sibling models apart', () => {
    // The capability alone does not distinguish nine Kling text-to-video models.
    const siblings = ALL_MODELS.filter(
      (m) => m.family === 'kling' && m.capability === 'text-to-video',
    )
    assert.ok(siblings.length >= 4)

    const lines = siblings.map(differentiator)
    assert.equal(lines.every((l) => l.length > 0), true, 'every sibling gets a differentiator')
    assert.ok(new Set(lines).size > 1, 'and they are not all identical')
  })

  it('mentions audio when the model can produce it', () => {
    assert.match(differentiator(requireModel('kling-2.6/text-to-video')), /audio/)
  })

  it('returns a string for every model in the registry', () => {
    for (const model of ALL_MODELS) {
      assert.equal(typeof differentiator(model), 'string', model.slug)
    }
  })
})

describe('a trap never lists the same model twice', () => {
  /*
   * Regression: `google/nano-banana` declares BOTH `aspect_ratio` and its
   * superseded `image_size`, so the naming builder — which flattens one slug
   * list per spelling — emitted the slug twice. React rendered it as a
   * duplicate key, and the row's "N models" count was inflated.
   */
  it('holds unique slugs in every trap over the whole registry', () => {
    for (const trap of findTraps(ALL_MODELS)) {
      assert.equal(
        new Set(trap.models).size,
        trap.models.length,
        `${trap.kind} trap "${trap.title}" repeats a model: ${trap.models.join(', ')}`,
      )
    }
  })

  it('lists a model declaring two spellings of one idea exactly once', () => {
    const trap = findTraps(ALL_MODELS).find(
      (t) => t.kind === 'naming' && t.title.includes('image_size'),
    )!
    const appearances = trap.models.filter((s) => s === 'google/nano-banana')
    assert.equal(appearances.length, 1)
  })

  it('says so when a model carries more than one spelling itself', () => {
    // The generic "the receiving model has never heard of that key" is wrong
    // for these — they have heard of both.
    const trap = findTraps(ALL_MODELS).find(
      (t) => t.kind === 'naming' && t.title.includes('image_size'),
    )!
    assert.match(trap.detail, /declare more than one of these spellings/)
    assert.match(trap.detail, /google\/nano-banana/)
  })

  it('leaves the note describing a clean cross-model split alone', () => {
    // Nothing declares both `ratio` and `aspect_ratio`, so that half of the
    // group must not gain the extra sentence.
    const ratioOnly = ALL_MODELS.filter(
      (m) =>
        m.params.some((p) => p.key === 'ratio') ||
        (m.params.some((p) => p.key === 'aspect_ratio') &&
          !m.params.some((p) => p.key === 'image_size')),
    )
    const trap = findTraps(ratioOnly).find((t) => t.kind === 'naming')!
    assert.ok(!/declare/.test(trap.detail), trap.detail)
  })
})
