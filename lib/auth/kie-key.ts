import 'server-only'

import { AsyncLocalStorage } from 'node:async_hooks'

import { getEnv } from '../env.ts'
import { seal, unseal } from '../crypto/seal.ts'

/**
 * Which Kie key the current unit of work is spending.
 *
 * `lib/kie/client.ts` is the single HTTP path to Kie, and it used to read one
 * process-wide key straight out of the environment. With every browser bringing
 * its own, the key became a property of the *request*, not of the process — and
 * threading it as an argument would have meant a new parameter on `createTask`,
 * `getTask`, `getCredits`, `uploadFile`, the Veo adapter and everything that
 * calls them, for a value none of them have any business inspecting.
 *
 * An AsyncLocalStorage store keeps it out of those signatures. A route or a job
 * opens a scope, everything awaited inside it sees the key, and nothing outside
 * a scope can see anything. Concurrency is safe by construction: two requests
 * running at once are two separate stores, never one variable being overwritten.
 *
 * The precedence, highest first:
 *
 *   1. `X-Kie-Key` on the request — the browser's own key.
 *   2. The sealed key stored on the generation row — how a job that started
 *      hours ago still knows what to spend when no browser is present.
 *   3. `KIE_API_KEY` from the environment — the single-tenant fallback, absent
 *      on a shared deployment.
 */

export const KIE_KEY_HEADER = 'x-kie-key'

interface KeyScope {
  apiKey: string
  /** Where it came from, for error messages that can tell the user what to fix. */
  source: 'request' | 'generation' | 'environment'
}

const storage = new AsyncLocalStorage<KeyScope>()

export class MissingKieKeyError extends Error {
  readonly status = 401
  constructor(message?: string) {
    super(
      message ??
        'No Kie API key. Add one in Settings — it is stored in this browser and ' +
          'sent with each request; this server keeps no key of its own.',
    )
    this.name = 'MissingKieKeyError'
  }
}

/**
 * Kie keys are opaque, so this checks only what can be checked: that the value
 * is a plausible credential rather than a stray header, a JSON fragment, or a
 * pasted URL. Rejecting early turns "the generation failed with 401 twenty
 * seconds in" into "that does not look like a key".
 */
export function looksLikeKieKey(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    value.length <= 512 &&
    // Printable ASCII with no whitespace. A pasted key that dragged a newline or
    // a "Bearer " prefix along with it fails here, where the message is useful.
    /^[\x21-\x7e]+$/.test(value)
  )
}

/** The key from an inbound request, if it carried a usable one. */
export function keyFromRequest(request: Request): string | undefined {
  const raw = request.headers.get(KIE_KEY_HEADER)?.trim()
  if (!raw) return undefined
  // Tolerated because it is the single most common way a pasted key arrives.
  const bare = raw.replace(/^Bearer\s+/i, '').trim()
  return looksLikeKieKey(bare) ? bare : undefined
}

/** Runs `fn` with `apiKey` as the key every Kie call inside it will spend. */
export function withKieKey<T>(
  apiKey: string,
  source: KeyScope['source'],
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run({ apiKey, source }, fn)
}

/**
 * Resolves the key for a request and runs `fn` in its scope.
 *
 * Falls back to the environment key so a single-tenant deployment that sets
 * `KIE_API_KEY` keeps working with no browser configuration at all.
 */
export function withRequestKey<T>(request: Request, fn: () => Promise<T>): Promise<T> {
  const fromRequest = keyFromRequest(request)
  if (fromRequest) return withKieKey(fromRequest, 'request', fn)

  const fromEnv = getEnv().kieApiKey
  if (fromEnv) return withKieKey(fromEnv, 'environment', fn)

  return Promise.reject(new MissingKieKeyError())
}

/**
 * Resolves the key for a job that no browser is watching.
 *
 * `sealedKey` is the generation's own stored key. It is preferred over the
 * environment fallback: a job must always be billed to whoever started it, even
 * on a deployment that happens to have a server key configured.
 */
export function withStoredKey<T>(
  sealedKey: string | null | undefined,
  generationId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const stored = unseal(sealedKey, generationId)
  if (stored) return withKieKey(stored, 'generation', fn)

  const fromEnv = getEnv().kieApiKey
  if (fromEnv) return withKieKey(fromEnv, 'environment', fn)

  return Promise.reject(
    new MissingKieKeyError(
      'This generation has no usable API key. Its stored key could not be ' +
        'unsealed — APP_ENCRYPTION_KEY may have been rotated since it was ' +
        'submitted. Open the generation and use "Check again" to re-arm it ' +
        'with the key in this browser.',
    ),
  )
}

/**
 * The key in scope. Throws when there is none.
 *
 * Called by `kieRequest` and nowhere else — the key must not spread beyond the
 * single module that puts it on the wire.
 */
export function currentKieKey(): string {
  const scope = storage.getStore()
  if (!scope) throw new MissingKieKeyError()
  return scope.apiKey
}

/** Where the in-scope key came from, or undefined outside a scope. */
export function currentKeySource(): KeyScope['source'] | undefined {
  return storage.getStore()?.source
}

/** Whether a key is available at all, without unwrapping it. */
export function hasKieKey(): boolean {
  return storage.getStore() !== undefined
}

/**
 * Seals a key for storage against one generation.
 *
 * Bound to the generation id, so a ciphertext copied between rows will not
 * unseal. Environment-sourced keys are deliberately NOT stored: they are already
 * available to the job at poll time, and writing a copy into the database would
 * put a long-lived secret at rest for no benefit at all.
 */
export function sealCurrentKeyFor(generationId: string): string | null {
  const scope = storage.getStore()
  if (!scope || scope.source === 'environment') return null
  return seal(scope.apiKey, generationId)
}
