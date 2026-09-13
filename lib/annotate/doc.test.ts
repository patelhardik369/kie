import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DEFAULT_WIDTH,
  DOC_VERSION,
  LEGEND_PREAMBLE,
  boundsOf,
  buildLegend,
  circledNumber,
  emptyDoc,
  hitTest,
  insertLegend,
  nextPinIndex,
  parseDoc,
  rectFrom,
  sameAspect,
  serializeDoc,
  translate,
  type AnnotationDoc,
  type Shape,
} from './doc.ts'

const SIZE = { w: 1600, h: 900 }

function doc(...shapes: Shape[]): AnnotationDoc {
  return { version: DOC_VERSION, source: { width: 1600, height: 900 }, shapes }
}

function box(over: Partial<Shape> = {}): Shape {
  return {
    id: 'a',
    kind: 'rect',
    color: 'red',
    width: DEFAULT_WIDTH,
    fill: 0,
    at: { x: 0.2, y: 0.2, w: 0.4, h: 0.4 },
    ...over,
  } as Shape
}

describe('the legend', () => {
  it('is empty for a document with no marks', () => {
    // Nothing to explain. An orphaned preamble in the prompt is pure noise.
    assert.equal(buildLegend(emptyDoc(1600, 900)), '')
  })

  it('always carries the do-not-render preamble, even with no notes', () => {
    // The single most important sentence in the feature: without it the model
    // happily paints the red circle into the output.
    const legend = buildLegend(doc(box()))
    assert.ok(legend.includes(LEGEND_PREAMBLE))
  })

  it('names a mark by colour and shape, and attaches its note', () => {
    const legend = buildLegend(doc(box({ note: '  replace with a wooden sign  ' })))
    assert.ok(legend.includes('red box — replace with a wooden sign'))
  })

  it('reads a translucent stroke as a shaded area, not a brush mark', () => {
    const legend = buildLegend(
      doc({
        id: 's',
        kind: 'stroke',
        color: 'cyan',
        width: DEFAULT_WIDTH,
        opacity: 0.35,
        points: [{ x: 0.1, y: 0.1 }],
        note: 'brighten this',
      }),
    )
    assert.ok(legend.includes('cyan shaded area — brighten this'))
  })

  it('numbers a pin rather than describing it', () => {
    const legend = buildLegend(
      doc({ id: 'p', kind: 'pin', color: 'lime', size: 0.05, at: { x: 0.5, y: 0.5 }, index: 2, note: 'remove' }),
    )
    assert.ok(legend.includes('② — remove'))
  })

  it('disambiguates two marks that would read identically', () => {
    // "the red box" has to name exactly one thing or it names nothing.
    const legend = buildLegend(
      doc(box({ id: 'a', note: 'first' }), box({ id: 'b', note: 'second' })),
    )
    assert.ok(legend.includes('red box (1st) — first'))
    assert.ok(legend.includes('red box (2nd) — second'))
  })

  it('leaves distinct marks untagged', () => {
    const legend = buildLegend(
      doc(box({ id: 'a', note: 'first' }), box({ id: 'b', color: 'cyan', note: 'second' })),
    )
    assert.ok(legend.includes('red box — first'))
    assert.ok(legend.includes('cyan box — second'))
    assert.ok(!legend.includes('(1st)'))
  })

  it('never tags pins, whose numbers already make them unique', () => {
    const pin = (index: number): Shape => ({
      id: `p${index}`,
      kind: 'pin',
      color: 'red',
      size: 0.05,
      at: { x: 0.1 * index, y: 0.5 },
      index,
      note: `note ${index}`,
    })
    const legend = buildLegend(doc(pin(1), pin(2)))
    assert.ok(!legend.includes('(1st)'))
    assert.ok(legend.includes('① — note 1'))
    assert.ok(legend.includes('② — note 2'))
  })

  it('omits marks with no note, but still counts them for the preamble', () => {
    const legend = buildLegend(doc(box({ id: 'a' }), box({ id: 'b', color: 'cyan', note: 'this one' })))
    assert.ok(legend.includes('cyan box — this one'))
    assert.ok(!legend.includes('red box'))
  })

  it('explains the clean companion image only when one is being sent', () => {
    assert.ok(!buildLegend(doc(box())).includes('second image'))
    assert.ok(buildLegend(doc(box()), { paired: true }).includes('second image'))
  })
})

