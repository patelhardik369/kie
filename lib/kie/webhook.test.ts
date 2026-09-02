import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { describe, it } from 'node:test'

import {
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  deliveryAction,
  signPayload,
  verifySignature,
  verifyWebhook,
} from './webhook.ts'

const KEY = 'test-hmac-key'
const TASK_ID = 'task_wan_1765180586443'

function headersFor(taskId: string, timestamp: number | string, key = KEY) {
  return new Headers({
    [WEBHOOK_TIMESTAMP_HEADER]: String(timestamp),
    [WEBHOOK_SIGNATURE_HEADER]: signPayload(taskId, timestamp, key),
  })
}

function payloadFor(taskId: string) {
  return { code: 200, msg: 'Success', data: { task_id: taskId } }
}

describe('signPayload', () => {
  it('matches an independently computed HMAC of `taskId.timestamp`', () => {
    const timestamp = 1765180586
    const expected = crypto
      .createHmac('sha256', KEY)
      .update(`${TASK_ID}.${timestamp}`)
      .digest('base64')

    assert.equal(signPayload(TASK_ID, timestamp, KEY), expected)
  })
})

describe('verifySignature', () => {
  it('accepts a correct signature', () => {
    const ts = 1765180586
    assert.equal(
      verifySignature(TASK_ID, ts, signPayload(TASK_ID, ts, KEY), KEY),
      true,
    )
  })

  it('rejects a wrong key', () => {
    const ts = 1765180586
    assert.equal(
      verifySignature(TASK_ID, ts, signPayload(TASK_ID, ts, 'other-key'), KEY),
      false,
    )
  })

  it('returns false rather than throwing on a length mismatch', () => {
    // timingSafeEqual throws on unequal lengths — a naive impl 500s here.
    assert.doesNotThrow(() => verifySignature(TASK_ID, 1, 'short', KEY))
    assert.equal(verifySignature(TASK_ID, 1, 'short', KEY), false)
    assert.equal(verifySignature(TASK_ID, 1, '', KEY), false)
  })
})

describe('verifyWebhook', () => {
  const now = 1765180586_000

  it('accepts a well-formed callback', () => {
    const result = verifyWebhook(
      headersFor(TASK_ID, Math.floor(now / 1000)),
      payloadFor(TASK_ID),
      KEY,
      { now },
    )
    assert.equal(result.ok, true)
    assert.equal(result.ok && result.taskId, TASK_ID)
  })

  it('reads the task id from data.task_id', () => {
    const ts = Math.floor(now / 1000)
    const result = verifyWebhook(
      headersFor(TASK_ID, ts),
      // Top-level taskId deliberately differs — data.task_id is what is signed.
      { taskId: 'not-this-one', data: { task_id: TASK_ID } },
      KEY,
      { now },
    )
    assert.equal(result.ok, true)
    assert.equal(result.ok && result.taskId, TASK_ID)
  })

  it('falls back to the top-level taskId when data.task_id is absent', () => {
    const ts = Math.floor(now / 1000)
    const result = verifyWebhook(
      headersFor(TASK_ID, ts),
      { taskId: TASK_ID },
      KEY,
      { now },
    )
    assert.equal(result.ok, true)
  })

  it('rejects a missing timestamp header', () => {
    const headers = new Headers({
      [WEBHOOK_SIGNATURE_HEADER]: signPayload(TASK_ID, 1, KEY),
    })
    const result = verifyWebhook(headers, payloadFor(TASK_ID), KEY, { now })
    assert.equal(result.ok, false)
    assert.match(result.ok === false ? result.reason : '', /timestamp/i)
  })

  it('rejects a missing signature header', () => {
    const headers = new Headers({ [WEBHOOK_TIMESTAMP_HEADER]: '1765180586' })
    const result = verifyWebhook(headers, payloadFor(TASK_ID), KEY, { now })
    assert.equal(result.ok, false)
    assert.match(result.ok === false ? result.reason : '', /signature/i)
  })

  it('rejects a stale timestamp (replay)', () => {
    const stale = Math.floor(now / 1000) - 600
    const result = verifyWebhook(
      headersFor(TASK_ID, stale),
      payloadFor(TASK_ID),
      KEY,
      { now },
    )
    assert.equal(result.ok, false)
    assert.match(result.ok === false ? result.reason : '', /tolerance/)
  })

  it('rejects a payload with no task id', () => {
    const result = verifyWebhook(
      headersFor(TASK_ID, Math.floor(now / 1000)),
      { code: 200, data: {} },
      KEY,
      { now },
    )
    assert.equal(result.ok, false)
    assert.match(result.ok === false ? result.reason : '', /task_id/)
  })

  it('rejects a tampered task id', () => {
    const ts = Math.floor(now / 1000)
    const result = verifyWebhook(
      headersFor(TASK_ID, ts),
      payloadFor('task_attacker_0000'),
      KEY,
      { now },
    )
    assert.equal(result.ok, false)
    assert.match(result.ok === false ? result.reason : '', /mismatch/)
  })
})

describe('what a verified callback does about the generation', () => {
  it('wakes the poller for anything still in flight', () => {
    for (const state of ['waiting', 'queuing', 'generating', 'downloading']) {
      assert.equal(deliveryAction(state), 'wake', state)
    }
  })

  it('wakes a generation the poller had parked', () => {
    // The 20-minute ceiling ran out before Kie finished; this is the callback
    // saying it finished after all.
    assert.equal(deliveryAction('stalled'), 'wake')
    assert.equal(deliveryAction('needs_retry'), 'wake')
  })

  it('ignores a duplicate delivery for a settled generation', () => {
    // Idempotency: the bytes are already on disk, and a second delivery must
    // not start a second download.
    assert.equal(deliveryAction('complete'), 'ignore')
    assert.equal(deliveryAction('failed'), 'ignore')
    assert.equal(deliveryAction('orphaned'), 'ignore')
  })

  it('reports a task it has no row for', () => {
    assert.equal(deliveryAction(undefined), 'unknown')
  })
})
