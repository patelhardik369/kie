import type { GenerationState } from '../db/schema.ts'

/**
 * Presentation helpers shared by the queue panel, the gallery grid and the
 * detail view.
 *
 * Pure module, client-safe — the `GenerationState` import is type-only, so
 * nothing here drags drizzle into the browser bundle.
 *
 * It exists so a state means the same thing everywhere. A generation shown as
 * "Stalled" on its tile and "Timed out" on its detail page reads as two
 * different problems.
 */

export const STATE_LABEL: Record<GenerationState, string> = {
  draft: 'Draft',
  waiting: 'Queued at Kie',
  queuing: 'Queuing',
  generating: 'Generating',
  downloading: 'Downloading to disk',
  complete: 'Complete',
  failed: 'Failed',
  needs_retry: 'Download failed',
  stalled: 'Stalled',
  orphaned: 'Orphaned',
}

/**
 * Amber is deliberate for the recoverable states. `needs_retry` and `stalled`
 * are not failures — the generation was paid for and can still be finished —
 * and colouring them like `failed` would say otherwise.
 *
 * The value is a complete `.chip` recipe (see app/globals.css) rather than a
 * loose set of colour utilities, so every state pill in the app is the same
 * shape and picks up an accent change without being touched.
 */
export const STATE_TONE: Record<GenerationState, string> = {
  draft: 'chip',
  waiting: 'chip chip-accent',
  queuing: 'chip chip-accent',
  generating: 'chip chip-accent',
  downloading: 'chip chip-accent',
  complete: 'chip chip-ok',
  failed: 'chip chip-bad',
  needs_retry: 'chip chip-warn',
  stalled: 'chip chip-warn',
  orphaned: 'chip chip-bad',
}

/** States where something is still expected to happen without being asked. */
const IN_FLIGHT: ReadonlySet<GenerationState> = new Set<GenerationState>([
  'waiting',
  'queuing',
  'generating',
  'downloading',
])

export function isInFlight(state: string): boolean {
  return IN_FLIGHT.has(state as GenerationState)
}

/**
 * States that stopped short and will not move again on their own.
 *
 * Kept out of the runner's startup sweep on purpose: a generation that already
 * gave up should not be re-polled on every restart. These move only when someone
 * asks — "Check again" on one generation, or "Resume all" in Settings.
 */
export const RECOVERABLE_STATES = [
  'stalled',
  'needs_retry',
] as const satisfies readonly GenerationState[]

const RESUMABLE: ReadonlySet<GenerationState> = new Set<GenerationState>(
  RECOVERABLE_STATES,
)

export function isResumable(state: string): boolean {
  return RESUMABLE.has(state as GenerationState)
}

export function stateLabel(state: string): string {
  return STATE_LABEL[state as GenerationState] ?? state
}

export function stateTone(state: string): string {
  return STATE_TONE[state as GenerationState] ?? 'chip'
}

/**
 * The URL that serves a stored output.
 *
 * Each segment is encoded separately so the slashes survive as separators —
 * `encodeURIComponent` on the whole key would turn them into `%2F` and the
 * catch-all route would see one segment.
 *
 * `token` is now required for EVERY asset, not just a private one: the route it
 * points at has no other way to authorise a caller, because `<img>` and
 * `<video>` send no headers. It is minted server-side by
 * `lib/gallery/asset-token.ts` — this module stays pure and client-safe, so it
 * appends the value rather than computing it.
 */
export function assetHref(storagePath: string, token?: string): string {
  const path = storagePath.split('/').map(encodeURIComponent).join('/')
  return token ? `/api/assets/${path}?k=${encodeURIComponent(token)}` : `/api/assets/${path}`
}

/** The prompt-ish field of a stored input, for a tile caption. */
export function promptOf(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const record = input as Record<string, unknown>
  // `prompt` covers all 82 models in scope; the fallbacks are cheap insurance
  // against a future one that names it differently.
  for (const key of ['prompt', 'text', 'description']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) return '—'
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${Math.round(seconds % 60)}s`
}

/** Short, absolute, and unambiguous — never "3 days ago". */
export function formatTimestamp(at: number | null | undefined): string {
  if (!at) return '—'
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}
