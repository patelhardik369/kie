/**
 * An ordered, concurrency-limited queue for the gallery's media fetches.
 *
 * Pure module, browser-side, no React and no DOM — which is what makes it
 * testable under `node --test`. (The "nothing may outlive a request" rule in
 * .claude/CLAUDE.md is about serverless functions; this state lives in a tab.)
 *
 * ## The problem it solves
 *
 * A gallery page is up to 48 tiles, and every tile's `<img>` used to be handed
 * its `src` at parse time. The browser opens all of them at once — over HTTP/2
 * there is no six-connection limit to save you — and each one costs a Vercel
 * function invocation plus a Supabase signing round trip before a single byte of
 * image moves. Forty-eight requests sharing the same pipe all finish at roughly
 * the same late moment, so the grid stays grey and then fills in one go. Nothing
 * is technically slow; it just never looks like it is working.
 *
 * Letting a few through at a time changes only the ORDER, not the total work,
 * and order is the whole experience: the top of the grid resolves in the time
 * the first four used to take, and the rest arrive visibly, one after another.
 *
 * ## Why not just `loading="lazy"`
 *
 * It is still on, and it still helps — but it only defers what is off-screen.
 * Every tile above the fold is fetched immediately and simultaneously, and on a
 * 6-column layout that is most of the first two rows. `lazy` answers "how far
 * down", never "how many at once".
 */

/**
 * How many media fetches may be in flight at once.
 *
 * Four, not one. One is the most legible possible fill but leaves the connection
 * idle between round trips, and a 48-tile page would take most of a minute to
 * finish. Four keeps the pipe busy while still resolving the top of the grid
 * first, which is the part anyone is actually looking at.
 */
export const DEFAULT_CONCURRENCY = 4

/** What a phone on a bad connection gets instead. */
export const FRUGAL_CONCURRENCY = 2

interface Waiter {
  priority: number
  /** Insertion order, so equal priorities keep the order they arrived in. */
  seq: number
  grant: () => void
}

export interface LoadQueue {
  /**
   * Ask for a slot. `grant` is called when one frees up — possibly
   * synchronously, if the queue is idle.
   *
   * Returns the release function. It is idempotent and safe to call whether the
   * slot was ever granted: before the grant it cancels the request, after it
   * frees the slot. Call it on load, on error, and on unmount.
   */
  request(priority: number, grant: () => void): () => void
  /** For tests and diagnostics. */
  readonly active: number
  readonly pending: number
}

/**
 * @param limit a number, or a function so the ceiling can be read from the
 *   connection at the moment it is needed rather than at module load.
 */
export function createLoadQueue(limit: number | (() => number)): LoadQueue {
  const ceiling = typeof limit === 'function' ? limit : () => limit

  let active = 0
  let seq = 0
  let pumping = false
  const waiting: Waiter[] = []

  /**
   * Hands out every slot currently free, lowest priority number first.
   *
   * Re-entrant on purpose: an already-cached image calls `release` from inside
   * its own `grant`, and a nested `pump` would otherwise interleave with this
   * loop. The nested call returns immediately and the loop below re-reads
   * `active`, so the freed slot is still handed out — just by the outer pass.
   */
  function pump(): void {
    if (pumping) return
    pumping = true
    try {
      while (active < ceiling() && waiting.length > 0) {
        let best = 0
        for (let i = 1; i < waiting.length; i += 1) {
          const candidate = waiting[i]!
          const incumbent = waiting[best]!
          if (
            candidate.priority < incumbent.priority ||
            (candidate.priority === incumbent.priority && candidate.seq < incumbent.seq)
          ) {
            best = i
          }
        }
        const [waiter] = waiting.splice(best, 1)
        active += 1
        waiter!.grant()
      }
    } finally {
      pumping = false
    }
  }

  return {
    request(priority, grant) {
      const waiter: Waiter = { priority, seq: (seq += 1), grant }
      waiting.push(waiter)

      let released = false
      const release = () => {
        if (released) return
        released = true

        const index = waiting.indexOf(waiter)
        if (index >= 0) {
          // Never granted — this is a cancellation, not a completion.
          waiting.splice(index, 1)
          return
        }
        active = Math.max(0, active - 1)
        pump()
      }

      pump()
      return release
    },
    get active() {
      return active
    },
    get pending() {
      return waiting.length
    },
  }
}

interface NetworkInformation {
  saveData?: boolean
  effectiveType?: string
}

function networkInformation(): NetworkInformation | undefined {
  if (typeof navigator === 'undefined') return undefined
  return (navigator as Navigator & { connection?: NetworkInformation }).connection
}

/**
 * The ceiling for this device, re-read on every pump.
 *
 * Re-read rather than captured because `effectiveType` changes as a phone moves
 * between networks, and a tab left open through that should not stay pinned to
 * whatever it booted on. The API is Chromium-only; everywhere else the optional
 * chaining lands on the default, which is the right answer for a desktop
 * browser anyway.
 */
export function connectionConcurrency(): number {
  const connection = networkInformation()
  if (!connection) return DEFAULT_CONCURRENCY
  if (connection.saveData) return 1
  switch (connection.effectiveType) {
    case 'slow-2g':
    case '2g':
      return 1
    case '3g':
      return FRUGAL_CONCURRENCY
    default:
      return DEFAULT_CONCURRENCY
  }
}

/**
 * The one queue the gallery grid shares.
 *
 * Shared rather than per-page so a grid and the asset picker beside it cannot
 * each open their own four connections.
 */
export const mediaLoadQueue: LoadQueue = createLoadQueue(connectionConcurrency)
