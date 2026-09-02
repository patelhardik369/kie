/**
 * Runs when the server starts.
 *
 * Validates the environment loudly, brings the database up to date, and puts
 * every non-terminal generation back on the poll loop. That last step is what
 * makes an in-flight generation survive a restart: the database is
 * authoritative, so a job interrupted mid-poll resumes rather than stranding.
 *
 * Two failure rules, and the difference between them matters:
 *
 *   - **Fatal**: a bad environment or a failed migration. Nothing works without
 *     these, and failing here gives a readable message instead of a 401 or a
 *     "no such table" in the middle of a generation.
 *   - **Not fatal**: resuming in-flight jobs. A generation that fails to resume
 *     is still on disk, still in the database, and still recoverable from the
 *     UI. Taking the whole server down over it would turn a recoverable job
 *     into an app that will not boot.
 */

/**
 * Turbopack re-evaluates modules on hot reload, and Next may call `register`
 * more than once per process. Migrations and recovery are both idempotent, but
 * repeating them on every reload is wasted work and noisy logging.
 */
let registered = false

export async function register() {
  // Also invoked for the edge runtime, where node:fs and libsql do not exist.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (registered) return
  registered = true

  const { getEnv, EnvError } = await import('@/lib/env')
  const { runMigrations } = await import('@/lib/db')

  try {
    const env = getEnv()

    await runMigrations()

    console.log('[kie-studio] database ready at', env.databaseFile)
    console.log('[kie-studio] outputs ->', env.outputDir)
    console.log(
      env.publicUrl
        ? `[kie-studio] webhooks enabled at ${env.publicUrl}/api/kie/webhook`
        : '[kie-studio] webhooks disabled (no KIE_PUBLIC_URL) — polling only',
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

  // After migrations, so the runner never queries a table a version behind —
  // and outside the try above, because this must not be able to stop the boot.
  try {
    const { getRunner } = await import('@/lib/jobs/runner')
    const resumed = await getRunner().recover()
    if (resumed.length > 0) {
      console.log(`[kie-studio] resumed ${resumed.length} in-flight generation(s)`)
    }
  } catch (error) {
    console.error(
      '[kie-studio] could not resume in-flight generations:',
      error instanceof Error ? error.message : error,
    )
    console.error(
      '  They are still in the database. Open one and use "Check again" to resume it.',
    )
  }
}