describe('putting a legend into a prompt', () => {
  const legend = buildLegend(doc(box({ note: 'wooden sign' })))

  it('appends below what the user wrote', () => {
    const out = insertLegend('a quiet street at dusk', legend)
    assert.ok(out.startsWith('a quiet street at dusk'))
    assert.ok(out.includes('wooden sign'))
  })

  it('stands alone in an empty prompt', () => {
    assert.equal(insertLegend('', legend), legend)
    assert.equal(insertLegend('   \n ', legend), legend)
  })

  it('replaces an earlier legend rather than stacking a second one', () => {
    // Marking up twice is the normal case. Two legends means two sets of
    // instructions, the stale one first, at the bottom of a field nobody
    // re-reads.
    const once = insertLegend('a quiet street at dusk', legend)
    const updated = buildLegend(doc(box({ note: 'stone sign' })))
    const twice = insertLegend(once, updated)

    assert.ok(twice.startsWith('a quiet street at dusk'))
    assert.ok(twice.includes('stone sign'))
    assert.ok(!twice.includes('wooden sign'))
    assert.equal(twice.split(LEGEND_PREAMBLE).length - 1, 1)
  })

  it('removes the legend entirely when every mark is cleared', () => {
    const once = insertLegend('a quiet street at dusk', legend)
    assert.equal(insertLegend(once, ''), 'a quiet street at dusk')
  })

  it('leaves a prompt that never had one alone', () => {
    assert.equal(insertLegend('a quiet street at dusk', ''), 'a quiet street at dusk')
  })
})

describe('circled numbers', () => {
  it('uses the real glyphs through 20', () => {
    assert.equal(circledNumber(1), '①')
    assert.equal(circledNumber(20), '⑳')
  })

  it('falls back past the block rather than emitting a stray codepoint', () => {
    assert.equal(circledNumber(21), '(21)')
  })
})

describe('pin numbering', () => {
  it('starts at one', () => {
    assert.equal(nextPinIndex(emptyDoc(100, 100)), 1)
  })

  it('never reuses a number a deleted pin had', () => {
    // Renumbering would silently re-point notes the user already wrote.
    const withThree = doc(
      { id: 'p', kind: 'pin', color: 'red', size: 0.05, at: { x: 0.1, y: 0.1 }, index: 3 },
    )
    assert.equal(nextPinIndex(withThree), 4)
  })
})

describe('hit testing', () => {
  it('grabs an outline on its border', () => {
    const shape = box()
    const found = hitTest(doc(shape), { x: 0.2, y: 0.4 }, SIZE)
    assert.equal(found?.id, 'a')
  })

  it('lets a click through the middle of an unfilled box', () => {
    // A box drawn around a subject must not swallow clicks meant for it.
    assert.equal(hitTest(doc(box()), { x: 0.4, y: 0.4 }, SIZE), null)
  })

  it('grabs a filled box anywhere inside it', () => {
    assert.equal(hitTest(doc(box({ fill: 0.3 })), { x: 0.4, y: 0.4 }, SIZE)?.id, 'a')
  })

  it('returns the topmost shape when two overlap', () => {
    const under = box({ id: 'under', fill: 0.3 })
    const over = box({ id: 'over', fill: 0.3 })
    assert.equal(hitTest(doc(under, over), { x: 0.4, y: 0.4 }, SIZE)?.id, 'over')
  })

  it('finds a stroke along its length', () => {
    const stroke: Shape = {
      id: 's',
      kind: 'stroke',
      color: 'red',
      width: DEFAULT_WIDTH,
      opacity: 1,
      points: [
        { x: 0.1, y: 0.5 },
        { x: 0.9, y: 0.5 },
      ],
    }
    assert.equal(hitTest(doc(stroke), { x: 0.5, y: 0.5 }, SIZE)?.id, 's')
    assert.equal(hitTest(doc(stroke), { x: 0.5, y: 0.8 }, SIZE), null)
  })

  it('applies the same grab radius on both axes of a wide image', () => {
    // The reason hit testing converts to pixels first: in normalized space a
    // 6px tolerance would be 4x more generous vertically on this 16:9 frame.
    const stroke: Shape = {
      id: 's',
      kind: 'stroke',
      color: 'red',
      width: 0,
      opacity: 1,
      points: [{ x: 0.5, y: 0.5 }],
    }
    // ~5px away along each axis, in that axis's own normalized units.
    assert.ok(hitTest(doc(stroke), { x: 0.5 + 5 / SIZE.w, y: 0.5 }, SIZE))
    assert.ok(hitTest(doc(stroke), { x: 0.5, y: 0.5 + 5 / SIZE.h }, SIZE))
    // ~5px vertically expressed as the horizontal fraction would be a miss if
    // the test ran in normalized space.
    assert.equal(hitTest(doc(stroke), { x: 0.5, y: 0.5 + 20 / SIZE.h }, SIZE), null)
  })
})

