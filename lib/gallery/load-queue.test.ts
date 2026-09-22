import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { connectionConcurrency, createLoadQueue, DEFAULT_CONCURRENCY } from './load-queue.ts'

/**
 * The queue is the whole reason the gallery fills top-to-bottom instead of all
 * at once, and none of what it guarantees is visible from the component — a tile
 * only ever sees its own grant. These assertions are those guarantees.
 */

/** Records the order grants come out in, and hands back each release. */
function trace(queue: ReturnType<typeof createLoadQueue>) {
  const granted: number[] = []
  const release = new Map<number, () => void>()
  return {
    granted,
    add(priority: number) {
      release.set(
        priority,
        queue.request(priority, () => granted.push(priority)),
      )
    },
    finish(priority: number) {
      release.get(priority)!()
    },
  }
}

describe('the media load queue', () => {
  it('grants up to the ceiling immediately and holds the rest', () => {
    const queue = createLoadQueue(2)
    const t = trace(queue)
    for (const p of [0, 1, 2, 3]) t.add(p)

    assert.deepEqual(t.granted, [0, 1])
    assert.equal(queue.active, 2)
    assert.equal(queue.pending, 2)
  })

  it('serves the lowest priority first, whatever order it was asked in', () => {
    const queue = createLoadQueue(1)
    const t = trace(queue)
    // A grid whose observers fire out of order — scrolling fast does this.
    for (const p of [5, 2, 9]) t.add(p)
    assert.deepEqual(t.granted, [5])

    t.finish(5)
    assert.deepEqual(t.granted, [5, 2])
    t.finish(2)
    assert.deepEqual(t.granted, [5, 2, 9])
  })

  it('keeps arrival order between equal priorities', () => {
    const queue = createLoadQueue(1)
    const order: string[] = []
    const first = queue.request(3, () => order.push('first'))
    queue.request(3, () => order.push('second'))
    queue.request(3, () => order.push('third'))

    assert.deepEqual(order, ['first'])
    first()
    assert.deepEqual(order, ['first', 'second'])
  })

  it('treats a release before the grant as a cancellation, not a free slot', () => {
    const queue = createLoadQueue(1)
    const t = trace(queue)
    t.add(0)
    t.add(1)
    t.add(2)

    // Tile 1 scrolled away and unmounted while still waiting.
    t.finish(1)
    assert.equal(queue.active, 1, 'the cancellation must not release tile 0`s slot')
    assert.equal(queue.pending, 1)

    t.finish(0)
    assert.deepEqual(t.granted, [0, 2], 'the cancelled tile is skipped')
  })

  it('ignores a second release from the same tile', () => {
    // `settle()` is called on load AND on unmount; double-counting would let the
    // queue run one extra fetch for every tile on the page.
    const queue = createLoadQueue(1)
    const t = trace(queue)
    t.add(0)
    t.add(1)

    t.finish(0)
    t.finish(0)
    assert.equal(queue.active, 1)
    assert.deepEqual(t.granted, [0, 1])
  })

  it("handles a tile released from inside another tile's grant", () => {
    // Granting one tile can unmount another — a `router.refresh()` after a
    // delete does exactly this — so `release` runs inside `pump`. Without the
    // re-entrancy guard the nested pump and the outer loop would both hand out
    // the freed slot, and the ceiling would quietly stop meaning anything.
    const queue = createLoadQueue(2)
    const granted: number[] = []
    const releaseZero = queue.request(0, () => granted.push(0))
    const releaseOne = queue.request(1, () => granted.push(1))
    queue.request(2, () => {
      granted.push(2)
      releaseZero()
    })
    queue.request(3, () => granted.push(3))

    assert.deepEqual(granted, [0, 1])

    releaseOne()
    // 1 finishing admits 2, whose own grant frees 0's slot, which admits 3.
    assert.deepEqual(granted, [0, 1, 2, 3])
    assert.equal(queue.active, 2)
    assert.equal(queue.pending, 0)
  })

  it('never exceeds the ceiling across a jumbled sequence of completions', () => {
    // Tiles finish out of order in real life: a 12 KB WebP beats a 400 KB PNG
    // queued ahead of it, and a tile scrolled past is cancelled mid-wait.
    const LIMIT = 3
    const queue = createLoadQueue(LIMIT)
    const live = new Set<number>()
    const release: Array<() => void> = []
    let peak = 0

    for (let i = 0; i < 12; i += 1) {
      release.push(
        queue.request(i, () => {
          live.add(i)
          peak = Math.max(peak, live.size)
          assert.ok(live.size <= LIMIT, `${live.size} in flight, ceiling is ${LIMIT}`)
        }),
      )
    }

    for (const i of [1, 0, 4, 2, 3, 5, 7, 6, 8, 10, 9, 11]) {
      live.delete(i)
      release[i]!()
    }

    assert.equal(peak, LIMIT)
    assert.equal(queue.active, 0)
    assert.equal(queue.pending, 0)
  })

  it('re-reads a ceiling given as a function', () => {
    // The connection can change under a tab left open; the limit is not captured
    // once at module load.
    let ceiling = 1
    const queue = createLoadQueue(() => ceiling)
    const t = trace(queue)
    for (const p of [0, 1, 2]) t.add(p)
    assert.deepEqual(t.granted, [0])

    ceiling = 3
    t.finish(0)
    assert.deepEqual(t.granted, [0, 1, 2])
  })

  it('falls back to the default ceiling with no Network Information API', () => {
    // Node has no `navigator.connection`, which is also every non-Chromium
    // browser — the guard must not throw there.
    assert.equal(connectionConcurrency(), DEFAULT_CONCURRENCY)
  })
})
