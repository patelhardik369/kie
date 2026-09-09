import 'server-only'

import crypto from 'node:crypto'

import { eq, inArray, and, sql } from 'drizzle-orm'

import { generations, getDb, getSql, type Generation, type GenerationState } from '../db/index.ts'

/**
 * Leases: exactly one worker advances a generation at a time.
 *
 * On the local build the job runner was a process singleton, and "one poll per
 * task" was true because there was only ever one runner. That guarantee is gone.
 * A generation can now be reached by three things at once:
 *
 *   - the inline burst on the request that submitted it,
 *   - a cron tick a minute later,
 *   - the status poll of any tab that happens to be watching it.
 *
 * Without coordination all three would call `recordInfo` on the same task, all
 * three would download the same result, and the rate limit would be spent three
 * times over for one generation. The lease is the coordination: a worker takes
 * it, does one step, and releases it. Everyone else sees it held and leaves.
 *
 * Two properties matter, and both come from doing the claim in the database:
 *
 *   1. **Atomic.** `FOR UPDATE SKIP LOCKED` inside the subquery means two ticks
 *      firing in the same second claim disjoint sets rather than racing for the
 *      same row and one of them losing.
 *   2. **Self-healing.** The lease carries an expiry, not a lock. A worker
 *      killed mid-step — which on a serverless host is ordinary, not
 *      exceptional — leaves a lease that simply ages out, and the next tick
 *      picks the job up. Nothing has to notice the crash for the job to recover.
 */

/** States a worker can still make progress on. */
export const RESUMABLE_STATES = [
  'waiting',
  'queuing',
  'generating',
  'downloading',
  'needs_retry',
] as const satisfies readonly GenerationState[]

/**
 * How long a claim is good for.
 *
 * Comfortably longer than one step — a poll plus a 40 MB download — and
 * comfortably shorter than a person's patience for a stuck job. Too short and
 * two workers overlap on a slow download; too long and a crashed worker parks
 * the job for that whole window.
 */
export const LEASE_MS = 4 * 60_000

/** Identifies this invocation. Useful in logs; never trusted for correctness. */
export function workerId(): string {
  return `w_${crypto.randomBytes(6).toString('hex')}`
}

/**
 * Claims up to `limit` generations that are due.
 *
 * Due means: in a resumable state, past its backoff, and not currently leased.
 * Ordered oldest-deadline-first so a job that has been waiting longest is not
 * starved by a steady arrival of newer ones.
 *
 * `workspaceId` narrows the claim to one browser's work. The scheduled tick
 * omits it and sweeps everything; the on-visit sweep passes it, so opening the
 * app advances your own jobs without spending the invocation on a stranger's.
 */
export async function claimDue(
  limit: number,
  owner: string,
  workspaceId?: string,
): Promise<Generation[]> {
  const now = Date.now()
  const expires = now + LEASE_MS

  const sql = getSql()

  /*
   * Raw SQL, because Drizzle cannot express `FOR UPDATE SKIP LOCKED` inside the
   * subquery of an UPDATE, and that clause is the whole point of the statement.
   *
   * `state in ${sql([...])}` rather than `= any(${sql.array([...])})`. The array
   * form needs postgres-js to know the text[] OID, which it learns from a
   * type-introspection query issued when the connection opens — so the FIRST
   * statement on a cold connection can race it and go out untyped, failing with
   * "op ANY/ALL (array) requires array on right side" while the second identical
   * call succeeds. The `in` helper expands to ($1, $2, …) and needs no OID, so
   * it cannot lose that race.
   *
   * The workspace filter is a nullable parameter rather than a conditionally
   * interpolated fragment, so both callers run byte-identical SQL. One
   * statement is easier to reason about than two that differ by a branch, and
   * Postgres plans `($1 is null or col = $1)` fine against the index.
   */
  const scope = workspaceId ?? null

  const claimed = await sql<{ id: string }[]>`
    update generations
       set lease_owner = ${owner},
           lease_expires_at = ${expires}
     where id in (
       select id from generations
        where state in ${sql([...RESUMABLE_STATES])}
          and (next_poll_at is null or next_poll_at <= ${now})
          and (lease_expires_at is null or lease_expires_at <= ${now})
          and (${scope}::text is null or workspace_id = ${scope}::text)
        order by coalesce(next_poll_at, created_at) asc
        limit ${limit}
        for update skip locked
     )
    returning id
  `

  if (claimed.length === 0) return []

  // Loaded through Drizzle rather than mapped from the raw result: the row has
  // twenty-odd snake_case columns and hand-mapping them is exactly the kind of
  // silent drift a schema change would not catch.
  return getDb()
    .select()
    .from(generations)
    .where(
      inArray(
        generations.id,
        claimed.map((row) => row.id),
      ),
    )
}

/**
 * Claims one named generation, ignoring its backoff.
 *
 * The path for "someone is watching this right now" — an inline burst or an
 * open tab. It skips `next_poll_at` because a person asking is a better reason
 * to look than a timer, but it still respects a live lease: an impatient click
 * must not double-poll a job another worker already has.
 *
 * Returns null when the generation is finished, missing, or held elsewhere.
 */
export async function claimOne(id: string, owner: string): Promise<Generation | null> {
  const now = Date.now()

  const sql = getSql()

  const claimed = await sql<{ id: string }[]>`
    update generations
       set lease_owner = ${owner},
           lease_expires_at = ${now + LEASE_MS}
     where id = ${id}
       and state in ${sql([...RESUMABLE_STATES])}
       and (lease_expires_at is null or lease_expires_at <= ${now})
    returning id
  `
  if (claimed.length === 0) return null

  const [row] = await getDb()
    .select()
    .from(generations)
    .where(eq(generations.id, id))
    .limit(1)
  return row ?? null
}

/**
 * Releases a lease and says when the job should next be looked at.
 *
 * `nextPollAt` in the future is a backoff; omitting it means "immediately", for
 * a step that made progress and has more to do. The `lease_owner` guard stops a
 * worker whose lease already expired — and whose job another worker has since
 * picked up — from clearing the new holder's claim on its way out.
 */
export async function release(
  id: string,
  owner: string,
  nextPollAt?: number,
): Promise<void> {
  await getDb()
    .update(generations)
    .set({
      leaseOwner: null,
      leaseExpiresAt: null,
      nextPollAt: nextPollAt ?? Date.now(),
    })
    .where(and(eq(generations.id, id), eq(generations.leaseOwner, owner)))
}

/**
 * Clears the lease and the stored key of a generation that has finished.
 *
 * The key wipe rides along here rather than living in its own call because these
 * two facts are the same fact: the job is over, so nothing may advance it and
 * nothing needs its credentials. A sealed key left behind after completion is a
 * secret at rest with no remaining purpose.
 */
export async function settle(id: string): Promise<void> {
  await getDb()
    .update(generations)
    .set({
      leaseOwner: null,
      leaseExpiresAt: null,
      nextPollAt: null,
      kieKeyEnc: null,
    })
    .where(eq(generations.id, id))
}

/** How many jobs are waiting to be advanced, for the queue indicator. */
export async function dueCount(): Promise<number> {
  const now = Date.now()
  const [row] = await getDb()
    .select({ n: sql<string>`count(*)` })
    .from(generations)
    .where(
      and(
        inArray(generations.state, [...RESUMABLE_STATES]),
        sql`(${generations.nextPollAt} is null or ${generations.nextPollAt} <= ${now})`,
      ),
    )
  return Number(row?.n ?? 0)
}
