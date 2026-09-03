import 'server-only'

import { eq, inArray } from 'drizzle-orm'

import { generations, getDb, type Generation, type GenerationState } from '../db/index.ts'
import { getEnv, webhooksEnabled } from '../env.ts'
// The set of parked-but-recoverable states lives with the other state groupings,
// so the label, the tone and the retry all agree on what "stalled" means.
import { RECOVERABLE_STATES } from '../gallery/display.ts'
import { sampleBalance } from '../library/balance.ts'
import { isKieError, KieError } from '../kie/errors.ts'
import { POLL_TIMEOUT_MS, isTerminal, pollDelayMs } from '../kie/polling.ts'
import { getModel } from '../kie/registry/index.ts'
import { createTask, getTask, type Task } from '../kie/tasks.ts'
import { downloadGenerationAssets } from './downloader.ts'
import { SubmissionGate, defaultSleep } from './gate.ts'

/**
 * The job runner: one per process, owning every submission and every poll.
 *
 * Three reasons it lives on the server rather than in the browser:
 *
 *   1. **One poll per task.** Two open tabs must not double the poll rate and
 *      burn the rate limit; a closed browser must not strand a job.
 *   2. **Rate limiting needs the whole queue.** Only something that can see
 *      every pending submission can keep under 20 per 10s (see gate.ts).
 *   3. **Restart survival.** The database is authoritative, so `recover()` puts
 *      every non-terminal generation back on the poll loop at startup.
 *
 * Polling leads and webhooks follow (docs/API-CONTRACT.md §7): Kie cannot reach
 * localhost, so this loop is the primary completion path and the webhook only
 * ever saves it a poll.
 */

/** States the runner can still make progress on. */
export const RESUMABLE_STATES = [
  'waiting',
  'queuing',
  'generating',
  'downloading',
  'needs_retry',
] as const satisfies readonly GenerationState[]

/** Local fail codes. Prefixed so they can never be mistaken for Kie's own. */
export const LOCAL_FAIL = {
  submit: 'local/submit_failed',
  poll: 'local/poll_failed',
  download: 'local/download_failed',
  timeout: 'local/poll_timeout',
  notFound: 'local/task_not_found',
} as const

/** Submission attempts before a retryable error becomes a failure. */
const MAX_SUBMIT_ATTEMPTS = 5
/** Consecutive poll errors tolerated before the job is parked as stalled. */
const MAX_POLL_ERRORS = 3

/**
 * Abort reason used to wake a sleeping poll loop. A sentinel rather than a bare
 * abort so a genuine abort from anywhere else is still rethrown.
 */
const WAKE = Symbol('kie-studio.wake')

export interface EnqueueOptions {
  /**
   * Restart the poll-timeout clock from now instead of from submission.
   * Set only by `retry()` — see the note there.
   */
  freshBudget?: boolean
}

export interface JobRunnerOptions {
  /**
   * The download step, injectable.
   *
   * Defaults to the real downloader — the happy path deliberately writes real
   * bytes to real disk. The seam exists so the *failure* mapping can be tested:
   * the downloader's own retry schedule spans 19 seconds by design, and a test
   * that asserts "a failed download lands in needs_retry, never complete"
   * should not have to sit through it.
   */
  download?: typeof downloadGenerationAssets
  /**
   * The credit-balance reading taken after a generation that spent credits.
   *
   * Injectable for the same reason `download` is: the tests assert *when* it is
   * taken, and should not have to serve a credits endpoint to do it.
   */
  sampleBalance?: typeof sampleBalance
}

export class JobRunner {
  private readonly gate = new SubmissionGate()
  /** Guarantees one loop per generation, however many callers ask for it. */
  private readonly active = new Map<string, Promise<void>>()
  /**
   * Poll loops currently asleep in their backoff, keyed by generation id.
   *
   * A verified webhook aborts the matching controller, which cuts the backoff
   * short and polls immediately. This is the entire mechanism by which a
   * callback "saves a poll" — it never carries state of its own.
   */
  private readonly waiters = new Map<string, AbortController>()
  private readonly downloadAssets: typeof downloadGenerationAssets
  private readonly sampleBalance: typeof sampleBalance

