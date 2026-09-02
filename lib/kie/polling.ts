/**
 * Poll policy — the state machine and backoff schedule from docs/API-CONTRACT.md.
 *
 * Pure module, deliberately separate from tasks.ts: the job runner needs
 * this policy without pulling in the HTTP client, and it is the part worth
 * unit-testing.
 */

/** The five states Kie reports. */
export const TASK_STATES = [
  'waiting',
  'queuing',
  'generating',
  'success',
  'fail',
] as const

export type TaskState = (typeof TASK_STATES)[number]

/** Only these two end a poll. */
export const TERMINAL_STATES = ['success', 'fail'] as const

const TERMINAL: ReadonlySet<string> = new Set(TERMINAL_STATES)

export function isTerminal(state: string): boolean {
  return TERMINAL.has(state)
}

/**
 * Delays in ms between polls. The final value repeats for every later attempt.
 * Video models routinely take minutes; a tight loop only burns rate limit.
 */
export const POLL_SCHEDULE_MS = [3_000, 5_000, 8_000, 12_000, 15_000] as const

/** Delay to wait after `attempt` (0-based) has just been made. */
export function pollDelayMs(attempt: number): number {
  const index = Math.min(Math.max(attempt, 0), POLL_SCHEDULE_MS.length - 1)
  return POLL_SCHEDULE_MS[index]!
}

/** Poll ceilings by output kind. */
export const POLL_TIMEOUT_MS = {
  image: 5 * 60_000,
  video: 20 * 60_000,
} as const

/**
 * Kie allows 20 new task submissions per 10 seconds, and rejects excess with 429
 * WITHOUT queueing it. The runner keeps its own window rather than letting jobs
 * bounce off the API.
 */
export const SUBMIT_RATE_LIMIT = { maxRequests: 20, windowMs: 10_000 } as const
