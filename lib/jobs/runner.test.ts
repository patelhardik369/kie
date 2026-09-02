/**
 * End-to-end tests for the job runner, against a fake Kie.
 *
 * These are the Phase 4 exit criteria, checked rather than claimed: a
 * submission produces a file on disk and an `assets` row; a restart resumes an
 * in-flight generation; a 429 backs off instead of dropping the job; and a
 * terminal `fail` persists its code and message verbatim.
 *
 * Nothing here touches the network. `globalThis.fetch` is replaced by a stub
 * that serves the documented envelope shapes — including the two that cost the
 * most time when forgotten: errors arrive as **HTTP 200** with the real status
 * in the envelope's `code`, and `resultJson` is a **JSON-encoded string**.
 *
 * Requires --conditions=react-server, which resolves `server-only` to its
 * no-op build. See package.json's test script.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

// The environment has to exist before anything calls getEnv(), which is lazy —
// so setting it at module scope, ahead of the first test, is early enough.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'kie-studio-test-'))
process.env.KIE_API_KEY = 'test-key-not-a-real-one'
process.env.DATABASE_URL = `file:${path.join(ROOT, 'test.db')}`
process.env.KIE_OUTPUT_DIR = path.join(ROOT, 'outputs')
// Webhooks off: this asserts the poll-only path, which is the localhost default.
delete process.env.KIE_PUBLIC_URL
delete process.env.KIE_WEBHOOK_HMAC_KEY

const { assets, generations, getDb, runMigrations } = await import('../db/index.ts')
const { ALL_MODELS } = await import('../kie/registry/index.ts')
const { DownloadError } = await import('./downloader.ts')
const { JobRunner } = await import('./runner.ts')
const { eq } = await import('drizzle-orm')

const MODEL = ALL_MODELS.find((m) => m.outputKind === 'video')!
/** First entry of POLL_SCHEDULE_MS — the wait a callback is meant to cut short. */
const POLL_BACKOFF_MS = 3_000
const RESULT_URL = 'https://cdn.test.invalid/outputs/generated.mp4'
/** Stands in for a real MP4; only its bytes matter to the downloader. */
const RESULT_BYTES = new Uint8Array(2048).fill(0x42)

// --------------------------------------------------------------- fake Kie

interface FakeKie {
  /** Queued createTask outcomes, consumed in order; the last one repeats. */
  createTask: Array<{ taskId: string } | { code: number; msg: string }>
  /** Queued recordInfo outcomes, consumed in order; the last one repeats. */
  recordInfo: Array<Record<string, unknown> | { code: number; msg: string }>
  /** HTTP status the result URL answers with. */
  cdnStatus: number
  calls: { createTask: number; recordInfo: number; download: number }
}

let kie: FakeKie
let realFetch: typeof globalThis.fetch

function envelope(data: unknown): Response {
  return jsonResponse({ code: 200, msg: 'success', data })
}

/** Kie returns its errors with an HTTP 200 and the real status in `code`. */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function next<T>(queue: T[]): T {
  return queue.length > 1 ? queue.shift()! : queue[0]!
}

function isError(value: object): value is { code: number; msg: string } {
  return 'code' in value && 'msg' in value
}

before(() => {
  realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()

    if (url.includes('/jobs/createTask')) {
      kie.calls.createTask++
      const outcome = next(kie.createTask)
      return isError(outcome) ? jsonResponse(outcome) : envelope(outcome)
    }

    if (url.includes('/jobs/recordInfo')) {
      kie.calls.recordInfo++
      const outcome = next(kie.recordInfo)
      return isError(outcome) ? jsonResponse(outcome) : envelope(outcome)
    }

    if (url === RESULT_URL) {
      kie.calls.download++
      if (kie.cdnStatus !== 200) {
        return new Response('nope', { status: kie.cdnStatus })
      }
      return new Response(RESULT_BYTES, {
        status: 200,
        headers: {
          'content-type': 'video/mp4',
          'content-length': String(RESULT_BYTES.byteLength),
        },
      })
    }

    throw new Error(`Unexpected request in a test: ${url}`)
  }) as typeof globalThis.fetch
})

