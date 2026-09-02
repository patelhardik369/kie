import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  POLL_SCHEDULE_MS,
  POLL_TIMEOUT_MS,
  SUBMIT_RATE_LIMIT,
  TASK_STATES,
  isTerminal,
  pollDelayMs,
} from './polling.ts'

describe('isTerminal', () => {
  it('ends the poll only on success and fail', () => {
    assert.equal(isTerminal('success'), true)
    assert.equal(isTerminal('fail'), true)
  })

  it('keeps polling through every non-terminal state', () => {
    for (const state of ['waiting', 'queuing', 'generating']) {
      assert.equal(isTerminal(state), false, state)
    }
  })

  it('does not treat an unknown state as terminal', () => {
    // Guessing terminal on an unrecognized state would strand the generation.
    assert.equal(isTerminal('paused'), false)
    assert.equal(isTerminal(''), false)
  })

  it('covers every documented state', () => {
    assert.deepEqual(
      [...TASK_STATES],
      ['waiting', 'queuing', 'generating', 'success', 'fail'],
    )
  })
})

describe('pollDelayMs', () => {
  it('follows the documented backoff', () => {
    assert.equal(pollDelayMs(0), 3_000)
    assert.equal(pollDelayMs(1), 5_000)
    assert.equal(pollDelayMs(2), 8_000)
    assert.equal(pollDelayMs(3), 12_000)
    assert.equal(pollDelayMs(4), 15_000)
  })

  it('holds at the final delay indefinitely', () => {
    assert.equal(pollDelayMs(5), 15_000)
    assert.equal(pollDelayMs(500), 15_000)
  })

  it('clamps negatives rather than returning undefined', () => {
    assert.equal(pollDelayMs(-1), 3_000)
  })

  it('never returns a delay that would exceed the rate limit', () => {
    // 20 submissions / 10s. A poll faster than ~500ms risks tripping 429.
    for (const delay of POLL_SCHEDULE_MS) {
      assert.ok(delay >= 500, `${delay}ms is too aggressive`)
    }
  })
})

describe('limits', () => {
  it('gives video far more headroom than images', () => {
    assert.equal(POLL_TIMEOUT_MS.image, 300_000)
    assert.equal(POLL_TIMEOUT_MS.video, 1_200_000)
    assert.ok(POLL_TIMEOUT_MS.video > POLL_TIMEOUT_MS.image)
  })

  it('records the documented submission rate limit', () => {
    assert.deepEqual({ ...SUBMIT_RATE_LIMIT }, { maxRequests: 20, windowMs: 10_000 })
  })
})
