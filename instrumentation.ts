/**
 * Runs when the server starts.
 *
 * Its job shrank considerably when the studio moved off the local machine, and
 * what it no longer does matters as much as what it does.
 *
 * **It no longer runs migrations.** On a single local process that was the right
 * call — a fresh clone worked with no manual step. On a serverless host there is
 * no "the server starts": there are many cold starts, concurrently, each of
 * which would race the others to apply the same migration. Migrations now run
 * once at deploy time via `npm run db:migrate` (see docs/DEPLOYMENT.md).
 *
 * **It no longer resumes in-flight jobs.** There is no process to resume them
 * into. Recovery is continuous instead of a startup event: every generation
 * carries its own `next_poll_at`, and `/api/jobs/tick` picks up whatever is due
 * — including anything a crashed invocation abandoned, whose lease simply ages
 * out. That is strictly better than the old sweep, which only ran if somebody
 * restarted the process.
 *
 * What is left is a startup check of the environment, so a missing variable is a
 * loud, readable failure at boot rather than a 500 in the middle of somebody's
 * first generation.
 */

let registered = false

export async function register() {
  // Also invoked for the edge runtime, where node:crypto and postgres-js do not
  // exist in the forms this app needs.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (registered) return
  registered = true

  const { getEnv, EnvError } = await import('@/lib/env')

  try {
    const env = getEnv()

    console.log('[kie-studio] database:', hostOf(env.databaseUrl))
    console.log('[kie-studio] storage:', `${env.supabaseUrl}/${env.storageBucket}`)
    console.log(
      `[kie-studio] limits: ${mb(env.maxFileBytes)} MB per object, ` +
        `${mb(env.storageQuotaBytes)} MB total`,
    )
    console.log(
      env.kieApiKey
        ? '[kie-studio] a server-side KIE_API_KEY is set — it is the fallback when a request brings none'
        : '[kie-studio] no server-side KIE_API_KEY — every request must bring its own',
    )
    console.log(
      env.publicUrl
        ? `[kie-studio] webhooks enabled at ${env.publicUrl}/api/kie/webhook`
        : '[kie-studio] webhooks disabled (no KIE_PUBLIC_URL) — ticks are the only completion path',
    )
  } catch (error) {
    registered = false
    if (error instanceof EnvError) {
      console.error(
        `\n[kie-studio] Configuration error\n\n  ${error.message}\n\n` +
          '  The server will not start until this is fixed.\n',
      )
    }
    throw error
  }
}

/** The connection host alone. A connection string carries a password. */
function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return '(unparseable DATABASE_URL)'
  }
}

function mb(bytes: number): number {
  return Math.round(bytes / (1024 * 1024))
}
