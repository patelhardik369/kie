import 'server-only'

import { kieRequest } from './client.ts'
import { isKieError, KieError } from './errors.ts'
import {
  POLL_TIMEOUT_MS,
  isTerminal,
  pollDelayMs,
  type TaskState,
} from './polling.ts'
import { getModel } from './registry/index.ts'
import { parseResultJson, type ParsedResult } from './result.ts'
import { createVeoTask, getVeoRecord } from './veo.ts'

// Poll policy lives in polling.ts (pure, testable, reusable by the job runner).
export {
  POLL_SCHEDULE_MS,
  POLL_TIMEOUT_MS,
  SUBMIT_RATE_LIMIT,
  TASK_STATES,
  TERMINAL_STATES,
  isTerminal,
  pollDelayMs,
  type TaskState,
} from './polling.ts'

/** Raw `data` from `GET /jobs/recordInfo`. */
export interface TaskRecord {
  taskId: string
  model: string
  state: TaskState
  /** The request `input`, JSON-encoded, echoed back. */
  param?: string | null
  /** JSON-encoded STRING. Use `parseResultJson`. Null until terminal. */
  resultJson?: string | null
  failCode?: string | null
  failMsg?: string | null
  costTime?: number | null
  completeTime?: number | null
  createTime?: number | null
  updateTime?: number | null
  creditsConsumed?: number | null
  /** Reported by sora2 models only; absent for everything in scope. */
  progress?: number | null
}

/** A task record with `resultJson` already parsed. */
export interface Task extends TaskRecord {
  result: ParsedResult
}

export interface CreateTaskParams {
  /** Exact registry slug, e.g. `kling-3.0-omni/text-to-video`. */
  model: string
  input: Record<string, unknown>
  /**
   * Omit on localhost — Kie cannot reach it, and the poller handles completion.
   * Callers should pass this only when webhooksEnabled() is true.
   */
  callBackUrl?: string
  signal?: AbortSignal
}

/**
 * Submits a generation task.
 *
 * A successful return means the task was CREATED, not completed. Nothing has
 * been generated yet — treat the taskId as a receipt.
 */
export async function createTask(params: CreateTaskParams): Promise<string> {
  const { model, input, callBackUrl, signal } = params

  // The ONE place the two transports diverge on submission. Everything above
  // this line — the runner, the routes, the smoke script — passes a slug and an
  // input and never learns which contract answered.
  if (transportFor(model) === 'veo') {
    return createVeoTask({ model, input, callBackUrl, signal })
  }

  const data = await kieRequest<{ taskId?: string }>('/jobs/createTask', {
    method: 'POST',
    body: { model, input, ...(callBackUrl ? { callBackUrl } : {}) },
    signal,
  })

  const taskId = data?.taskId
  if (!taskId) {
    throw new KieError({
      code: 200,
      kind: 'unknown',
      retryable: false,
      message: 'Kie accepted the task but returned no taskId.',
    })
  }
  return taskId
}

/**
 * `recordInfo`'s answer for a taskId it has never heard of.
 *
 * Verified against the live API: an unknown id comes back as
 * `{"code":422,"msg":"recordInfo is null","data":null}` — a 404 is never sent.
 * Left as a plain 422 it reads as "the model rejected a parameter", which sends
 * you looking for a bad enum on a task that simply does not exist, and parks
 * the job as `stalled` so "Check again" retries it forever.
 */
const NO_SUCH_TASK = /recordinfo is null/i

/**
 * The transport a slug speaks, defaulting to the unified endpoint.
 *
 * An unknown slug falls back to `jobs` rather than throwing: a generation row
 * whose model was renamed upstream must still be pollable, and `/jobs/recordInfo`
 * is the right guess for 96 of 97 models.
 */
function transportFor(modelSlug: string): 'jobs' | 'veo' {
  return getModel(modelSlug)?.transport ?? 'jobs'
}

/**
 * Fetches a task and parses its `resultJson`.
 *
 * `modelSlug` is optional only because a caller that already knows the task is a
 * `jobs` one should not be forced to look it up. Pass it whenever you have it —
 * without it a Veo task would be polled against the wrong endpoint. The job
 * runner always has it: it is a column on the row it is polling.
 */
export async function getTask(
  taskId: string,
  signal?: AbortSignal,
  modelSlug?: string,
): Promise<Task> {
  if (modelSlug && transportFor(modelSlug) === 'veo') {
    const record = await getVeoRecord(taskId, modelSlug, signal)
    return { ...record, result: parseResultJson(record.resultJson) }
  }

  let record: TaskRecord
  try {
    record = await kieRequest<TaskRecord>('/jobs/recordInfo', {
      query: { taskId },
      signal,
    })
  } catch (error) {
    // Only for this endpoint: a 422 from createTask really is a bad parameter.
    if (isKieError(error) && error.code === 422 && NO_SUCH_TASK.test(error.detail ?? '')) {
      throw new KieError({
        code: 404,
        kind: 'not_found',
        retryable: false,
        message: `Kie has no record of task ${taskId}.`,
        detail: error.detail,
        cause: error,
      })
    }
    throw error
  }

  return { ...record, result: parseResultJson(record?.resultJson) }
}

export class TaskTimeoutError extends Error {
  // Written out rather than declared as constructor parameter properties —
  // Node's type-stripping runtime rejects those, and lib/kie must stay
  // importable from plain-Node scripts and tests.
  readonly taskId: string
  readonly lastState: TaskState
  readonly elapsedMs: number

  constructor(taskId: string, lastState: TaskState, elapsedMs: number) {
    super(
      `Task ${taskId} still ${lastState} after ${Math.round(elapsedMs / 1000)}s. ` +
        'It may still be running on Kie — mark it stalled rather than failed.',
    )
    this.name = 'TaskTimeoutError'
    this.taskId = taskId
    this.lastState = lastState
    this.elapsedMs = elapsedMs
  }
}

export interface WaitOptions {
  timeoutMs?: number
  signal?: AbortSignal
  /** Called after each poll, for progress display. */
  onPoll?: (task: Task, attempt: number) => void
  /** Required for a Veo task — it selects the polling endpoint. */
  model?: string
}

/**
 * Polls until the task is terminal.
 *
 * A convenience primitive for scripts and the smoke test. The job runner does
 * NOT use this — it owns a single shared loop across all tasks so that two
 * browser tabs cannot double the poll rate.
 *
 * Resolves on both `success` and `fail`; a failed generation is a legitimate
 * outcome carrying failCode/failMsg, not an exception.
 */
export async function waitForTask(
  taskId: string,
  options: WaitOptions = {},
): Promise<Task> {
  const { timeoutMs = POLL_TIMEOUT_MS.video, signal, onPoll, model } = options
  const startedAt = Date.now()

  for (let attempt = 0; ; attempt++) {
    const task = await getTask(taskId, signal, model)
    onPoll?.(task, attempt)

    if (isTerminal(task.state)) return task

    const elapsed = Date.now() - startedAt
    if (elapsed >= timeoutMs) {
      throw new TaskTimeoutError(taskId, task.state, elapsed)
    }

    await sleep(Math.min(pollDelayMs(attempt), timeoutMs - elapsed), signal)
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal!.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
