import 'server-only'

import { getEnv } from '../env.ts'
import { kieErrorFromCode, networkError, timeoutError } from './errors.ts'
import { joinUrl } from './url.ts'

/**
 * The single HTTP path to Kie. Everything else in lib/kie/ goes through here.
 *
 * Responsibilities: auth, timeouts, envelope unwrapping, typed errors.
 * NOT responsibilities: retry and rate limiting — those are policy and belong to
 * the job runner, the only place that can see the whole queue. Errors carry a
 * `retryable` flag for it to act on.
 */

/** Generation, task query, credits, download-url. */
export const KIE_API_BASE = 'https://api.kie.ai/api/v1'

/** File uploads live on a DIFFERENT host. This is not a typo. */
export const KIE_UPLOAD_BASE = 'https://kieai.redpandaai.co'

export const DEFAULT_TIMEOUT_MS = 30_000
/** Uploads move real bytes; give them room. */
export const UPLOAD_TIMEOUT_MS = 120_000

/**
 * Kie wraps every response. `code` is the real status — an HTTP 200 can carry
 * `{ "code": 402 }`, so the envelope is always checked.
 */
interface Envelope<T> {
  code?: number
  msg?: string
  message?: string
  data?: T
  success?: boolean
}

export interface RequestOptions {
  method?: 'GET' | 'POST'
  /** Defaults to KIE_API_BASE. Pass KIE_UPLOAD_BASE for file endpoints. */
  base?: string
  /** JSON request body. Mutually exclusive with `formData`. */
  body?: unknown
  /** Multipart body, for stream upload. Mutually exclusive with `body`. */
  formData?: FormData
  query?: Record<string, string | number | undefined>
  timeoutMs?: number
  /** Caller-supplied cancellation, combined with the timeout. */
  signal?: AbortSignal
}

/**
 * Performs one request and returns the unwrapped `data`.
 *
 * Throws a KieError for every failure mode: network, timeout, non-JSON body,
 * bad HTTP status, or a non-200 envelope code.
 */
export async function kieRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    method = 'GET',
    base = KIE_API_BASE,
    body,
    formData,
    query,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
  } = options

  const url = joinUrl(base, path, query)

  const headers: Record<string, string> = {
    Authorization: `Bearer ${getEnv().kieApiKey}`,
    Accept: 'application/json',
  }
  // fetch sets the multipart boundary itself; setting Content-Type breaks it.
  if (!formData) headers['Content-Type'] = 'application/json'

  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const combined = signal
    ? AbortSignal.any([timeoutSignal, signal])
    : timeoutSignal

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers,
      body: formData ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal: combined,
      cache: 'no-store',
    })
  } catch (error) {
    if (timeoutSignal.aborted) throw timeoutError(timeoutMs)
    // A caller-initiated abort is not a Kie failure — let it propagate.
    if (signal?.aborted) throw error
    throw networkError(error)
  }

  const text = await response.text()

  let envelope: Envelope<T> | undefined
  if (text) {
    try {
      envelope = JSON.parse(text) as Envelope<T>
    } catch {
      // Non-JSON body: an HTML error page or a proxy interstitial.
      throw kieErrorFromCode(
        response.status,
        `Non-JSON response from Kie: ${text.slice(0, 200)}`,
      )
    }
  }

  const detail = envelope?.msg ?? envelope?.message
  const code = envelope?.code ?? response.status

  if (!response.ok || code !== 200) {
    throw kieErrorFromCode(code, detail)
  }

  // `data` is a bare value on some endpoints — a number for credits, a string
  // for download-url — so it is returned as-is rather than object-checked.
  return envelope?.data as T
}