  constructor(options: JobRunnerOptions = {}) {
    this.downloadAssets = options.download ?? downloadGenerationAssets
    this.sampleBalance = options.sampleBalance ?? sampleBalance
  }

  /** Generations currently being submitted or polled. */
  get activeCount(): number {
    return this.active.size
  }

  /** Submissions counted against the current rate window. */
  get queuedSubmissions(): number {
    return this.gate.pending
  }

  /**
   * Starts (or joins) the job for one generation.
   *
   * Deliberately not awaited by callers: `POST /api/kie/create` returns as soon
   * as the row exists, and the client watches progress through
   * `GET /api/kie/task/[id]`. The browser drives nothing.
   */
  enqueue(generationId: string, options: EnqueueOptions = {}): Promise<void> {
    const existing = this.active.get(generationId)
    if (existing) return existing

    const job = this.run(generationId, options)
      .catch((error) => {
        // The loop persists its own failures; anything reaching here is a bug,
        // and must not become an unhandled rejection that kills the process.
        console.error(`[kie-studio] job ${generationId} crashed:`, error)
      })
      .finally(() => {
        this.active.delete(generationId)
      })

    this.active.set(generationId, job)
    return job
  }

  /**
   * Puts every non-terminal generation back on the loop.
   *
   * Called once at startup from instrumentation.ts. This is what makes an
   * in-flight generation survive a server restart.
   */
  async recover(): Promise<string[]> {
    const rows = await getDb()
      .select({ id: generations.id })
      .from(generations)
      .where(inArray(generations.state, [...RESUMABLE_STATES]))

    for (const row of rows) this.enqueue(row.id)
    return rows.map((r) => r.id)
  }

  /**
   * Re-runs the loop for a generation that stopped short — a `stalled` poll
   * timeout or a `needs_retry` download. The task id is kept, so this resumes
   * rather than resubmitting and paying for the generation twice.
   */
  async retry(generationId: string): Promise<boolean> {
    const generation = await load(generationId)
    if (!generation) return false
    if (generation.state === 'complete' || generation.state === 'failed') return false

    await patch(generationId, { state: 'waiting', pollAttempts: 0 })
    // A manual resume gets a fresh poll budget. Measured from the original
    // submission, a job that stalled at 20 minutes would poll once and stall
    // again — "check again" has to mean more than one look.
    this.enqueue(generationId, { freshBudget: true })
    return true
  }

  /**
   * Resumes every generation parked in a recoverable state.
   *
   * The bulk form of "Check again", for the case a whole batch stalled at once —
   * a laptop asleep through a 20-minute video queue, or a network drop that took
   * out several polls together.
   */
  async retryAll(): Promise<string[]> {
    const rows = await getDb()
      .select({ id: generations.id })
      .from(generations)
      .where(inArray(generations.state, [...RECOVERABLE_STATES]))

    const resumed: string[] = []
    for (const row of rows) {
      if (await this.retry(row.id)) resumed.push(row.id)
    }
    return resumed
  }

  /**
   * A callback says this task moved — poll it now instead of at the end of the
   * backoff.
   *
   * Deliberately does NOT trust the callback's payload. The webhook is never
   * authoritative (docs/API-CONTRACT.md §7): it only ever shortens a wait, and
   * the state still comes from `recordInfo`. That keeps one code path to the
   * state machine whether the callback arrives, arrives twice, or never comes.
   */
  notify(generationId: string): 'woken' | 'polling' | 'enqueued' {
    const waiter = this.waiters.get(generationId)
    if (waiter) {
      waiter.abort(WAKE)
      return 'woken'
    }
    // Mid-request or mid-download: it will see the new state without help.
    if (this.active.has(generationId)) return 'polling'

    this.enqueue(generationId)
    return 'enqueued'
  }

  // ------------------------------------------------------------ the loop

  /**
   * Backoff sleep that a callback can cut short.
   *
   * An abort resolves normally rather than throwing: being woken is the happy
   * path, and letting it surface as a rejection would land in the poll loop's
   * catch and be counted as a poll error.
   */
  private async wait(generationId: string, ms: number): Promise<void> {
    if (ms <= 0) return

    const controller = new AbortController()
    this.waiters.set(generationId, controller)
    try {
      await defaultSleep(ms, controller.signal)
    } catch (error) {
      if (error !== WAKE) throw error
    } finally {
      this.waiters.delete(generationId)
    }
  }

