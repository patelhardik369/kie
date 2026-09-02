import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { joinUrl } from './url.ts'

const API = 'https://api.kie.ai/api/v1'
const UPLOAD = 'https://kieai.redpandaai.co'

describe('joinUrl', () => {
  it('preserves the base path prefix', () => {
    // Regression: new URL('/chat/credit', API) drops /api/v1 and 404s.
    assert.equal(joinUrl(API, '/chat/credit'), 'https://api.kie.ai/api/v1/chat/credit')
    assert.equal(
      joinUrl(API, '/jobs/createTask'),
      'https://api.kie.ai/api/v1/jobs/createTask',
    )
    assert.equal(
      joinUrl(API, '/common/download-url'),
      'https://api.kie.ai/api/v1/common/download-url',
    )
  })

  it('treats a leading slash as optional', () => {
    assert.equal(joinUrl(API, 'chat/credit'), joinUrl(API, '/chat/credit'))
  })

  it('does not double up slashes', () => {
    assert.equal(joinUrl(`${API}/`, '/chat/credit'), `${API}/chat/credit`)
    assert.equal(joinUrl(`${API}//`, '//chat/credit'), `${API}/chat/credit`)
  })

  it('builds upload-host urls', () => {
    assert.equal(
      joinUrl(UPLOAD, '/api/file-stream-upload'),
      'https://kieai.redpandaai.co/api/file-stream-upload',
    )
  })

  it('appends query parameters', () => {
    assert.equal(
      joinUrl(API, '/jobs/recordInfo', { taskId: 'task_abc' }),
      'https://api.kie.ai/api/v1/jobs/recordInfo?taskId=task_abc',
    )
  })

  it('skips undefined query values but keeps falsy ones', () => {
    assert.equal(
      joinUrl(API, '/x', { a: undefined, b: 0, c: '' }),
      'https://api.kie.ai/api/v1/x?b=0&c=',
    )
  })

  it('encodes query values', () => {
    assert.equal(
      joinUrl(API, '/x', { url: 'https://a.b/c d?e=f' }),
      'https://api.kie.ai/api/v1/x?url=https%3A%2F%2Fa.b%2Fc+d%3Fe%3Df',
    )
  })
})