after(() => {
  globalThis.fetch = realFetch
  try {
    fs.rmSync(ROOT, { recursive: true, force: true })
  } catch {
    // Windows keeps the SQLite file handle open until the process exits, so the
    // temp directory cannot always be removed here. The OS will reap it.
  }
})

// ------------------------------------------------------------- fixtures

/** A finished `recordInfo` payload. `resultJson` is a STRING, as Kie sends it. */
function successRecord(taskId: string) {
  return {
    taskId,
    model: MODEL.slug,
    state: 'success',
    resultJson: JSON.stringify({ resultUrls: [RESULT_URL] }),
    costTime: 42_000,
    creditsConsumed: 12,
  }
}

function runningRecord(taskId: string, state = 'generating') {
  return { taskId, model: MODEL.slug, state, resultJson: null }
}

let counter = 0

async function insertGeneration(overrides: Record<string, unknown> = {}) {
  const id = `gen-${++counter}`
  await getDb()
    .insert(generations)
    .values({
      id,
      modelSlug: MODEL.slug,
      family: MODEL.family,
      capability: MODEL.capability,
      inputJson: JSON.stringify({ prompt: 'a lemon on a white background' }),
      state: 'waiting',
      createdAt: Date.now(),
      ...overrides,
    })
  return id
}

async function readGeneration(id: string) {
  const rows = await getDb().select().from(generations).where(eq(generations.id, id))
  return rows[0]!
}

async function readAssets(id: string) {
  return getDb().select().from(assets).where(eq(assets.generationId, id))
}

before(async () => {
  await runMigrations()
})

beforeEach(() => {
  // A fresh task id per test: `generations.kie_task_id` is UNIQUE, so a shared
  // default would make the second test's row collide with the first's.
  const taskId = `task-auto-${++counter}`
  kie = {
    createTask: [{ taskId }],
    recordInfo: [successRecord(taskId)],
    cdnStatus: 200,
    calls: { createTask: 0, recordInfo: 0, download: 0 },
  }
})

// ---------------------------------------------------------------- tests

describe('a successful generation', () => {
  it('ends with bytes on disk, an assets row, and state complete', async () => {
    kie.createTask = [{ taskId: 'task-happy' }]
    kie.recordInfo = [successRecord('task-happy')]

    const id = await insertGeneration()
    await new JobRunner().enqueue(id)

    const generation = await readGeneration(id)
    assert.equal(generation.state, 'complete')
    assert.equal(generation.kieTaskId, 'task-happy')
    assert.ok(generation.submittedAt, 'submittedAt is recorded')
    assert.ok(generation.completedAt, 'completedAt is recorded')

    const rows = await readAssets(id)
    assert.equal(rows.length, 1)
    const asset = rows[0]!
    assert.equal(asset.bytes, RESULT_BYTES.byteLength)
    assert.equal(asset.remoteUrl, RESULT_URL)
    assert.equal(asset.kind, 'video')
    assert.equal(asset.mime, 'video/mp4')

    // local_path is relative so the output folder can be moved wholesale.
    assert.equal(path.isAbsolute(asset.localPath), false)

    const onDisk = path.join(process.env.KIE_OUTPUT_DIR!, asset.localPath)
    assert.ok(fs.existsSync(onDisk), `expected a file at ${onDisk}`)
    assert.equal(fs.statSync(onDisk).size, RESULT_BYTES.byteLength)
    // The atomic-rename temp file must not survive.
    assert.equal(fs.existsSync(`${onDisk}.part`), false)
  })

  it('keeps the raw resultJson and the reported cost', async () => {
    const id = await insertGeneration()
    await new JobRunner().enqueue(id)

    const generation = await readGeneration(id)
    assert.equal(generation.creditsConsumed, 12)
    assert.equal(generation.costTimeMs, 42_000)
    // Stored unparsed, for forensics when a result shape surprises us.
    assert.equal(generation.resultJsonRaw, JSON.stringify({ resultUrls: [RESULT_URL] }))
  })

  it('persists the states Kie passes through on the way', async () => {
    kie.createTask = [{ taskId: 'task-states' }]
    kie.recordInfo = [runningRecord('task-states', 'queuing'), successRecord('task-states')]

    const id = await insertGeneration()
    const runner = new JobRunner()
    const job = runner.enqueue(id)

    // After the first poll the row should read `queuing`, mirroring Kie.
    await waitFor(async () => (await readGeneration(id)).state === 'queuing')
    await job

    assert.equal((await readGeneration(id)).state, 'complete')
    assert.ok(kie.calls.recordInfo >= 2)
  })
})

