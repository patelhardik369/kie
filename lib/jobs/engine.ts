import 'server-only'

import { eq } from 'drizzle-orm'

import { withStoredKey } from '../auth/kie-key.ts'
import { generations, getDb, type Generation, type GenerationState } from '../db/index.ts'
import { webhooksEnabled, getEnv } from '../env.ts'
import { isKieError, KieError } from '../kie/errors.ts'
import { POLL_TIMEOUT_MS, isTerminal, pollDelayMs } from '../kie/polling.ts'
import { getModel } from '../kie/registry/index.ts'
import { createTask, getTask, type Task } from '../kie/tasks.ts'
import { sampleBalance } from '../library/balance.ts'
import { downloadGenerationAssets } from './downloader.ts'
import { claimOne, release, settle, workerId } from './lease.ts'

/**
 * One step of one generation.
 *
 * The old runner held a `for(;;)` loop per job, sleeping between polls, and that
 * worked because the process outlived the job. On a serverless host it cannot:
 * the invocation ends when the response is sent, taking every pending timer with
 * it. So the loop is turned inside out. Each call does **at most one thing** —
 * submit, or poll once, or download — writes what it learned, and says when to
 * come back. The database holds the position in the loop that a `for` statement
 * used to.
 *
 * That inversion is what makes the same code correct under three very different
 * drivers, all of which now exist (see lib/jobs/drive.ts):
 *
 *   - the inline burst on the submitting request,
 *   - a cron tick,
 *   - the status poll of an open tab.
 *
 * None of them knows about the others. All of them are safe, because a step only
 * runs under a lease.
 */

/** Local fail codes. Prefixed so they can never be mistaken for Kie's own. */
export const LOCAL_FAIL = {
  submit: 'local/submit_failed',
  poll: 'local/poll_failed',
  download: 'local/download_failed',
  timeout: 'local/poll_timeout',
  notFound: 'local/task_not_found',
  noKey: 'local/no_api_key',
} as const

/** Consecutive poll errors tolerated before the job is parked as stalled. */
const MAX_POLL_ERRORS = 3

/** What one step did, so a driver can decide whether to keep going. */
export type StepOutcome =
  | { status: 'skipped'; reason: 'not_found' | 'leased' | 'terminal' }
  | { status: 'progressed'; state: GenerationState; nextPollAt: number }
  | { status: 'settled'; state: GenerationState }

/**
 * Advances one generation by a single step, under a lease.
 *
 * Returns `skipped` rather than throwing when the job is finished or held
 * elsewhere: every driver calls this speculatively, and "someone else has it"
 * is the normal case, not an error.
 */
export async function step(id: string, owner = workerId()): Promise<StepOutcome> {
  const generation = await claimOne(id, owner)
  if (!generation) {
    const [row] = await getDb()
      .select({ state: generations.state })
      .from(generations)
      .where(eq(generations.id, id))
      .limit(1)
    if (!row) return { status: 'skipped', reason: 'not_found' }
    return {
      status: 'skipped',
      reason: isSettled(row.state) ? 'terminal' : 'leased',
    }
  }

  return stepClaimed(generation, owner)
}

/**
 * The step itself, for a generation whose lease is already held.
 *
 * Split out so the tick can claim a batch in one query and then work through it
 * without re-claiming each row.
 */
export async function stepClaimed(
  generation: Generation,
  owner: string,
): Promise<StepOutcome> {
  try {
    // Everything below spends the submitter's key, not the server's. Resolved
    // once per step from the sealed copy on the row, because no browser is
    // necessarily present to supply it.
    return await withStoredKey(generation.kieKeyEnc, generation.id, () =>
      runStep(generation, owner),
    )
  } catch (error) {
    // The only way out of withStoredKey is a missing or unsealable key, which
    // is not retryable by a timer — it needs a browser to re-arm it.
    await patch(generation.id, {
      state: 'stalled',
      failCode: LOCAL_FAIL.noKey,
      failMsg: describe(error),
    })
    await release(generation.id, owner, Date.now() + 60_000)
    return { status: 'progressed', state: 'stalled', nextPollAt: Date.now() + 60_000 }
  }
}

async function runStep(generation: Generation, owner: string): Promise<StepOutcome> {
  // Phase 1 — no task id yet. Submit, and stop; the poll is the next step's job.
  if (!generation.kieTaskId) {
    return submitStep(generation, owner)
  }

  // Phase 3 — Kie already said success and the store failed. Retry the store
  // without re-polling: the result is known and re-polling would waste a call.
  if (generation.state === 'downloading' || generation.state === 'needs_retry') {
    if (generation.resultJsonRaw) {
      return downloadStep(generation, owner, generation.resultJsonRaw)
    }
  }

  // Phase 2 — poll once.
  return pollStep(generation, owner)
}

