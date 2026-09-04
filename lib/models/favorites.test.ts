import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getModel } from '../kie/registry/index.ts'
import { applyOrder, move, resolvePins } from './favorites.ts'

describe('resolvePins', () => {
  it('orders by stored position and renumbers contiguously', () => {
    const pins = resolvePins(
      [
        { slug: 'nano-banana-2', position: 40 },
        { slug: 'gpt-image-2-image-to-image', position: 10 },
      ],
      getModel,
    )

    assert.deepEqual(
      pins.map((p) => p.slug),
      ['gpt-image-2-image-to-image', 'nano-banana-2'],
    )
    // Gaps in the stored positions never reach the UI.
    assert.deepEqual(
      pins.map((p) => p.position),
      [0, 1],
    )
  })

  it('resolves the label and family from the registry', () => {
    const [pin] = resolvePins([{ slug: 'gpt-image-2-image-to-image', position: 0 }], getModel)
    assert.equal(pin!.label, 'GPT Image 2 — Image to Image')
    assert.equal(pin!.family, 'openai')
    assert.equal(pin!.capability, 'image-to-image')
    assert.equal(pin!.missing, false)
  })

  it('keeps a pin whose model has left the registry, flagged rather than dropped', () => {
    const pins = resolvePins(
      [
        { slug: 'gpt-image-2-image-to-image', position: 0 },
        { slug: 'runway/gen-4', position: 1 },
      ],
      getModel,
    )

    assert.equal(pins.length, 2, 'a missing model must not silently disappear')
    const missing = pins[1]!
    assert.equal(missing.missing, true)
    // Nothing to label it with but the slug itself.
    assert.equal(missing.label, 'runway/gen-4')
    assert.equal(missing.family, null)
  })
})

describe('applyOrder', () => {
  it('reorders the pins the request names', () => {
    assert.deepEqual(applyOrder(['a', 'b', 'c'], ['c', 'a', 'b']), ['c', 'a', 'b'])
  })

  it('ignores slugs that are not pinned', () => {
    // A stale tab must not be able to re-pin what another tab removed.
    assert.deepEqual(applyOrder(['a', 'b'], ['b', 'zzz', 'a']), ['b', 'a'])
  })

  it('keeps pins the request omits, in their existing relative order', () => {
    assert.deepEqual(applyOrder(['a', 'b', 'c', 'd'], ['c']), ['c', 'a', 'b', 'd'])
  })

  it('ignores a repeated slug rather than duplicating it', () => {
    assert.deepEqual(applyOrder(['a', 'b'], ['b', 'b', 'a']), ['b', 'a'])
  })
})

describe('move', () => {
  it('swaps with the neighbour in the given direction', () => {
    assert.deepEqual(move(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c'])
    assert.deepEqual(move(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b'])
  })

  it('does not wrap off either end', () => {
    assert.deepEqual(move(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c'])
    assert.deepEqual(move(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c'])
  })

  it('is a no-op for a slug that is not in the list', () => {
    assert.deepEqual(move(['a', 'b'], 'zzz', 1), ['a', 'b'])
  })
})