describe('a generation Kie rejects', () => {
  it('persists failCode and failMsg verbatim', async () => {
    // The exact shape a moderation rejection arrives in.
    const failMsg =
      'Your prompt was flagged by our content policy (sensitive content: violence). ' +
      'Please revise and try again.'
    kie.createTask = [{ taskId: 'task-fail' }]
    kie.recordInfo = [
      {
        taskId: 'task-fail',
        model: MODEL.slug,
        state: 'fail',
        failCode: '422',
        failMsg,
        resultJson: null,
      },
    ]

    const id = await insertGeneration()
    await new JobRunner().enqueue(id)

    const generation = await readGeneration(id)
    assert.equal(generation.state, 'failed')
    // Byte-identical: paraphrasing a moderation message destroys the only clue
    // to what tripped it.
    assert.equal(generation.failCode, '422')
    assert.equal(generation.failMsg, failMsg)
    assert.equal((await readAssets(id)).length, 0)
  })

  it('marks a task Kie has never heard of as orphaned, and stops', async () => {
    kie.createTask = [{ taskId: 'task-gone' }]
    kie.recordInfo = [{ code: 404, msg: 'Task not found' }]

    const id = await insertGeneration()
    await new JobRunner().enqueue(id)

    const generation = await readGeneration(id)
    assert.equal(generation.state, 'orphaned')
    // One look, then it gives up — a 404 will not become a 200.
    assert.equal(kie.calls.recordInfo, 1)
  })

  it('reads the 422 Kie actually sends for an unknown task as orphaned', async () => {
    // Verified against the live API: recordInfo answers an unknown taskId with
    // `{"code":422,"msg":"recordInfo is null"}` and never a 404. Taken at face
    // value that reads as "a parameter was rejected", which parks the job as
    // `stalled` and invites "Check again" to retry a task that cannot exist.
    kie.createTask = [{ taskId: 'task-null-record' }]
    kie.recordInfo = [{ code: 422, msg: 'recordInfo is null' }]

    const id = await insertGeneration()
    await new JobRunner().enqueue(id)

    const generation = await readGeneration(id)
    assert.equal(generation.state, 'orphaned')
    assert.equal(generation.failCode, 'local/task_not_found')
    assert.equal(kie.calls.recordInfo, 1, 'gives up rather than retrying a task that cannot exist')
  })
})

describe('rate limiting', () => {
  it('backs off and resubmits a 429 instead of dropping the job', async () => {
    // Kie rejects excess submissions outright rather than queueing them, so a
    // dropped 429 is a silently lost generation.
    kie.createTask = [
      { code: 429, msg: 'Rate limit exceeded' },
      { taskId: 'task-after-429' },
    ]
    kie.recordInfo = [successRecord('task-after-429')]

    const id = await insertGeneration()
    await new JobRunner().enqueue(id)

    const generation = await readGeneration(id)
    assert.equal(generation.state, 'complete')
    assert.equal(generation.kieTaskId, 'task-after-429')
    assert.equal(kie.calls.createTask, 2)
  })

  it('gives up on an error that retrying cannot fix', async () => {
    kie.createTask = [{ code: 422, msg: 'duration must be a string' }]

    const id = await insertGeneration()
    await new JobRunner().enqueue(id)

    const generation = await readGeneration(id)
    assert.equal(generation.state, 'failed')
    assert.equal(generation.failCode, 'local/submit_failed')
    // Kie's own wording is carried through, since it names the offending field.
    assert.match(generation.failMsg ?? '', /duration must be a string/)
    assert.equal(kie.calls.createTask, 1)
  })
})

