/**
 * Typed errors for every documented Kie failure.
 *
 * Pure module — no env, no `server-only` — so it is unit-testable and safe to
 * import from anywhere.
 *
 * Two things to know about Kie's error surface:
 *
 * 1. The envelope carries its own `code`. A `200 OK` can still wrap
 *    `{ "code": 402 }`. Always check the envelope, never the HTTP status alone.
 * 2. A generation that fails moderation is NOT an error here — it arrives as a
 *    terminal task with `state: "fail"` and a `failCode`/`failMsg`. See tasks.ts.
 */

export type KieErrorKind =
  | 'bad_request'
  | 'unauthorized'
  | 'insufficient_credits'
  | 'not_found'
  | 'validation'
  | 'rate_limited'
  | 'server'
  | 'network'
  | 'timeout'
  | 'unknown'

interface KieErrorInit {
  code: number
  kind: KieErrorKind
  message: string
  retryable: boolean
  /** Verbatim `msg` from the envelope, when there was one. */
  detail?: string
  cause?: unknown
}

export class KieError extends Error {
  readonly code: number
  readonly kind: KieErrorKind
  /** True only for failures where retrying the identical request can succeed. */
  readonly retryable: boolean
  readonly detail?: string

  constructor(init: KieErrorInit) {
    super(init.message, { cause: init.cause })
    this.name = 'KieError'
    this.code = init.code
    this.kind = init.kind
    this.retryable = init.retryable
    this.detail = init.detail
  }
}

interface Mapping {
  kind: KieErrorKind
  retryable: boolean
  message: string
}

/**
 * Codes documented across docs.kie.ai. 455 and 505 appear in the download-url
 * endpoint's list of possible codes but their meanings are not published, so
 * they are passed through rather than given an invented explanation.
 */
const MAPPINGS: Record<number, Mapping> = {
  400: {
    kind: 'bad_request',
    retryable: false,
    message: 'Kie rejected the request as malformed.',
  },
  401: {
    kind: 'unauthorized',
    retryable: false,
    message: 'KIE_API_KEY is missing or invalid.',
  },
  402: {
    kind: 'insufficient_credits',
    retryable: false,
    message: 'Not enough Kie credits to perform this operation.',
  },
  404: {
    kind: 'not_found',
    retryable: false,
    message: 'Kie has no record of that resource.',
  },
  422: {
    kind: 'validation',
    retryable: false,
    message:
      'The model rejected one of the input parameters. Check enum values and ' +
      'JSON types first — duration is a string on some models and an integer on others.',
  },
  429: {
    kind: 'rate_limited',
    retryable: true,
    message:
      'Rate limited (20 new tasks per 10 seconds). The request was rejected, not queued.',
  },
  500: { kind: 'server', retryable: true, message: 'Kie server error.' },
}

/** Builds a KieError from an envelope `code` (or an HTTP status). */
export function kieErrorFromCode(
  code: number,
  detail?: string,
  cause?: unknown,
): KieError {
  const mapped = MAPPINGS[code]
  if (mapped) {
    return new KieError({ code, ...mapped, detail, cause })
  }
  return new KieError({
    code,
    kind: code >= 500 ? 'server' : 'unknown',
    // Nothing above 500 is documented beyond 500 itself; treat as transient.
    retryable: code >= 500,
    message: `Kie returned an unrecognized code ${code}.`,
    detail,
    cause,
  })
}

export function networkError(cause: unknown): KieError {
  return new KieError({
    code: 0,
    kind: 'network',
    retryable: true,
    message: 'Could not reach Kie.',
    cause,
  })
}

export function timeoutError(ms: number): KieError {
  return new KieError({
    code: 0,
    kind: 'timeout',
    retryable: true,
    message: `Kie did not respond within ${ms}ms.`,
  })
}

export function isKieError(error: unknown): error is KieError {
  return error instanceof KieError
}

/** True when backing off and retrying the same request is worth attempting. */
export function isRetryable(error: unknown): boolean {
  return isKieError(error) && error.retryable
}
