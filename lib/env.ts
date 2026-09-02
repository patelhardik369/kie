import 'server-only'

/**
 * Server-side environment. KIE_API_KEY must never reach the browser, so this
 * module is marked `server-only` — importing it from a client component is a
 * build error rather than a silent leak.
 *
 * Validation runs at server start via instrumentation.ts, so a missing key is
 * a clear startup failure instead of a 401 in the middle of a generation.
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
  if (!value) {
    throw new EnvError(`${name} is not set.\n  ${hint}`)
  }
  return value
}

export interface Env {
  kieApiKey: string
  /** Absolute or relative directory where generated outputs are written. */
  outputDir: string
  /** `file:`-prefixed URL, the form libsql expects. */
  databaseUrl: string
  /** The same location as a bare filesystem path, for mkdir. */
  databaseFile: string
  /** Public origin. When unset, webhooks are disabled and polling is the only completion path. */
  publicUrl?: string
  /** Required only when publicUrl is set. */
  webhookHmacKey?: string
}

let cached: Env | undefined

export function getEnv(): Env {
  if (cached) return cached

  const kieApiKey = required(
    'KIE_API_KEY',
    'Copy .env.example to .env and add your key from https://kie.ai/api-key',
  )

  const outputDir =
    optional('KIE_OUTPUT_DIR') ?? 'C:/Users/Hardik/generations/kie-studio'

  const rawDbUrl = optional('DATABASE_URL') ?? 'file:./data/kie.db'
  const databaseUrl = rawDbUrl.startsWith('file:') ? rawDbUrl : `file:${rawDbUrl}`
  const databaseFile = databaseUrl.slice('file:'.length)

  const publicUrl = optional('KIE_PUBLIC_URL')
  const webhookHmacKey = optional('KIE_WEBHOOK_HMAC_KEY')

  if (publicUrl && !webhookHmacKey) {
    throw new EnvError(
      'KIE_PUBLIC_URL is set but KIE_WEBHOOK_HMAC_KEY is not.\n' +
        '  Webhook callbacks cannot be verified without it. Either set the HMAC key\n' +
        '  or clear KIE_PUBLIC_URL to run poll-only (the correct choice on localhost).',
    )
  }

  cached = {
    kieApiKey,
    outputDir,
    databaseUrl,
    databaseFile,
    publicUrl,
    webhookHmacKey,
  }
  return cached
}

/** True when Kie can reach us and callbacks are worth requesting. */
export function webhooksEnabled(): boolean {
  return Boolean(getEnv().publicUrl)
}