describe('restart recovery', () => {
  it('resumes a generation left mid-flight by a restart', async () => {
    // The row a killed server leaves behind: submitted, polling, no result yet.
    const id = await insertGeneration({
      state: 'generating',
      kieTaskId: 'task-interrupted',
      submittedAt: Date.now() - 30_000,
      pollAttempts: 4,
    })
    kie.recordInfo = [successRecord('task-interrupted')]

    const runner = new JobRunner()
    const resumed = await runner.recover()
    assert.ok(resumed.includes(id))

    await runner.enqueue(id)

    const generation = await readGeneration(id)
    assert.equal(generation.state, 'complete')
    // Resumed, not resubmitted — a second createTask would pay for it twice.
    assert.equal(kie.calls.createTask, 0)
    assert.equal(generation.kieTaskId, 'task-interrupted')
    assert.equal((await readAssets(id)).length, 1)
  })

  it('leaves finished generations alone', async () => {
    const done = await insertGeneration({ state: 'complete' })
    const dead = await insertGeneration({ state: 'failed' })

    const resumed = await new JobRunner().recover()

    assert.equal(resumed.includes(done), false)
    assert.equal(resumed.includes(dead), false)
  })
})

describe('a task that outruns its poll budget', () => {
  it('parks as stalled rather than failed, keeping the task id', async () => {
    // Video models get 20 minutes; this row was submitted an hour ago and Kie
    // still reports it running.
    const id = await insertGeneration({
      state: 'generating',
      kieTaskId: 'task-slow',
      submittedAt: Date.now() - 60 * 60_000,
    })
    kie.recordInfo = [runningRecord('task-slow'), successRecord('task-slow')]

    const runner = new JobRunner()
    await runner.enqueue(id)

    const stalled = await readGeneration(id)
    // Not `failed`: the task may well still be running, and the id is the only
    // way back to it.
    assert.equal(stalled.state, 'stalled')
    assert.equal(stalled.failCode, 'local/poll_timeout')
    assert.equal(stalled.kieTaskId, 'task-slow')

    // "Check again" gets a fresh budget, so it does not stall on its first look.
    assert.equal(await runner.retry(id), true)
    await runner.enqueue(id)

    const recovered = await readGeneration(id)
    assert.equal(recovered.state, 'complete')
    assert.equal(kie.calls.createTask, 0, 'resumed, never resubmitted')
  })
})

describe('a download that fails', () => {
  it('lands in needs_retry, never complete', async () => {
    // Kie succeeded and was paid for; the result URL is good for 14 days. This
    // is recoverable, so it must not be recorded as a failed generation.
    const runner = new JobRunner({
      download: async () => {
        throw new DownloadError(RESULT_URL, 4, new Error('HTTP 503'))
      },
    })

    const id = await insertGeneration()
    await runner.enqueue(id)

    const generation = await readGeneration(id)
    assert.equal(generation.state, 'needs_retry')
    assert.equal(generation.failCode, 'local/download_failed')
    assert.equal((await readAssets(id)).length, 0)
  })

  it('completes on a retry once the download works', async () => {
    let failNext = true
    const runner = new JobRunner({
      download: async (generation, result) => {
        if (failNext) {
          failNext = false
          throw new DownloadError(RESULT_URL, 4, new Error('HTTP 503'))
        }
        const { downloadGenerationAssets } = await import('./downloader.ts')
        return downloadGenerationAssets(generation, result)
      },
    })

    const id = await insertGeneration()
    await runner.enqueue(id)
    assert.equal((await readGeneration(id)).state, 'needs_retry')

    assert.equal(await runner.retry(id), true)
    await runner.enqueue(id)

    const generation = await readGeneration(id)
    assert.equal(generation.state, 'complete')
    assert.equal(generation.failCode, null, 'the stale failure is cleared')
    assert.equal((await readAssets(id)).length, 1)
  })

  it('treats a success carrying no URLs as failed, not retryable', async () => {
    kie.createTask = [{ taskId: 'task-empty' }]
    kie.recordInfo = [
      {
        taskId: 'task-empty',
        model: MODEL.slug,
        state: 'success',
        resultJson: JSON.stringify({ resultUrls: [] }),
      },
    ]

    const id = await insertGeneration()
    await new JobRunner().enqueue(id)

    const generation = await readGeneration(id)
    // Retrying would poll the same empty result forever.
    assert.equal(generation.state, 'failed')
    assert.equal(generation.failCode, 'local/download_failed')
  })
})