/** Creates the task. One attempt per step; a retryable failure comes back later. */
async function submitStep(generation: Generation, owner: string): Promise<StepOutcome> {
  const env = getEnv()
  const attempts = generation.pollAttempts ?? 0

  try {
    const taskId = await createTask({
      model: generation.modelSlug,
      input: safeParse(generation.inputJson),
      // Requested only when Kie can actually reach us. A callback merely brings
      // the next poll forward; it is never the source of truth.
      ...(webhooksEnabled() ? { callBackUrl: `${env.publicUrl}/api/kie/webhook` } : {}),
    })

    await patch(generation.id, {
      kieTaskId: taskId,
      state: 'waiting',
      submittedAt: Date.now(),
      pollAttempts: 0,
      failCode: null,
      failMsg: null,
    })
    // Straight back for the first poll — a fast image model can already be done.
    const next = Date.now() + pollDelayMs(0)
    await release(generation.id, owner, next)
    return { status: 'progressed', state: 'waiting', nextPollAt: next }
  } catch (error) {
    const retryable = isKieError(error) && error.retryable
    // Five attempts, counted in the same column the poller uses — before a task
    // id exists that column has no other meaning.
    if (!retryable || attempts + 1 >= 5) {
      return fail(generation.id, owner, LOCAL_FAIL.submit, describe(error))
    }

    await patch(generation.id, { pollAttempts: attempts + 1 })
    // A 429 means our accounting is behind Kie's; back off harder than a poll would.
    const delay = isKieError(error) && error.kind === 'rate_limited' ? 10_000 : 5_000
    const next = Date.now() + delay
    await release(generation.id, owner, next)
    return { status: 'progressed', state: generation.state, nextPollAt: next }
  }
}

/** Reads `recordInfo` once and records what it said. */
async function pollStep(generation: Generation, owner: string): Promise<StepOutcome> {
  const taskId = generation.kieTaskId!
  const attempt = (generation.pollAttempts ?? 0) + 1

  let task: Task
  try {
    // The slug rides along because it selects the polling transport — Veo
    // answers on a different endpoint. A lookup, not a branch: this function
    // still has no idea which transport it got.
    task = await getTask(taskId, undefined, generation.modelSlug)
  } catch (error) {
    return pollError(generation, owner, error, attempt)
  }

  if (task.state === 'success') {
    await patch(generation.id, {
      state: 'downloading',
      resultJsonRaw: task.resultJson ?? null,
      creditsConsumed: task.creditsConsumed ?? null,
      costTimeMs: task.costTime ?? null,
      pollAttempts: attempt,
    })
    void recordSpend(generation.workspaceId, task.creditsConsumed)
    // Straight on to the store, in this same step: the result URLs are live now
    // and coming back for them later only widens the window in which they are not.
    return downloadStep({ ...generation, state: 'downloading' }, owner, task.resultJson, task)
  }

  if (task.state === 'fail') {
    // Verbatim, always. A paraphrased moderation message makes it impossible to
    // work out what tripped it.
    await patch(generation.id, {
      state: 'failed',
      resultJsonRaw: task.resultJson ?? null,
      failCode: task.failCode ?? null,
      failMsg: task.failMsg ?? null,
      creditsConsumed: task.creditsConsumed ?? null,
      costTimeMs: task.costTime ?? null,
      pollAttempts: attempt,
      completedAt: Date.now(),
    })
    // A failed generation is not always a free one — a task that ran and then
    // tripped moderation still bills.
    void recordSpend(generation.workspaceId, task.creditsConsumed)
    await settle(generation.id)
    return { status: 'settled', state: 'failed' }
  }

  if (isTerminal(task.state)) {
    await release(generation.id, owner, Date.now() + pollDelayMs(attempt))
    return { status: 'progressed', state: generation.state, nextPollAt: Date.now() }
  }

  // Still running. Record the reported state and check the budget.
  const startedAt = generation.submittedAt ?? generation.createdAt ?? Date.now()
  const elapsed = Date.now() - startedAt

  if (elapsed >= budgetFor(generation.modelSlug)) {
    // Stalled, not failed: the task may well still be running upstream, and a
    // retry can pick it back up from its task id.
    await patch(generation.id, {
      state: 'stalled',
      failCode: LOCAL_FAIL.timeout,
      failMsg:
        `Still ${task.state} after ${Math.round(elapsed / 1000)}s. ` +
        'The task may still be running on Kie — check again to resume polling.',
      pollAttempts: attempt,
    })
    // Deliberately NOT settled: the stored key stays, so "check again" can
    // resume without a browser having to re-arm it.
    await release(generation.id, owner, Date.now() + 60_000)
    return { status: 'progressed', state: 'stalled', nextPollAt: Date.now() + 60_000 }
  }

  await patch(generation.id, {
    state: task.state as GenerationState,
    pollAttempts: attempt,
  })
  const next = Date.now() + pollDelayMs(attempt - 1)
  await release(generation.id, owner, next)
  return { status: 'progressed', state: task.state as GenerationState, nextPollAt: next }
}

