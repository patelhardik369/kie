import 'server-only'

import { getCredits } from '../kie/account.ts'
import { isKieError } from '../kie/errors.ts'
import { recordBalance } from './queries.ts'

/**
 * The credit balance for Settings.
 *
 * `creditLog` only ever holds what something bothered to write into it, so
 * reading it alone is why the card sat on "not fetched yet" — nothing in the app
 * called the credits route, and the table stayed empty forever. This asks Kie
 * directly, records the reading, and only falls back to the log when the call
 * fails.
 *
 * The fallback is the point: the balance is nice to know, and it must never be
 * the reason Settings will not render. A dead network shows the last reading and
 * says why it is stale.
 */

/**
 * Shorter than the client's 30s default. This runs during a page render, and
 * nobody should wait half a minute on a number this incidental.
 */
const BALANCE_TIMEOUT_MS = 8_000

export interface BalanceReading {
  balance: number | null
  /** When this number was read. Null only when there has never been a reading. */
  recordedAt: number | null
  /** True when it came from Kie just now rather than from the log. */
  live: boolean
  /** Why the live read failed, when it did. */
  error?: string
}

export async function readBalance(
  fallback: { balance: number | null; recordedAt: number | null },
): Promise<BalanceReading> {
  try {
    const balance = await getCredits(AbortSignal.timeout(BALANCE_TIMEOUT_MS))
    if (!Number.isFinite(balance)) throw new Error('Kie returned a non-numeric balance.')

    // Throttled inside recordBalance, and never allowed to fail the read: a
    // locked database should not turn a good number into an error.
    const recordedAt = Date.now()
    await recordBalance(balance).catch(() => undefined)

    return { balance, recordedAt, live: true }
  } catch (error) {
    return {
      ...fallback,
      live: false,
      error: describe(error),
    }
  }
}

function describe(error: unknown): string {
  if (isKieError(error)) {
    return error.detail ? `${error.message} (${error.detail})` : error.message
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * Takes a reading and logs it, for the trend rather than for display.
 *
 * Called by the job runner after a generation that consumed credits, which is
 * the only moment the balance is known to have moved. One reading per
 * generation is the point: `credit_log` is otherwise written only when someone
 * happens to open Settings, and a trend sampled at whim is not a trend.
 *
 * Never throws and is never awaited by the runner. A generation is complete
 * when its bytes are on disk; a bookkeeping number that could not be fetched
 * must not change that, or a Kie hiccup would turn finished work into a failure.
 */
export async function sampleBalance(): Promise<number | null> {
  try {
    const balance = await getCredits(AbortSignal.timeout(BALANCE_TIMEOUT_MS))
    if (!Number.isFinite(balance)) return null

    await recordBalance(balance)
    return balance
  } catch {
    return null
  }
}
