import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { isTerminal } from './polling.ts'
import { requireModel } from './registry/index.ts'
import { parseResultJson } from './result.ts'
import { veoRecordToTask, veoState } from './veo.ts'

/**
 * The Veo adapter's job is to make one model that speaks a different protocol
 * indistinguishable from the other 81. These tests check the seam, not the HTTP.
 */

describe('successFlag maps onto the shared TaskState', () => {
  it('treats 0 as still running and 1 as success', () => {
    assert.equal(veoState(0), 'generating')
    assert.equal(veoState(1), 'success')
  })

  it('treats BOTH documented failure flags as terminal failures', () => {
    // The schema's enum stops at 2; its own description documents 3 as
    // "Generation Failed". Polling past either one burns the whole timeout
    // budget and then parks the job as retryable.
    assert.equal(veoState(2), 'fail')
    assert.equal(veoState(3), 'fail')
    assert.ok(isTerminal(veoState(3)))
  })

  it('treats an absent flag as still running, never as failed', () => {
    // A missing field early in a task's life must not fail a job that is fine.
    assert.equal(veoState(undefined), 'generating')
    assert.equal(veoState(null), 'generating')
    assert.ok(!isTerminal(veoState(undefined)))
  })

  it('fails an unrecognized flag rather than polling it forever', () => {
    assert.equal(veoState(9), 'fail')
  })
})

describe('a Veo record becomes an ordinary TaskRecord', () => {
  const done = {
    taskId: 'veo_task_abc',
    successFlag: 1,
    paramJson: '{"prompt":"a dog"}',
    createTime: 1_000,
    completeTime: 4_000,
    response: {
      taskId: 'veo_task_abc',
      resultUrls: ['https://cdn/one.mp4'],
      originUrls: ['https://cdn/origin.mp4'],
      resolution: '1080p',
    },
  }

  it('re-encodes resultUrls into the resultJson STRING every other model stores', () => {
    const task = veoRecordToTask(done, 'veo_task_abc', 'veo3_fast')
    assert.equal(typeof task.resultJson, 'string')
    // The downloader reaches the URLs through the same parser as everything else.
    assert.deepEqual(parseResultJson(task.resultJson).urls, ['https://cdn/one.mp4'])
  })

  it('carries the echoed params over from paramJson', () => {
    // Named `param` on /jobs and `paramJson` on /veo.
    assert.equal(veoRecordToTask(done, 'x', 'veo3').param, '{"prompt":"a dog"}')
  })

  it('derives costTime from the timestamps Veo does report', () => {
    assert.equal(veoRecordToTask(done, 'x', 'veo3').costTime, 3_000)
  })

  it('leaves creditsConsumed null rather than inventing a number', () => {
    // It feeds the spend total and the per-generation cost; a guess there is
    // worse than an honest blank.
    assert.equal(veoRecordToTask(done, 'x', 'veo3').creditsConsumed, null)
  })

  it('reports no result and no failure while still generating', () => {
    const task = veoRecordToTask({ successFlag: 0 }, 'x', 'veo3')
    assert.equal(task.state, 'generating')
    assert.equal(task.resultJson, null)
    assert.equal(task.failCode, null)
    assert.equal(task.failMsg, null)
    assert.equal(task.costTime, null)
  })

  it('maps errorCode / errorMessage onto failCode / failMsg', () => {
    const task = veoRecordToTask(
      { successFlag: 2, errorCode: 400, errorMessage: 'flagged by Website' },
      'x',
      'veo3',
    )
    assert.equal(task.state, 'fail')
    assert.equal(task.failCode, '400')
    assert.equal(task.failMsg, 'flagged by Website')
  })

  it('still names a failCode when Veo sends no errorCode', () => {
    // Falls back to the flag, so a failed row is never silent about why.
    const task = veoRecordToTask({ successFlag: 3 }, 'x', 'veo3')
    assert.equal(task.failCode, '3')
  })

  it('falls back to the requested taskId when the record omits it', () => {
    assert.equal(veoRecordToTask({ successFlag: 0 }, 'veo_task_z', 'veo3').taskId, 'veo_task_z')
  })

  it('ignores the urls that are not the generation output', () => {
    // originUrls are pre-processing renders and fullResultUrls only exist after
    // /veo/extend. Downloading either would put the wrong bytes on disk.
    const task = veoRecordToTask(done, 'x', 'veo3')
    const urls = parseResultJson(task.resultJson).urls
    assert.deepEqual(urls, ['https://cdn/one.mp4'])
  })
})

describe('the registry declares the transport, not the caller', () => {
  it('marks all three Veo tiers and nothing else', () => {
    for (const slug of ['veo3', 'veo3_fast', 'veo3_lite']) {
      assert.equal(requireModel(slug).transport, 'veo', slug)
    }
    assert.equal(requireModel('wan/3-0-video').transport, undefined)
  })

  it('keeps callBackUrl out of the parameter list', () => {
    // It is transport-level: the runner supplies it, and a form control for it
    // would let a user point a callback anywhere.
    for (const slug of ['veo3', 'veo3_fast', 'veo3_lite']) {
      const model = requireModel(slug)
      assert.ok(!model.params.some((p) => p.key === 'callBackUrl'), slug)
    }
  })

  it('does not transcribe the `seeds` field from the doc`s example block', () => {
    // It appears once in the example and never in `properties`.
    for (const slug of ['veo3', 'veo3_fast', 'veo3_lite']) {
      const model = requireModel(slug)
      assert.ok(!model.params.some((p) => p.key === 'seeds'), slug)
      assert.ok(!model.params.some((p) => p.key === 'seed'), slug)
    }
  })
})
