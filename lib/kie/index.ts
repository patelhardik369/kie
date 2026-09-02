/**
 * The Kie client.
 *
 * Server-side only — importing this from a client component is a build error,
 * which is how KIE_API_KEY is kept out of the browser.
 *
 * Contract reference: .claude/skills/kie-api/SKILL.md
 * Policy reference:   docs/API-CONTRACT.md
 */

export {
  KIE_API_BASE,
  KIE_UPLOAD_BASE,
  DEFAULT_TIMEOUT_MS,
  UPLOAD_TIMEOUT_MS,
  kieRequest,
  type RequestOptions,
} from './client.ts'

export {
  KieError,
  isKieError,
  isRetryable,
  kieErrorFromCode,
  networkError,
  timeoutError,
  type KieErrorKind,
} from './errors.ts'

export {
  parseResultJson,
  inferAssetKind,
  type ParsedResult,
  type LayerData,
} from './result.ts'

export {
  TASK_STATES,
  TERMINAL_STATES,
  POLL_SCHEDULE_MS,
  POLL_TIMEOUT_MS,
  SUBMIT_RATE_LIMIT,
  TaskTimeoutError,
  createTask,
  getTask,
  isTerminal,
  pollDelayMs,
  waitForTask,
  type CreateTaskParams,
  type Task,
  type TaskRecord,
  type TaskState,
  type WaitOptions,
} from './tasks.ts'

export {
  BASE64_MAX_BYTES,
  URL_UPLOAD_MAX_BYTES,
  UPLOAD_TTL_MS,
  uploadBase64,
  uploadExpiryMs,
  uploadFile,
  uploadFromUrl,
  type UploadedFile,
} from './upload.ts'

export { DOWNLOAD_URL_TTL_MS, getCredits, getDownloadUrl } from './account.ts'

export {
  DEFAULT_TOLERANCE_SECONDS,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  signPayload,
  verifySignature,
  verifyWebhook,
  type WebhookPayload,
  type WebhookVerification,
} from './webhook.ts'