describe('a webhook callback', () => {
  it('cuts the poll backoff short instead of driving the state itself', async () => {
    kie.createTask = [{ taskId: 'task-callback' }]
    kie.recordInfo = [runningRecord('task-callback'), successRecord('task-callback')]

    const id = await insertGeneration()
    const runner = new JobRunner()
    const startedAt = Date.now()
    const job = runner.enqueue(id)

    // The callback lands while the loop is sitting in its 3s backoff.
    await waitFor(async () => (await readGeneration(id)).state === 'generating')
    assert.equal(runner.notify(id), 'woken')
    await job

    const elapsed = Date.now() - startedAt
    assert.equal((await readGeneration(id)).state, 'complete')
    assert.ok(
      elapsed < POLL_BACKOFF_MS,
      `polled early (${elapsed}ms), rather than waiting out the ${POLL_BACKOFF_MS}ms backoff`,
    )
    // Still two recordInfo calls: the callback shortened a wait, it did not
    // supply the state. The webhook is never authoritative.
    assert.equal(kie.calls.recordInfo, 2)
  })

  it('restarts a loop that had already parked the generation', async () => {
    // The poller gave up at the 20-minute ceiling; Kie finished afterwards and
    // said so. Nothing is sleeping, so the callback starts the loop again.
    const id = await insertGeneration({
      state: 'stalled',
      kieTaskId: 'task-late-callback',
      submittedAt: Date.now(),
    })
    kie.recordInfo = [successRecord('task-late-callback')]

    const runner = new JobRunner()
    assert.equal(runner.notify(id), 'enqueued')

    await waitFor(async () => (await readGeneration(id)).state === 'complete')
    assert.equal(kie.calls.createTask, 0, 'resumed, never resubmitted')
  })
})

describe('bulk recovery', () => {
  it('resumes both parked states and leaves settled generations alone', async () => {
    const stalled = await insertGeneration({
      state: 'stalled',
      kieTaskId: 'task-bulk-stalled',
      submittedAt: Date.now(),
    })
    const undownloaded = await insertGeneration({
      state: 'needs_retry',
      kieTaskId: 'task-bulk-download',
      submittedAt: Date.now(),
    })
    const done = await insertGeneration({
      state: 'complete',
      kieTaskId: 'task-bulk-done',
    })
    kie.recordInfo = [successRecord('task-bulk')]

    const runner = new JobRunner()
    const resumed = await runner.retryAll()

    assert.ok(resumed.includes(stalled), 'a stalled poll is picked up')
    assert.ok(resumed.includes(undownloaded), 'a failed download is picked up')
    assert.equal(resumed.includes(done), false, 'a finished generation is not')

    // Await every row it touched — including any left parked by an earlier test
    // — so nothing is still polling when the fetch stub is torn down.
    await waitFor(async () => {
      for (const rid of resumed) {
        const state = (await readGeneration(rid)).state
        if (state !== 'complete' && state !== 'failed') return false
      }
      return true
    })
    assert.equal(kie.calls.createTask, 0, 'resumed from the stored task ids')
  })
})

describe('one loop per generation', () => {
  it('joins an existing job rather than starting a second', async () => {
    kie.createTask = [{ taskId: 'task-once' }]
    kie.recordInfo = [runningRecord('task-once'), successRecord('task-once')]

    const id = await insertGeneration()
    const runner = new JobRunner()

    // Two tabs, two enqueues — Kie must still see one submission.
    await Promise.all([runner.enqueue(id), runner.enqueue(id), runner.enqueue(id)])

    assert.equal(kie.calls.createTask, 1)
    assert.equal((await readGeneration(id)).state, 'complete')
  })
})

/** Polls a condition without a fixed sleep, so the test is not timing-fragile. */
async function waitFor(condition: () => Promise<boolean>, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('Timed out waiting for a condition.')
}