  private async run(generationId: string, options: EnqueueOptions): Promise<void> {
    let generation = await load(generationId)
    if (!generation) return

    if (!generation.kieTaskId) {
      const taskId = await this.submit(generation)
      if (!taskId) return // submit() persisted the failure
      generation = { ...generation, kieTaskId: taskId, submittedAt: Date.now() }
    }

    await this.poll(generation, options.freshBudget ? Date.now() : undefined)
  }

  /**
   * Holds for a rate-limit slot, then creates the task.
   *
   * Returns the task id, or null when the failure was persisted and the job is
   * over. A 429 that slips past the gate is retried, never dropped.
   */
  private async submit(generation: Generation): Promise<string | null> {
    const env = getEnv()
    const input = safeParse(generation.inputJson)

    for (let attempt = 1; attempt <= MAX_SUBMIT_ATTEMPTS; attempt++) {
      await this.gate.acquire()

      try {
        const taskId = await createTask({
          model: generation.modelSlug,
          input,
          // Omitted on localhost: Kie cannot reach it, and requesting a
          // callback it can never deliver only adds a failure mode.
          ...(webhooksEnabled()
            ? { callBackUrl: `${env.publicUrl}/api/kie/webhook` }
            : {}),
        })

        await patch(generation.id, {
          kieTaskId: taskId,
          state: 'waiting',
          submittedAt: Date.now(),
        })
        return taskId
      } catch (error) {
        const retryable = isKieError(error) && error.retryable
        if (!retryable || attempt === MAX_SUBMIT_ATTEMPTS) {
          await this.fail(generation.id, LOCAL_FAIL.submit, describe(error))
          return null
        }

        // Spend a window slot on the rejection too: a 429 means our own
        // accounting is behind Kie's, and the next attempt should be later.
        if (isKieError(error) && error.kind === 'rate_limited') this.gate.record()
        await defaultSleep(pollDelayMs(attempt - 1))
      }
    }

    return null
  }

  /** Polls one task to a terminal state, then hands off to the downloader. */
  private async poll(generation: Generation, budgetFrom?: number): Promise<void> {
    const taskId = generation.kieTaskId!
    const budgetMs = timeoutFor(generation.modelSlug)
    // Normally the clock runs from submission, so a job resumed after a restart
    // inherits the time it already spent rather than getting a second budget.
    const startedAt =
      budgetFrom ?? generation.submittedAt ?? generation.createdAt ?? Date.now()

    let attempt = generation.pollAttempts ?? 0
    let consecutiveErrors = 0

    for (;;) {
      try {
        // The slug rides along because it selects the polling transport — Veo
        // answers on a different endpoint. This is a lookup, not a branch: the
        // runner still has no idea which transport it got.
        const task = await getTask(taskId, undefined, generation.modelSlug)
        consecutiveErrors = 0
        attempt += 1

        if (task.state === 'success') {
          await patch(generation.id, {
            state: 'downloading',
            resultJsonRaw: task.resultJson ?? null,
            creditsConsumed: task.creditsConsumed ?? null,
            costTimeMs: task.costTime ?? null,
            pollAttempts: attempt,
          })
          this.recordSpend(task.creditsConsumed)
          await this.download(generation, task.result, task)
          return
        }

        if (task.state === 'fail') {
          // Verbatim, always. A paraphrased moderation message makes it
          // impossible to work out what tripped it.
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
          // A failed generation is not always a free one — a task that ran and
          // then tripped moderation still bills.
          this.recordSpend(task.creditsConsumed)
          return
        }

        if (isTerminal(task.state)) return

        await patch(generation.id, {
          state: task.state as GenerationState,
          pollAttempts: attempt,
        })

        const elapsed = Date.now() - startedAt
        if (elapsed >= budgetMs) {
          // Stalled, not failed: the task may well still be running upstream,
          // and `retry()` can pick it back up from its task id.
          await patch(generation.id, {
            state: 'stalled',
            failCode: LOCAL_FAIL.timeout,
            failMsg:
              `Still ${task.state} after ${Math.round(elapsed / 1000)}s. ` +
              'The task may still be running on Kie — check again to resume polling.',
            pollAttempts: attempt,
          })
          return
        }

        await this.wait(generation.id, Math.min(pollDelayMs(attempt - 1), budgetMs - elapsed))
      } catch (error) {
        if (isKieError(error) && error.kind === 'not_found') {
          await patch(generation.id, {
            state: 'orphaned',
            failCode: LOCAL_FAIL.notFound,
            failMsg: error.detail ?? error.message,
            completedAt: Date.now(),
          })
          return
        }

        const rateLimited = isKieError(error) && error.kind === 'rate_limited'
        // A 429 on a poll is noise the runner absorbs — it costs a delay, not
        // one of the job's three lives.
        if (!rateLimited) consecutiveErrors += 1

        if (consecutiveErrors > MAX_POLL_ERRORS || !isRetryableError(error)) {
          await patch(generation.id, {
            state: 'stalled',
            failCode: LOCAL_FAIL.poll,
            failMsg: describe(error),
          })
          return
        }

        await this.wait(generation.id, pollDelayMs(attempt + consecutiveErrors))
      }
    }
  }

