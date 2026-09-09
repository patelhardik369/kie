import 'server-only'

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { getEnv } from '../env.ts'
import * as schema from './schema.ts'

export * from './schema.ts'

/*
 * Postgres, on Supabase, through Supavisor.
 *
 * The settings below are not preferences — each one is a specific failure this
 * deployment shape would otherwise hit:
 *
 *   `prepare: false`  Supavisor's TRANSACTION pooler (port 6543) hands a
 *                     different backend connection to each transaction, so a
 *                     prepared statement named on one is missing on the next.
 *                     Left on, the first query of a request succeeds and the
 *                     second fails with "prepared statement s1 already exists".
 *                     Drizzle's own Supabase guide sets this.
 *
 *   `max`             **Depends on whether the process outlives the request.**
 *                     On a serverless host every invocation is its own process
 *                     with its own pool, so one connection each is right — a
 *                     pool of ten per invocation exhausts Supabase Free's
 *                     connection limit long before it exhausts the function's
 *                     concurrency.
 *
 *                     On a long-lived process — `next dev`, or `next start` on
 *                     a VPS — one connection is actively harmful. Every request
 *                     in the whole server queues behind it, so a single wedged
 *                     query stalls the entire app rather than one request. That
 *                     is not hypothetical: it is what a hung connection did to
 *                     the dev server during setup, with static pages still
 *                     serving fine while everything touching the database hung.
 *
 *   `idle_timeout`    A frozen serverless instance holds its socket open until
 *                     the server reaps it. Releasing after 20s of idle keeps the
 *                     connection count proportional to actual traffic.
 *
 *   `max_lifetime`    Recycles a connection every 30 minutes. Supavisor drops
 *                     long-lived sockets of its own accord, and a pool holding a
 *                     half-dead one hands it to the next caller.
 *
 *   `statement_timeout`
 *                     A bound on how long any single query may wedge a
 *                     connection. Without it a stuck query holds its slot
 *                     indefinitely; with it the query fails, the connection is
 *                     returned, and the app reports an error instead of hanging.
 *                     Generous — nothing here legitimately takes 30 seconds.
 */

/**
 * True on a host that tears the process down after each request.
 *
 * `VERCEL` is set on every Vercel deployment; the Lambda variable covers other
 * serverless runtimes. Everything else — `next dev`, `next start`, a container —
 * is treated as long-lived.
 */
const SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME)

type Database = ReturnType<typeof drizzle<typeof schema>>

/*
 * Pinned to globalThis rather than a module-level `let`.
 *
 * Two things re-evaluate modules underneath us: Turbopack on hot reload in dev,
 * and Next's route bundling in production, where the same module can be
 * instantiated more than once in a single lambda. Either one would open a second
 * pool against a database that is counting connections.
 */
const CLIENT_KEY: unique symbol = Symbol.for('kie-studio.pg-client') as never
const DB_KEY: unique symbol = Symbol.for('kie-studio.pg-db') as never

type PgGlobal = typeof globalThis & {
  [CLIENT_KEY]?: postgres.Sql
  [DB_KEY]?: Database
}

function connect(): Database {
  const scope = globalThis as PgGlobal
  if (scope[DB_KEY]) return scope[DB_KEY]

  const env = getEnv()

  const client = postgres(env.databaseUrl, {
    prepare: env.poolerTransactionMode ? false : undefined,
    max: SERVERLESS ? 1 : 8,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    // A hung connect must not hold a serverless invocation open to its ceiling.
    connect_timeout: 15,
    // Supabase terminates TLS at the pooler with its own CA; `require` gets the
    // encrypted channel without shipping the certificate chain in the bundle.
    ssl: 'require',
    connection: {
      // Applied by Postgres itself, so it bounds a query that has already left
      // for the server — which is exactly the case a client-side timer cannot
      // reach.
      statement_timeout: 30_000,
    },
    onnotice: () => {},
  })

  scope[CLIENT_KEY] = client
  scope[DB_KEY] = drizzle(client, { schema })
  return scope[DB_KEY]
}

/** The Drizzle client. Lazily opens the pool on first use. */
export function getDb(): Database {
  return connect()
}

/**
 * The raw postgres-js client, for the two things Drizzle cannot express:
 * the atomic lease claim in lib/jobs/lease.ts, and `db:migrate`.
 */
export function getSql(): postgres.Sql {
  connect()
  return (globalThis as PgGlobal)[CLIENT_KEY]!
}

/**
 * Closes the pool. Scripts only.
 *
 * Deliberately NOT called from a route or from `instrumentation.ts`: a
 * serverless invocation that closes its pool on the way out pays a fresh TLS
 * handshake on the next request, and one that closes it while another request is
 * still in flight breaks that request.
 */
export async function closeDb(): Promise<void> {
  const scope = globalThis as PgGlobal
  const client = scope[CLIENT_KEY]
  if (!client) return
  await client.end({ timeout: 5 })
  delete scope[CLIENT_KEY]
  delete scope[DB_KEY]
}
