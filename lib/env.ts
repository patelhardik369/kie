import 'server-only'

/**
 * Server-side environment.
 *
 * This module is `server-only`, so importing it from a client component is a
 * build error rather than a silent leak. Nothing here is ever echoed to a
 * response body.
 *
 * The shape changed when the studio moved off the local machine. Two things in
 * particular are no longer what they were:
 *
 *   - **`KIE_API_KEY` is optional.** Each browser supplies its own key, and the
 *     server holds it only for as long as a job needs it (see lib/auth/kie-key.ts).
 *     A server-side key is now a *fallback* for a single-tenant deployment, not
 *     the way the app works.
 *   - **`APP_ENCRYPTION_KEY` is required.** It is what makes a browser-supplied
 *     key survivable across the serverless invocations that poll and download a
 *     generation, and it is what signs private-asset capability tokens. The
 *     asset token used to be derived from `KIE_API_KEY`; with per-browser keys
 *     that would have minted a different token per visitor for the same file.
 */

export class EnvError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnvError'
  }
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim()
  return value ? value : undefined
}

function required(name: string, hint: string): string {
  const value = optional(name)
  if (!value) throw new EnvError(`${name} is not set.\n  ${hint}`)
  return value
}

function bytes(name: string, fallback: number): number {
  const raw = optional(name)
  if (!raw) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new EnvError(`${name} must be a positive number of bytes, got "${raw}".`)
  }
  return Math.floor(parsed)
}

/**
 * Supabase Free caps ANY single object at 50 MB, globally, and the limit is not
 * raisable on that plan. It is a documented plan limit rather than a setting, so
 * it is the default here and an output larger than it is reported honestly
 * rather than silently truncated.
 * https://supabase.com/docs/guides/storage/uploads/file-limits
 */
export const FREE_TIER_MAX_FILE_BYTES = 50 * 1024 * 1024

/** Supabase Free gives 1 GB of Storage across all buckets. */
export const FREE_TIER_STORAGE_BYTES = 1024 * 1024 * 1024

export interface Env {
  /**
   * A server-wide Kie key, or undefined.
   *
   * Only a fallback: when a request carries no `X-Kie-Key` and the generation
   * has no stored key, this is used. Leave it unset for a multi-browser
   * deployment where everyone brings their own.
   */
  kieApiKey?: string
  /** Postgres connection string — the Supabase pooler. */
  databaseUrl: string
  /** True when the connection string points at Supabase's transaction pooler. */
  poolerTransactionMode: boolean
  supabaseUrl: string
  supabaseServiceRoleKey: string
  storageBucket: string
  /** 32 raw bytes, decoded from base64. Secrets at rest are sealed with this. */
  encryptionKey: Buffer
  /** Bearer token `/api/jobs/tick` demands. */
  cronSecret: string
  /** Refuse to store an object larger than this. */
  maxFileBytes: number
  /** Soft ceiling on total stored bytes, per deployment. */
  storageQuotaBytes: number
  /** Public origin. When unset, webhooks are disabled and ticks are the only completion path. */
  publicUrl?: string
  /** Required only when publicUrl is set. */
  webhookHmacKey?: string
}

let cached: Env | undefined

export function getEnv(): Env {
  if (cached) return cached

  const databaseUrl = required(
    'DATABASE_URL',
    'Supabase → Project Settings → Database → Connection string → Transaction pooler (port 6543).',
  )
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    throw new EnvError(
      'DATABASE_URL must be a postgres:// connection string.\n' +
        `  Got "${databaseUrl.slice(0, 24)}…". The SQLite file: URL is no longer used —\n` +
        '  run `npm run db:import` to move a local data/kie.db into Supabase.',
    )
  }

  const supabaseUrl = required(
    'SUPABASE_URL',
    'Supabase → Project Settings → Data API → Project URL, e.g. https://abcd.supabase.co',
  )
  const supabaseServiceRoleKey = required(
    'SUPABASE_SERVICE_ROLE_KEY',
    'Supabase → Project Settings → API keys → service_role. SERVER-SIDE ONLY — never NEXT_PUBLIC_.',
  )

  const encryptionKey = readEncryptionKey()

  const cronSecret = required(
    'CRON_SECRET',
    'Any long random string. It is the bearer token /api/jobs/tick requires.\n' +
      '  Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64url\'))"',
  )

  const publicUrl = optional('KIE_PUBLIC_URL')?.replace(/\/+$/, '')
  const webhookHmacKey = optional('KIE_WEBHOOK_HMAC_KEY')

  if (publicUrl && !webhookHmacKey) {
    throw new EnvError(
      'KIE_PUBLIC_URL is set but KIE_WEBHOOK_HMAC_KEY is not.\n' +
        '  Webhook callbacks cannot be verified without it. Either set the HMAC key\n' +
        '  or clear KIE_PUBLIC_URL to run tick-only.',
    )
  }

  cached = {
    kieApiKey: optional('KIE_API_KEY'),
    databaseUrl,
    // Supavisor's transaction pooler runs on 6543 and cannot hold prepared
    // statements across checkouts. postgres-js must be told, or every query
    // after the first fails with "prepared statement already exists".
    poolerTransactionMode: /:6543\//.test(databaseUrl) || /pgbouncer=true/.test(databaseUrl),
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    supabaseServiceRoleKey,
    storageBucket: optional('SUPABASE_STORAGE_BUCKET') ?? 'kie-outputs',
    encryptionKey,
    cronSecret,
    maxFileBytes: bytes('MAX_STORAGE_FILE_BYTES', FREE_TIER_MAX_FILE_BYTES),
    storageQuotaBytes: bytes('STORAGE_QUOTA_BYTES', FREE_TIER_STORAGE_BYTES),
    publicUrl,
    webhookHmacKey,
  }
  return cached
}

/**
 * The at-rest key, decoded and length-checked at startup.
 *
 * Checked here rather than at first use because the failure it prevents is
 * silent: a short key still "works" for AES-GCM in the sense that it throws
 * only on the first seal, which would be in the middle of a generation.
 */
function readEncryptionKey(): Buffer {
  const raw = required(
    'APP_ENCRYPTION_KEY',
    'A base64 32-byte key. Generate one with:\n' +
      '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
  )

  let decoded: Buffer
  try {
    decoded = Buffer.from(raw, 'base64')
  } catch {
    throw new EnvError('APP_ENCRYPTION_KEY is not valid base64.')
  }

  if (decoded.length !== 32) {
    throw new EnvError(
      `APP_ENCRYPTION_KEY must decode to exactly 32 bytes, got ${decoded.length}.\n` +
        '  Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
    )
  }
  return decoded
}

/** True when Kie can reach us and callbacks are worth requesting. */
export function webhooksEnabled(): boolean {
  const env = getEnv()
  return Boolean(env.publicUrl && env.webhookHmacKey)
}