async function pollError(
  generation: Generation,
  owner: string,
  error: unknown,
  attempt: number,
): Promise<StepOutcome> {
  if (isKieError(error) && error.kind === 'not_found') {
    await patch(generation.id, {
      state: 'orphaned',
      failCode: LOCAL_FAIL.notFound,
      failMsg: error.detail ?? error.message,
      completedAt: Date.now(),
    })
    await settle(generation.id)
    return { status: 'settled', state: 'orphaned' }
  }

  const rateLimited = isKieError(error) && error.kind === 'rate_limited'
  // A 429 on a poll is noise a driver absorbs — it costs a delay, not one of the
  // job's three lives. Errors are counted in `pollAttempts` because on a
  // stateless worker there is nowhere else to keep the count.
  const errors = rateLimited ? attempt : attempt + 1

  if (!rateLimited && (errors > (generation.pollAttempts ?? 0) + MAX_POLL_ERRORS || !retryable(error))) {
    await patch(generation.id, {
      state: 'stalled',
      failCode: LOCAL_FAIL.poll,
      failMsg: describe(error),
      pollAttempts: attempt,
    })
    await release(generation.id, owner, Date.now() + 60_000)
    return { status: 'progressed', state: 'stalled', nextPollAt: Date.now() + 60_000 }
  }

  await patch(generation.id, { pollAttempts: attempt })
  const next = Date.now() + (rateLimited ? 10_000 : pollDelayMs(attempt))
  await release(generation.id, owner, next)
  return { status: 'progressed', state: generation.state, nextPollAt: next }
}

/**
 * Kie's `success` is permission to store, not completion. Only bytes in the
 * bucket make a generation `complete`.
 */
async function downloadStep(
  generation: Generation,
  owner: string,
  resultJson: string | null | undefined,
  task?: Task,
): Promise<StepOutcome> {
  const { parseResultJson } = await import('../kie/result.ts')
  const result = task?.result ?? parseResultJson(resultJson ?? null)

  if (result.urls.length === 0) {
    // Terminal success with nothing to fetch is a Kie-side anomaly, not a
    // transient one — retrying would read the same empty result forever.
    return fail(
      generation.id,
      owner,
      LOCAL_FAIL.download,
      'Kie reported success but returned no result URLs. ' +
        `Raw resultJson kept for forensics: ${resultJson ?? 'null'}`,
    )
  }

  try {
    await downloadGenerationAssets(generation, result)
    await patch(generation.id, {
      state: 'complete',
      failCode: null,
      failMsg: null,
      completedAt: Date.now(),
    })
    await settle(generation.id)
    return { status: 'settled', state: 'complete' }
  } catch (error) {
    // needs_retry, NOT failed: the generation succeeded and was paid for, and
    // the result URL stays valid for about fourteen days. This is recoverable.
    await patch(generation.id, {
      state: 'needs_retry',
      failCode: LOCAL_FAIL.download,
      failMsg: describe(error),
    })
    const next = Date.now() + 30_000
    await release(generation.id, owner, next)
    return { status: 'progressed', state: 'needs_retry', nextPollAt: next }
  }
}

async function fail(
  id: string,
  owner: string,
  code: string,
  message: string,
): Promise<StepOutcome> {
  await patch(id, {
    state: 'failed',
    failCode: code,
    failMsg: message,
    completedAt: Date.now(),
  })
  await settle(id)
  return { status: 'settled', state: 'failed' }
}

// -------------------------------------------------------------- helpers

function patch(id: string, values: Partial<Generation>) {
  return getDb().update(generations).set(values).where(eq(generations.id, id))
}

/**
 * Logs a balance reading, but only when Kie says credits actually moved.
 *
 * Fire-and-forget: the store is the next thing to happen after a success, and it
 * must not queue behind bookkeeping. `sampleBalance` swallows its own failures.
 */
async function recordSpend(
  workspaceId: string,
  creditsConsumed: number | null | undefined,
): Promise<void> {
  if (!creditsConsumed) return
  await sampleBalance(workspaceId).catch(() => undefined)
}

function isSettled(state: GenerationState): boolean {
  return state === 'complete' || state === 'failed' || state === 'orphaned'
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** Images get 5 minutes, video 20 (docs/API-CONTRACT.md §3). */
function budgetFor(modelSlug: string): number {
  return getModel(modelSlug)?.outputKind === 'video'
    ? POLL_TIMEOUT_MS.video
    : POLL_TIMEOUT_MS.image
}

function retryable(error: unknown): boolean {
  // A non-Kie error here is a network or runtime fault — worth one more try.
  return isKieError(error) ? error.retryable : true
}

function describe(error: unknown): string {
  if (error instanceof KieError) {
    return error.detail ? `${error.message} (${error.detail})` : error.message
  }
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` — ${error.cause.message}` : ''
    return `${error.message}${cause}`
  }
  return String(error)
}
