import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getModel, requireModel } from '../kie/registry/index.ts'
import type { ModelDefinition, ParamDef } from '../kie/registry/types.ts'
import {
  MAX_SWEEP_RUNS,
  SweepError,
  describeSweep,
  expandSweep,
  hasSeed,
  parseSweepValues,
  randomSeeds,
  sweepableParams,
} from './sweep.ts'

/** A counting rng, so seed expansion is deterministic under test. */
function sequence(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]!
}

/** A model that actually has a seed, found in the registry rather than invented. */
const seeded: ModelDefinition = (() => {
  const model = getModel('wan/2-7-image')
  assert.ok(model && hasSeed(model), 'expected wan/2-7-image to expose a seed')
  return model
})()

const param = (model: ModelDefinition, key: string): ParamDef => {
  const found = model.params.find((p) => p.key === key)
  assert.ok(found, `expected ${model.slug} to have ${key}`)
  return found
}

describe('expandSweep — Generate xN', () => {
  it('gives every run its own seed', () => {
    const runs = expandSweep(seeded, { prompt: 'a lemon' }, { kind: 'count', count: 5 }, {
      random: sequence([0.1, 0.2, 0.3, 0.4, 0.5]),
    })

    assert.equal(runs.length, 5)
    const seeds = runs.map((r) => r.seed)
    assert.equal(new Set(seeds).size, 5, 'a repeated seed is a repeated output')
    // Everything else is held fixed.
    for (const run of runs) assert.equal(run.prompt, 'a lemon')
  })

  it('never mutates the base input', () => {
    const base = { prompt: 'a lemon', seed: 7 }
    expandSweep(seeded, base, { kind: 'count', count: 3 })
    assert.deepEqual(base, { prompt: 'a lemon', seed: 7 })
  })

  it('returns independent objects, not shared references', () => {
    // Two runs sharing an object would share an input_json, and the second
    // would silently record the first's parameters.
    const runs = expandSweep(seeded, { prompt: 'a' }, { kind: 'count', count: 2 })
    runs[0]!.prompt = 'changed'
    assert.equal(runs[1]!.prompt, 'a')
  })

  it('repeats identically when the model has no seed to vary', () => {
    const noSeed = requireModel('kling-2.6/text-to-video')
    assert.equal(hasSeed(noSeed), false)

    const runs = expandSweep(noSeed, { prompt: 'a lemon' }, { kind: 'count', count: 3 })
    assert.equal(runs.length, 3)
    assert.deepEqual(runs[0], runs[1])
    // And the form says so rather than implying variation it cannot deliver.
    assert.match(describeSweep(noSeed, { kind: 'count', count: 3 }), /no seed to vary/)
  })

  it('rejects a batch below one or above the cap', () => {
    assert.throws(() => expandSweep(seeded, {}, { kind: 'count', count: 0 }), SweepError)
    assert.throws(
      () => expandSweep(seeded, {}, { kind: 'count', count: MAX_SWEEP_RUNS + 1 }),
      SweepError,
    )
  })
})

describe('expandSweep — one varied parameter', () => {
  it('varies only the swept key', () => {
    const runs = expandSweep(
      seeded,
      { prompt: 'a lemon', resolution: '2K', seed: 42 },
      { kind: 'values', key: 'resolution', values: ['1K', '2K', '4K'] },
    )

    assert.deepEqual(
      runs.map((r) => r.resolution),
      ['1K', '2K', '4K'],
    )
    for (const run of runs) {
      assert.equal(run.prompt, 'a lemon')
      assert.equal(run.seed, 42, 'a sweep holds everything else fixed')
    }
  })

  it('overwrites a value already in the base', () => {
    const runs = expandSweep(
      seeded,
      { n: 4 },
      { kind: 'values', key: 'n', values: [1, 2] },
    )
    assert.deepEqual(runs.map((r) => r.n), [1, 2])
  })

  it('refuses a key the model does not have', () => {
    assert.throws(
      () => expandSweep(seeded, {}, { kind: 'values', key: 'cfg_scale', values: [1] }),
      /has no parameter "cfg_scale"/,
    )
  })

  it('refuses an empty value list', () => {
    assert.throws(
      () => expandSweep(seeded, {}, { kind: 'values', key: 'n', values: [] }),
      SweepError,
    )
  })
})

