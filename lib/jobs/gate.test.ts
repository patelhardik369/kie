import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SubmissionGate } from './gate.ts'

/**
 * A gate driven by a fake clock: `sleep` advances time instead of waiting, so
 * the whole 10-second window is exercised in microseconds.
 */
function fakeGate(options: { maxRequests?: number; windowMs?: number } = {}) {
  let clock = 1_000_000
  const slept: number[] = []

  const gate = new SubmissionGate({
    maxRequests: options.maxRequests ?? 20,
    windowMs: options.windowMs ?? 10_000,
    now: () => clock,
    sleep: async (ms) => {
      slept.push(ms)
      clock += ms
    },
  })

  return { gate, slept, advance: (ms: number) => (clock += ms), now: () => clock }
}

describe('SubmissionGate', () => {
  it('lets the first burst through without waiting', async () => {
    const { gate, slept } = fakeGate({ maxRequests: 20 })

    for (let i = 0; i < 20; i++) await gate.acquire()

    assert.deepEqual(slept, [])
    assert.equal(gate.pending, 20)
  })

  it('holds the 21st submission until the window frees a slot', async () => {
    const { gate, slept } = fakeGate({ maxRequests: 20, windowMs: 10_000 })

    for (let i = 0; i < 20; i++) await gate.acquire()
    await gate.acquire()

    // The oldest of the 20 has to age out of the window first.
    assert.deepEqual(slept, [10_000])
  })

  it('reports no delay once the window has passed', async () => {
    const { gate, advance } = fakeGate({ maxRequests: 2, windowMs: 10_000 })

    await gate.acquire()
    await gate.acquire()
    assert.ok(gate.delayMs() > 0)

    advance(10_001)
    assert.equal(gate.delayMs(), 0)
    assert.equal(gate.pending, 0)
  })

  it('serializes concurrent acquires instead of overselling the window', async () => {
    // The bug this guards: two callers both see the last free slot and both take
    // it, putting 21 submissions into a 20-slot window and earning a 429.
    const { gate } = fakeGate({ maxRequests: 3, windowMs: 10_000 })

    await Promise.all([gate.acquire(), gate.acquire(), gate.acquire(), gate.acquire()])

    // The fourth waited for the window to roll, so only it is inside the new one.
    assert.equal(gate.pending, 1)
  })

  it('slides rather than resetting — a steady drip never waits', async () => {
    const { gate, slept, advance } = fakeGate({ maxRequests: 2, windowMs: 10_000 })

    for (let i = 0; i < 6; i++) {
      await gate.acquire()
      advance(5_001)
    }

    assert.deepEqual(slept, [])
  })

  it('honours an abort while waiting for a slot', async () => {
    const { gate } = fakeGate({ maxRequests: 1, windowMs: 10_000 })
    const controller = new AbortController()

    await gate.acquire()
    controller.abort(new Error('shutting down'))

    await assert.rejects(() => gate.acquire(controller.signal), /shutting down/)
  })

  it('keeps working after an aborted acquire', async () => {
    // One caller's rejection must not poison the chain for the next.
    const { gate } = fakeGate({ maxRequests: 1, windowMs: 10_000 })
    const controller = new AbortController()
    controller.abort(new Error('gone'))

    await assert.rejects(() => gate.acquire(controller.signal))
    await gate.acquire()

    assert.equal(gate.pending, 1)
  })
})
