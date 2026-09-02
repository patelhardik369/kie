import crypto from 'node:crypto'

/**
 * Webhook signature verification.
 *
 * Pure module — the HMAC key is passed in, so this is unit-testable and holds no
 * env. Only relevant when KIE_PUBLIC_URL is set; on localhost Kie cannot reach us
 * and the poller is the only completion path.
 *
 * Kie signs `taskId + "." + timestamp` with HMAC-SHA256, base64-encoded, where
 * taskId comes from the body's `data.task_id`.
 */

export const WEBHOOK_TIMESTAMP_HEADER = 'x-webhook-timestamp'
export const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature'

/** Reject callbacks older than this to blunt replay attempts. */
export const DEFAULT_TOLERANCE_SECONDS = 5 * 60

export interface WebhookPayload {
  taskId?: string
  code?: number
  msg?: string
  data?: {
    task_id?: string
    callbackType?: string
    [key: string]: unknown
  }
}

export function signPayload(
  taskId: string,
  timestamp: string | number,
  hmacKey: string,
): string {
  return crypto
    .createHmac('sha256', hmacKey)
    .update(`${taskId}.${timestamp}`)
    .digest('base64')
}

/**
 * Constant-time signature comparison.
 *
 * `crypto.timingSafeEqual` THROWS on a length mismatch, so lengths are compared
 * first — a naive call here turns a malformed signature into a 500.
 */
export function verifySignature(
  taskId: string,
  timestamp: string | number,
  received: string,
  hmacKey: string,
): boolean {
  const expected = Buffer.from(signPayload(taskId, timestamp, hmacKey))
  const actual = Buffer.from(received)
  if (expected.length !== actual.length) return false
  return crypto.timingSafeEqual(expected, actual)
}

export type WebhookVerification =
  | { ok: true; taskId: string; payload: WebhookPayload }
  | { ok: false; reason: string }

/**
 * Full verification of an incoming callback: headers present, timestamp fresh,
 * task id resolvable, signature valid.
 *
 * `taskId` is read from `data.task_id` per the docs, falling back to the
 * top-level `taskId` that the payload also carries.
 */
export function verifyWebhook(
  headers: Headers,
  payload: WebhookPayload,
  hmacKey: string,
  options: { toleranceSeconds?: number; now?: number } = {},
): WebhookVerification {
  const timestamp = headers.get(WEBHOOK_TIMESTAMP_HEADER)
  const signature = headers.get(WEBHOOK_SIGNATURE_HEADER)

  if (!timestamp) return { ok: false, reason: 'missing X-Webhook-Timestamp header' }
  if (!signature) return { ok: false, reason: 'missing X-Webhook-Signature header' }

  const sentAt = Number(timestamp)
  if (!Number.isFinite(sentAt)) {
    return { ok: false, reason: 'X-Webhook-Timestamp is not a number' }
  }

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000)
  if (Math.abs(nowSeconds - sentAt) > tolerance) {
    return { ok: false, reason: `timestamp outside ${tolerance}s tolerance` }
  }

  const taskId = payload.data?.task_id ?? payload.taskId
  if (!taskId) return { ok: false, reason: 'payload has no data.task_id' }

  // Signed with the header value verbatim, not the coerced number.
  if (!verifySignature(taskId, timestamp, signature, hmacKey)) {
    return { ok: false, reason: 'signature mismatch' }
  }

  return { ok: true, taskId, payload }
}

/**
 * What a verified callback should do about the generation it names.
 *
 * Split out of the route so the two invariants of docs/API-CONTRACT.md §7 are
 * testable without a request: idempotent on `kie_task_id`, and never
 * authoritative. `wake` is the only action that touches the runner, and all it
 * does is shorten a backoff — the state still comes from `recordInfo`.
 */
export type DeliveryAction = 'unknown' | 'ignore' | 'wake'

/** Terminal states: nothing a callback says can move them. */
export const SETTLED_STATES = ['complete', 'failed', 'orphaned'] as const

export function deliveryAction(state: string | undefined): DeliveryAction {
  // Signed correctly but unknown here — another install sharing the key, or a
  // row that has since been deleted.
  if (state === undefined) return 'unknown'
  // A duplicate delivery for something already on disk must be a no-op, not a
  // second download.
  if ((SETTLED_STATES as readonly string[]).includes(state)) return 'ignore'
  return 'wake'
}
