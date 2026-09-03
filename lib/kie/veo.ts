import 'server-only'

import { kieRequest } from './client.ts'
import { isKieError, KieError } from './errors.ts'
import type { TaskState } from './polling.ts'
import type { TaskRecord } from './tasks.ts'

/**
 * The Veo 3.1 transport, adapted to look exactly like the unified one.
 *
 * Veo predates Kie's market API and never moved onto it. It posts a FLAT body to
 * `/veo/generate` — no `input` wrapper — and reports progress as a numeric
 * `successFlag` from `/veo/record-info` rather than a `state` string.
 *
 * Everything in this file exists so that no other file has to know that. The job
 * runner, the downloader, the gallery and the parameter form all keep calling
 * `createTask` / `getTask` and keep receiving a `Task`. If you find yourself
 * testing `model.transport` outside lib/kie/, this adapter is leaking — fix it
 * here rather than branching there. See .claude/skills/kie-api/SKILL.md §2b.
 */

const GENERATE_PATH = '/veo/generate'
const RECORD_PATH = '/veo/record-info'

/**
 * Veo's progress vocabulary.
 *
 * The schema's `enum` lists 0, 1, 2 while its own description documents a third
 * failure value, 3 ("Generation Failed"). Anything that is not 0 or 1 is
 * therefore treated as terminal failure — the alternative is polling a finished
 * job until the timeout budget runs out and parking it as `stalled`.
 */
const FLAG_GENERATING = 0
const FLAG_SUCCESS = 1

export interface VeoResponse {
  taskId?: string | null
  resultUrls?: string[] | null
  /** Populated only after `/veo/extend`. Not downloaded. */
  fullResultUrls?: string[] | null
  /** Pre-processing renders. Not downloaded. */
  originUrls?: string[] | null
  resolution?: string | null
}

/** Raw `data` from `GET /veo/record-info`. */
export interface VeoRecord {
  taskId?: string
  /** The request body, JSON-encoded, echoed back. Named `param` on /jobs. */
  paramJson?: string | null
  response?: VeoResponse | null
  successFlag?: number | null
  errorCode?: number | string | null
  errorMessage?: string | null
  createTime?: number | null
  completeTime?: number | null
}

export interface CreateVeoTaskParams {
  /** `veo3`, `veo3_fast`, or `veo3_lite` — the slug is the API's `model` value. */
  model: string
  /** Validated model parameters. Sent FLAT, merged with `model`. */
  input: Record<string, unknown>
  callBackUrl?: string
  signal?: AbortSignal
}

/**
 * Submits a Veo generation.
 *
 * The body is flat by design: `{ model, prompt, imageUrls, ... }`. Spreading
 * `input` last would let a stored `input_json` overwrite `model` — the slug is
 * what routes the request, so it is written after the spread and wins.
 */
export async function createVeoTask(params: CreateVeoTaskParams): Promise<string> {
  const { model, input, callBackUrl, signal } = params

  const data = await kieRequest<{ taskId?: string }>(GENERATE_PATH, {
    method: 'POST',
    body: {
      ...input,
      model,
      ...(callBackUrl ? { callBackUrl } : {}),
    },
    signal,
  })

  const taskId = data?.taskId
  if (!taskId) {
    throw new KieError({
      code: 200,
      kind: 'unknown',
      retryable: false,
      message: 'Kie accepted the Veo task but returned no taskId.',
    })
  }
  return taskId
}

/**
 * `successFlag` -> the `TaskState` the rest of the app speaks.
 *
 * Anything that is not 0 or 1 is a failure. The schema's `enum` stops at 2 while
 * its own description documents 3 as "Generation Failed", so treating only 2 as
 * terminal would poll a dead job until the timeout budget ran out and then park
 * it as `stalled` — a state whose whole meaning is "retrying may still work".
 *
 * Veo has no equivalent of `waiting` or `queuing`, so a Veo job never reports
 * them. Nothing depends on it: `isTerminal()` is all that reads a state.
 */
export function veoState(flag: number | null | undefined): TaskState {
  if (flag === FLAG_SUCCESS) return 'success'
  if (flag === FLAG_GENERATING || flag === null || flag === undefined) return 'generating'
  return 'fail'
}

/**
 * Normalizes a `/veo/record-info` payload into a `TaskRecord`.
 *
 * Split out from the fetch so the mapping — the part with the actual decisions
 * in it — is testable without a network or a fake envelope.
 */
export function veoRecordToTask(
  record: VeoRecord | null | undefined,
  taskId: string,
  model: string,
): TaskRecord {
  const state = veoState(record?.successFlag)
  const urls = record?.response?.resultUrls ?? undefined

  return {
    taskId: record?.taskId ?? taskId,
    model,
    state,
    param: record?.paramJson ?? null,
    /*
     * Re-encoded rather than passed through as an object: `result_json_raw`
     * stores one shape for all 82 models, and a Veo row holding a bare object
     * would break every consumer that parses that column.
     */
    resultJson: urls ? JSON.stringify({ resultUrls: urls }) : null,
    failCode: state === 'fail' ? String(record?.errorCode ?? record?.successFlag) : null,
    failMsg: state === 'fail' ? (record?.errorMessage ?? null) : null,
    createTime: record?.createTime ?? null,
    completeTime: record?.completeTime ?? null,
    /*
     * Veo reports neither. `costTime` is derivable from the two timestamps;
     * `creditsConsumed` is not derivable from anything, and inventing a number
     * would put a wrong figure on the generation row and in the spend total. So
     * it stays null and the gallery renders it as unknown.
     */
    costTime:
      record?.completeTime && record?.createTime
        ? record.completeTime - record.createTime
        : null,
    creditsConsumed: null,
  }
}

/** `record-info`'s answer for a taskId it has never heard of. */
const NO_SUCH_TASK = /record is null|record result data (not exist|is blank|is empty)/i

/**
 * Fetches a Veo task and normalizes it into a `TaskRecord`.
 *
 * `resultJson` is re-encoded rather than passed through as an object, because
 * `generations.result_json_raw` stores one shape for all 82 models. A Veo row
 * that held a bare object would break every consumer that parses that column.
 */
export async function getVeoRecord(
  taskId: string,
  model: string,
  signal?: AbortSignal,
): Promise<TaskRecord> {
  let record: VeoRecord
  try {
    record = await kieRequest<VeoRecord>(RECORD_PATH, { query: { taskId }, signal })
  } catch (error) {
    // Same reasoning as tasks.ts: a "no such record" 422 read literally sends
    // you hunting for a bad enum, and parks the job as retryable forever.
    if (
      isKieError(error) &&
      (error.code === 422 || error.code === 404) &&
      NO_SUCH_TASK.test(error.detail ?? '')
    ) {
      throw new KieError({
        code: 404,
        kind: 'not_found',
        retryable: false,
        message: `Kie has no record of Veo task ${taskId}.`,
        detail: error.detail,
        cause: error,
      })
    }
    throw error
  }

  return veoRecordToTask(record, taskId, model)
}