describe('sweepableParams', () => {
  it('offers the parameters with a listable domain', () => {
    const keys = sweepableParams(seeded).map((p) => p.key)
    assert.ok(keys.includes('seed'))
    assert.ok(keys.includes('resolution'))
    assert.ok(keys.includes('n'))
    // A prompt or an asset URL has no range to sweep.
    assert.ok(!keys.includes('prompt'))
    assert.ok(!keys.includes('input_urls'))
  })
})

describe('parseSweepValues', () => {
  it('parses a comma-separated numeric list', () => {
    assert.deepEqual(parseSweepValues(param(seeded, 'n'), '1, 2, 4').values, [1, 2, 4])
  })

  it('parses an inclusive numeric range', () => {
    assert.deepEqual(parseSweepValues(param(seeded, 'n'), '1..4').values, [1, 2, 3, 4])
  })

  it('parses a range with a step, including its end', () => {
    // Float accumulation must not drop 0.5 off the end.
    const values = parseSweepValues(param(seeded, 'n'), '0.1..0.5:0.1').values
    assert.deepEqual(values, [0.1, 0.2, 0.3, 0.4, 0.5])
  })

  it('keeps an enum value in its documented type', () => {
    // The distinction a 422 is usually about: "5" the string is not 5 the number.
    const resolution = param(seeded, 'resolution')
    const parsed = parseSweepValues(resolution, '1K,2K')
    assert.deepEqual(parsed.values, ['1K', '2K'])
    for (const v of parsed.values) assert.equal(typeof v, 'string')
  })

  it('rejects a value outside the enum, and names the options', () => {
    const parsed = parseSweepValues(param(seeded, 'resolution'), '8K')
    assert.deepEqual(parsed.values, [])
    assert.match(parsed.error!, /not one of/)
  })

  it('parses booleans', () => {
    const parsed = parseSweepValues(param(seeded, 'watermark'), 'true,false')
    assert.deepEqual(parsed.values, [true, false])
  })

  it('rejects a non-boolean for a boolean parameter', () => {
    assert.match(parseSweepValues(param(seeded, 'watermark'), 'yes').error!, /true or false/)
  })

  it('rejects a range on a non-numeric parameter', () => {
    assert.match(parseSweepValues(param(seeded, 'resolution'), '1..3').error!, /not numeric/)
  })

  it('rejects a non-number in a numeric list', () => {
    assert.match(parseSweepValues(param(seeded, 'n'), '1,two').error!, /not a number/)
  })

  it('rejects a range that would exceed the cap', () => {
    assert.match(parseSweepValues(param(seeded, 'seed'), '1..500').error!, /more than/)
  })

  it('rejects a backwards range and a zero step', () => {
    assert.match(parseSweepValues(param(seeded, 'n'), '5..1').error!, /ends? at or above/)
    assert.match(parseSweepValues(param(seeded, 'n'), '1..5:0').error!, /greater than zero/)
  })

  it('returns nothing for empty input, without an error', () => {
    assert.deepEqual(parseSweepValues(param(seeded, 'n'), '   '), { values: [] })
  })
})

describe('randomSeeds', () => {
  it('returns the requested count, all distinct', () => {
    const seeds = randomSeeds(8)
    assert.equal(seeds.length, 8)
    assert.equal(new Set(seeds).size, 8)
  })

  it('terminates even when the rng never varies', () => {
    // A degenerate rng must not hang the request.
    const seeds = randomSeeds(4, () => 0.5)
    assert.equal(seeds.length, 4)
    assert.equal(new Set(seeds).size, 4)
  })

  it('stays inside the range the dice button uses', () => {
    for (const seed of randomSeeds(20)) {
      assert.ok(Number.isInteger(seed) && seed >= 0 && seed < 2_147_483_647)
    }
  })
})