describe('moving a shape', () => {
  it('translates every anchor together', () => {
    const moved = translate(box(), 0.1, 0.05)
    assert.deepEqual(boundsOf(moved), { x: 0.30000000000000004, y: 0.25, w: 0.4, h: 0.4 })
  })

  it('stops at the edge instead of squashing the shape', () => {
    // Clamping per point would deform a mark the user had already placed.
    const moved = translate(box(), 5, 0)
    const bounds = boundsOf(moved)
    assert.ok(Math.abs(bounds.w - 0.4) < 1e-9, 'width preserved')
    assert.ok(Math.abs(bounds.x + bounds.w - 1) < 1e-9, 'flush with the right edge')
  })

  it('keeps a stroke rigid when it is pushed off the top', () => {
    const stroke: Shape = {
      id: 's',
      kind: 'stroke',
      color: 'red',
      width: DEFAULT_WIDTH,
      opacity: 1,
      points: [
        { x: 0.3, y: 0.4 },
        { x: 0.5, y: 0.6 },
      ],
    }
    const moved = translate(stroke, 0, -5) as typeof stroke
    assert.equal(moved.points[0]!.y, 0)
    // The second point keeps its offset rather than collapsing onto the first.
    assert.ok(Math.abs(moved.points[1]!.y - 0.2) < 1e-9)
  })
})

describe('rectFrom', () => {
  it('normalizes a drag made in any direction', () => {
    const downRight = rectFrom({ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.5 })
    const upLeft = rectFrom({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.2 })
    assert.deepEqual(downRight, upLeft)
    assert.ok(downRight.w > 0 && downRight.h > 0)
  })
})

describe('reading a saved document back', () => {
  it('round-trips', () => {
    const original = doc(box({ note: 'hello' }))
    const parsed = parseDoc(serializeDoc(original), { width: 1600, height: 900 })
    assert.deepEqual(parsed, original)
  })

  it('accepts the same image at a different scale', () => {
    // Normalized geometry is scale-free, so a re-encoded copy is still a match.
    const parsed = parseDoc(serializeDoc(doc(box())), { width: 3200, height: 1800 })
    assert.ok(parsed)
  })

  it('refuses an image that has been cropped to a new aspect', () => {
    // Marks landing in the wrong places is worse than no marks at all.
    assert.equal(parseDoc(serializeDoc(doc(box())), { width: 1600, height: 1600 }), null)
  })

  it('refuses a document from a future version', () => {
    assert.equal(parseDoc(JSON.stringify({ version: 99, source: { width: 1, height: 1 }, shapes: [] })), null)
  })

  it('returns null for junk rather than throwing', () => {
    for (const junk of [null, undefined, '', 'not json', '[]', '{"version":1}']) {
      assert.equal(parseDoc(junk as string | null), null, String(junk))
    }
  })
})

describe('aspect comparison', () => {
  it('absorbs rounding from a re-encode', () => {
    assert.ok(sameAspect({ width: 1600, height: 900 }, { width: 1601, height: 900 }))
  })

  it('rejects a real crop', () => {
    assert.ok(!sameAspect({ width: 1600, height: 900 }, { width: 1400, height: 900 }))
  })
})