  /**
   * Kie's `success` is permission to download, not completion. Only bytes on
   * disk make a generation `complete`.
   */
  private async download(
    generation: Generation,
    result: Task['result'],
    task: Task,
  ): Promise<void> {
    if (result.urls.length === 0) {
      // Terminal success with nothing to fetch is a Kie-side anomaly, not a
      // transient one — retrying would poll the same empty result forever.
      await this.fail(
        generation.id,
        LOCAL_FAIL.download,
        'Kie reported success but returned no result URLs. ' +
          `Raw resultJson kept for forensics: ${task.resultJson ?? 'null'}`,
      )
      return
    }

    try {
      await this.downloadAssets(generation, result)
      await patch(generation.id, {
        state: 'complete',
        failCode: null,
        failMsg: null,
        completedAt: Date.now(),
      })
    } catch (error) {
      // needs_retry, NOT failed: the generation succeeded and was paid for, and
      // the result URL stays valid for 14 days. This is recoverable.
      await patch(generation.id, {
        state: 'needs_retry',
        failCode: LOCAL_FAIL.download,
        failMsg: describe(error),
      })
    }
  }

  /**
   * Logs a balance reading, but only when Kie says credits actually moved.
   *
   * Fire-and-forget on purpose. Deliberately not awaited: the download is the
   * next thing to happen after a success, and it must not queue behind a
   * bookkeeping request. `sampleBalance` swallows its own failures, so the
   * `catch` here is for the impossible case rather than the expected one.
   */
  private recordSpend(creditsConsumed: number | null | undefined): void {
    if (!creditsConsumed) return
    void this.sampleBalance().catch(() => undefined)
  }

  private async fail(id: string, code: string, message: string): Promise<void> {
    await patch(id, {
      state: 'failed',
      failCode: code,
      failMsg: message,
      completedAt: Date.now(),
    })
  }
}

// -------------------------------------------------------------- helpers

async function load(id: string): Promise<Generation | undefined> {
  const rows = await getDb().select().from(generations).where(eq(generations.id, id)).limit(1)
  return rows[0]
}

function patch(id: string, values: Partial<Generation>) {
  return getDb().update(generations).set(values).where(eq(generations.id, id))
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
function timeoutFor(modelSlug: string): number {
  return getModel(modelSlug)?.outputKind === 'video'
    ? POLL_TIMEOUT_MS.video
    : POLL_TIMEOUT_MS.image
}

function isRetryableError(error: unknown): boolean {
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

/*
 * The singleton is pinned to globalThis rather than a module-level `let`:
 * Turbopack re-evaluates modules on hot reload in dev, which would otherwise
 * start a second runner alongside the first and double every poll.
 */
const RUNNER_KEY: unique symbol = Symbol.for('kie-studio.job-runner')
type RunnerGlobal = typeof globalThis & { [RUNNER_KEY]?: JobRunner }

export function getRunner(): JobRunner {
  const scope = globalThis as RunnerGlobal
  scope[RUNNER_KEY] ??= new JobRunner()
  return scope[RUNNER_KEY]
}
