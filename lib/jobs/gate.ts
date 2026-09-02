/**
 * The submission gate.
 *
 * Pure module — an injectable clock and sleep, no env, no network — so the
 * window logic is unit-testable without waiting in real time.
 *
 * Kie allows 20 new task submissions per 10 seconds and rejects the excess with
 * a `429` **without queueing it** (docs/API-CONTRACT.md §4). So the queue lives
 * here: jobs wait locally for a slot rather than bouncing off the API and
 * needing to be retried. Concurrency is not the binding constraint — 100+ tasks
 * can be running at once — submission *rate* is.
 */

import { SUBMIT_RATE_LIMIT } from '../kie/polling.ts'

export interface GateOptions {
  maxRequests?: number
  windowMs?: number
  now?: () => number
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}

export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal!.reason)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export class SubmissionGate {
  readonly maxRequests: number
  readonly windowMs: number

  private readonly now: () => number
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  /** Timestamps of submissions still inside the window, oldest first. */
  private stamps: number[] = []
  /**
   * Acquires are chained rather than run concurrently. Two callers that both
   * saw the last free slot would both take it — the chain makes the check and
   * the record one indivisible step.
   */
  private tail: Promise<unknown> = Promise.resolve()

  constructor(options: GateOptions = {}) {
    this.maxRequests = options.maxRequests ?? SUBMIT_RATE_LIMIT.maxRequests
    this.windowMs = options.windowMs ?? SUBMIT_RATE_LIMIT.windowMs
    this.now = options.now ?? (() => Date.now())
    this.sleep = options.sleep ?? defaultSleep
  }

  private prune(at: number) {
    const cutoff = at - this.windowMs
    while (this.stamps.length > 0 && this.stamps[0]! <= cutoff) this.stamps.shift()
  }

  /** How long until a slot frees. 0 when one is available now. */
  delayMs(at = this.now()): number {
    this.prune(at)
    if (this.stamps.length < this.maxRequests) return 0
    // The window frees one slot as its oldest entry ages out.
    return Math.max(0, this.stamps[0]! + this.windowMs - at)
  }

  /** Submissions currently counted against the window. */
  get pending(): number {
    this.prune(this.now())
    return this.stamps.length
  }

  /** Records a submission without waiting. Exposed for tests and recovery. */
  record(at = this.now()): void {
    this.prune(at)
    this.stamps.push(at)
  }

  /**
   * Resolves once a slot is available, having claimed it.
   *
   * Loops rather than sleeping once: a concurrent acquire may take the slot
   * this one was waiting for, and re-checking is cheaper than reasoning about
   * who gets to go first.
   */
  async acquire(signal?: AbortSignal): Promise<void> {
    const run = async () => {
      for (;;) {
        signal?.throwIfAborted()
        const wait = this.delayMs()
        if (wait === 0) {
          this.record()
          return
        }
        await this.sleep(wait, signal)
      }
    }

    // Serialize against other acquires, but never let one caller's rejection
    // poison the chain for the next.
    const next = this.tail.then(run, run)
    this.tail = next.catch(() => undefined)
    return next
  }
}
