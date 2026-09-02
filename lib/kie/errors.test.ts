import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isRetryable, kieErrorFromCode, networkError, timeoutError } from './errors.ts'

describe('kieErrorFromCode', () => {
  it('maps documented codes to kinds', () => {
    const cases: Array<[number, string]> = [
      [400, 'bad_request'],
      [401, 'unauthorized'],
      [402, 'insufficient_credits'],
      [404, 'not_found'],
      [422, 'validation'],
      [429, 'rate_limited'],
      [500, 'server'],
    ]
    for (const [code, kind] of cases) {
      assert.equal(kieErrorFromCode(code).kind, kind, `code ${code}`)
    }
  })

  it('marks only transient failures retryable', () => {
    // Retrying a 422 just sends the same bad enum value again.
    for (const code of [400, 401, 402, 404, 422]) {
      assert.equal(kieErrorFromCode(code).retryable, false, `code ${code}`)
    }
    for (const code of [429, 500]) {
      assert.equal(kieErrorFromCode(code).retryable, true, `code ${code}`)
    }
  })

  it('passes undocumented codes through without inventing a meaning', () => {
    // 455 and 505 appear in Kie's code list but their meanings are unpublished.
    const e = kieErrorFromCode(455, 'service message')
    assert.equal(e.code, 455)
    assert.equal(e.detail, 'service message')
    assert.match(e.message, /unrecognized code 455/)
  })

  it('treats 5xx as transient', () => {
    assert.equal(kieErrorFromCode(503).retryable, true)
    assert.equal(kieErrorFromCode(505).retryable, true)
  })

  it('keeps the server message verbatim as detail', () => {
    const e = kieErrorFromCode(422, 'duration must be a string')
    assert.equal(e.detail, 'duration must be a string')
  })
})

describe('isRetryable', () => {
  it('is true for network and timeout failures', () => {
    assert.equal(isRetryable(networkError(new Error('ECONNRESET'))), true)
    assert.equal(isRetryable(timeoutError(30_000)), true)
  })

  it('is false for anything that is not a KieError', () => {
    assert.equal(isRetryable(new Error('boom')), false)
    assert.equal(isRetryable(undefined), false)
  })
})
