import 'server-only'

import fs from 'node:fs'
import path from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { migrate } from 'drizzle-orm/libsql/migrator'

import { getEnv } from '../env.ts'
import * as schema from './schema.ts'

export * from './schema.ts'

/*
 * Driver note: this is plain local SQLite, reached through @libsql/client.
 *
 * better-sqlite3 (the original choice) requires node-gyp and a Visual Studio
 * C++ toolchain on Windows, which this machine does not have. libsql ships
 * prebuilt binaries, needs no compiler, and speaks the same SQLite — the
 * schema and migrations are unchanged. Its API is async, which is why every
 * caller below awaits.
 */

let client: Client | undefined
let instance: ReturnType<typeof drizzle<typeof schema>> | undefined

function connect() {
  if (client && instance) return instance

  const env = getEnv()
  // The DB location is env-configurable, so the bundler cannot statically scope
  // it and would otherwise trace the entire project into the server output.
  // This app is a local single-user server, never a serverless bundle.
  const file = path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.databaseFile)
  fs.mkdirSync(path.dirname(file), { recursive: true })

  client = createClient({ url: `file:${file}` })
  instance = drizzle(client, { schema })
  return instance
}

/** The Drizzle client. Lazily opens the database on first use. */
export function getDb() {
  return connect()
}

/**
 * Applies any unapplied migrations. Called once at server start from
 * instrumentation.ts so a fresh clone works with no manual step.
 */
export async function runMigrations() {
  await migrate(connect(), {
    migrationsFolder: path.join(process.cwd(), 'lib', 'db', 'migrations'),
  })
}
