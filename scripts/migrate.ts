/**
 * Applies pending migrations. Run once per deploy, before the new code serves.
 *
 *   npm run db:migrate
 *
 * Deliberately a script rather than something `instrumentation.ts` does at boot.
 * On a serverless host there is no single server start — there are many cold
 * starts, concurrently, and every one of them would race the others to apply the
 * same migration. Drizzle's migrator takes a lock, so the race is survivable
 * rather than corrupting, but it turns every cold start into a database round
 * trip and the first request of a deploy into a schema migration. Neither is
 * something a user should be waiting on.
 *
 * It reads DATABASE_URL from the environment. Locally that means:
 *
 *   node --env-file=.env --experimental-strip-types scripts/migrate.ts
 *
 * which is what `npm run db:migrate` does.
 */

import path from 'node:path'
import process from 'node:process'

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const url = process.env.DATABASE_URL?.trim()

if (!url) {
  console.error(
    '\n[kie-studio] DATABASE_URL is not set.\n\n' +
      '  Supabase → Project Settings → Database → Connection string.\n' +
      '  Locally, put it in .env; on Vercel, in the project environment.\n',
  )
  process.exit(1)
}

if (!/^postgres(ql)?:\/\//.test(url)) {
  console.error(`\n[kie-studio] DATABASE_URL must be a postgres:// URL, got "${url.slice(0, 20)}…"\n`)
  process.exit(1)
}

/*
 * `max: 1` and prepared statements off, for the same reasons the app's own pool
 * sets them — and one more that is specific to migrating: DDL through a
 * transaction pooler wants a single, predictable session, not a connection that
 * may change underneath a multi-statement migration.
 */
const client = postgres(url, { max: 1, prepare: false, ssl: 'require', onnotice: () => {} })

try {
  console.log(`[kie-studio] migrating ${new URL(url).host}…`)
  await migrate(drizzle(client), {
    migrationsFolder: path.join(process.cwd(), 'lib', 'db', 'migrations'),
  })
  console.log('[kie-studio] migrations applied.')
} catch (error) {
  console.error('\n[kie-studio] migration failed:\n', error)
  process.exitCode = 1
} finally {
  await client.end({ timeout: 5 })
}
