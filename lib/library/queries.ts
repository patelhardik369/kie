import 'server-only'

import crypto from 'node:crypto'
import { and, asc, count, desc, eq, gte, inArray, sql, sum } from 'drizzle-orm'

import {
  creditLog,
  generations,
  getDb,
  inputAssets,
  presets,
  prompts,
  type InputAsset,
  type Preset,
  type Prompt,
} from '../db/index.ts'
import { RECOVERABLE_STATES } from '../gallery/display.ts'
import { UPLOAD_TTL_MS } from '../kie/upload.ts'

/**
 * Reads and writes for the library surfaces: presets, prompts, input assets and
 * credit history.
 *
 * Server-only. Kept together because they are one feature — the things you
 * accumulate and reuse — rather than four unrelated tables.
 *
 * **Every function here takes a `workspaceId` as its first argument, and every
 * query filters on it.** That repetition is the point. The service-role
 * connection bypasses row-level security, so a query that forgets the filter
 * does not fail — it quietly returns another person's presets. Making the id a
 * required leading parameter means forgetting it is a type error rather than a
 * leak.
 */

// ------------------------------------------------------------------ presets

export async function listPresets(
  workspaceId: string,
  modelSlug?: string,
): Promise<Preset[]> {
  const db = getDb()
  const scope = modelSlug
    ? and(eq(presets.workspaceId, workspaceId), eq(presets.modelSlug, modelSlug))
    : eq(presets.workspaceId, workspaceId)

  return modelSlug
    ? db.select().from(presets).where(scope).orderBy(desc(presets.updatedAt))
    : db
        .select()
        .from(presets)
        .where(scope)
        .orderBy(asc(presets.modelSlug), desc(presets.updatedAt))
}

export async function getPreset(
  workspaceId: string,
  id: string,
): Promise<Preset | undefined> {
  const rows = await getDb()
    .select()
    .from(presets)
    .where(and(eq(presets.id, id), eq(presets.workspaceId, workspaceId)))
    .limit(1)
  return rows[0]
}

export async function createPreset(
  workspaceId: string,
  input: {
    name: string
    modelSlug: string
    params: Record<string, unknown>
    /** Whether runs from this preset start marked private. */
    nsfw?: boolean
  },
): Promise<Preset> {
  const now = Date.now()
  const row = {
    id: crypto.randomUUID(),
    workspaceId,
    name: input.name,
    // Model-scoped, always. A preset is never applied across models — the
    // parameters mean different things, when they exist at all.
    modelSlug: input.modelSlug,
    paramsJson: JSON.stringify(input.params),
    nsfw: input.nsfw === true,
    createdAt: now,
    updatedAt: now,
  }
  await getDb().insert(presets).values(row)
  return row
}

export async function updatePreset(
  workspaceId: string,
  id: string,
  patch: { name?: string; params?: Record<string, unknown>; nsfw?: boolean },
): Promise<Preset | undefined> {
  const values: Record<string, unknown> = { updatedAt: Date.now() }
  if (patch.name !== undefined) values.name = patch.name
  if (patch.params !== undefined) values.paramsJson = JSON.stringify(patch.params)
  if (patch.nsfw !== undefined) values.nsfw = patch.nsfw

  const rows = await getDb()
    .update(presets)
    .set(values)
    .where(and(eq(presets.id, id), eq(presets.workspaceId, workspaceId)))
    .returning()
  return rows[0]
}

export async function deletePreset(workspaceId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(presets)
    .where(and(eq(presets.id, id), eq(presets.workspaceId, workspaceId)))
    .returning({ id: presets.id })
  return rows.length > 0
}

// ------------------------------------------------------------------ prompts

export async function listPrompts(
  workspaceId: string,
  search?: string,
): Promise<Prompt[]> {
  const rows = await getDb()
    .select()
    .from(prompts)
    .where(eq(prompts.workspaceId, workspaceId))
    .orderBy(desc(prompts.createdAt))
  if (!search?.trim()) return rows

  // Filtered in JS rather than SQL: the prompt library is small by nature, and
  // tag matching against a JSON array is clearer here than as a LIKE.
  const term = search.trim().toLowerCase()
  return rows.filter(
    (p) =>
      p.title.toLowerCase().includes(term) ||
      p.body.toLowerCase().includes(term) ||
      parseTags(p.tagsJson).some((tag) => tag.toLowerCase().includes(term)),
  )
}

export async function createPrompt(
  workspaceId: string,
  input: { title: string; body: string; tags: string[] },
): Promise<Prompt> {
  const row = {
    id: crypto.randomUUID(),
    workspaceId,
    title: input.title,
    body: input.body,
    tagsJson: JSON.stringify(normalizeTags(input.tags)),
    createdAt: Date.now(),
  }
  await getDb().insert(prompts).values(row)
  return row
}

export async function updatePrompt(
  workspaceId: string,
  id: string,
  patch: { title?: string; body?: string; tags?: string[] },
): Promise<Prompt | undefined> {
  const values: Record<string, unknown> = {}
  if (patch.title !== undefined) values.title = patch.title
  if (patch.body !== undefined) values.body = patch.body
  if (patch.tags !== undefined) values.tagsJson = JSON.stringify(normalizeTags(patch.tags))

  if (Object.keys(values).length === 0) return getPrompt(workspaceId, id)

  const rows = await getDb()
    .update(prompts)
    .set(values)
    .where(and(eq(prompts.id, id), eq(prompts.workspaceId, workspaceId)))
    .returning()
  return rows[0]
}

async function getPrompt(
  workspaceId: string,
  id: string,
): Promise<Prompt | undefined> {
  const rows = await getDb()
    .select()
    .from(prompts)
    .where(and(eq(prompts.id, id), eq(prompts.workspaceId, workspaceId)))
    .limit(1)
  return rows[0]
}

export async function deletePrompt(workspaceId: string, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(prompts)
    .where(and(eq(prompts.id, id), eq(prompts.workspaceId, workspaceId)))
    .returning({ id: prompts.id })
  return rows.length > 0
}

export function parseTags(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : []
  } catch {
    return []
  }
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].sort()
}

/** Every tag in use, with counts, for the filter row. */
export async function promptTags(
  workspaceId: string,
): Promise<{ tag: string; count: number }[]> {
  const rows = await getDb()
    .select({ tagsJson: prompts.tagsJson })
    .from(prompts)
    .where(eq(prompts.workspaceId, workspaceId))

  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const tag of parseTags(row.tagsJson)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

// ------------------------------------------------------------ input assets

export interface LibraryAsset extends InputAsset {
  /** False once the Kie upload URL has expired and a re-upload is needed. */
  live: boolean
  expiresInMs: number | null
}

/**
 * Assets usable as model inputs.
 *
 * `live` is the thing the UI needs: an expired upload is not a broken asset,
 * because our own copy is kept in the bucket and `storeUpload` re-uploads
 * transparently on next use. It only means the cached URL cannot be pasted
 * straight into a field.
 */
export async function listInputAssets(
  workspaceId: string,
  kind?: string,
): Promise<LibraryAsset[]> {
  const scope = kind
    ? and(
        eq(inputAssets.workspaceId, workspaceId),
        eq(inputAssets.kind, kind as InputAsset['kind']),
      )
    : eq(inputAssets.workspaceId, workspaceId)

  const rows = await getDb()
    .select()
    .from(inputAssets)
    .where(scope)
    .orderBy(desc(inputAssets.createdAt))

  const now = Date.now()
  return rows.map((row) => ({
    ...row,
    live: Boolean(row.kieFileUrl && row.expiresAt && row.expiresAt > now),
    expiresInMs: row.expiresAt ? row.expiresAt - now : null,
  }))
}

export async function deleteInputAsset(
  workspaceId: string,
  id: string,
): Promise<InputAsset | undefined> {
  // Returns the row rather than a boolean: the caller has to remove the object
  // too, and it needs the storage key to do it.
  const rows = await getDb()
    .delete(inputAssets)
    .where(and(eq(inputAssets.id, id), eq(inputAssets.workspaceId, workspaceId)))
    .returning()
  return rows[0]
}

export { UPLOAD_TTL_MS }

// ----------------------------------------------------------------- credits

export interface SpendSummary {
  /** Latest recorded account balance, if one has been fetched. */
  balance: number | null
  balanceRecordedAt: number | null
  /** Sum of `credits_consumed` across this workspace's generations. */
  totalSpent: number
  byModel: { modelSlug: string; credits: number; runs: number }[]
  byDay: { day: string; credits: number; runs: number }[]
}

/**
 * Spend, from our own rows.
 *
 * Kie's logs age out after two months, so `generations.credits_consumed` is the
 * long-term record — this reads it rather than asking the API.
 */
export async function getSpendSummary(
  workspaceId: string,
  days = 30,
): Promise<SpendSummary> {
  const db = getDb()
  const since = Date.now() - days * 24 * 60 * 60 * 1000
  const mine = eq(generations.workspaceId, workspaceId)
  const recent = and(mine, gte(generations.createdAt, since))

  const [latest, totals, byModel, byDay] = await Promise.all([
    db
      .select()
      .from(creditLog)
      .where(eq(creditLog.workspaceId, workspaceId))
      .orderBy(desc(creditLog.recordedAt))
      .limit(1),
    db.select({ total: sum(generations.creditsConsumed) }).from(generations).where(mine),
    db
      .select({
        modelSlug: generations.modelSlug,
        credits: sum(generations.creditsConsumed),
        runs: count(),
      })
      .from(generations)
      .where(recent)
      .groupBy(generations.modelSlug)
      .orderBy(desc(sum(generations.creditsConsumed))),
    db
      .select({
        // UTC day. The SQLite version used 'localtime' to match the folder
        // layout on disk; there is no disk any more, and a server's local time
        // is not the viewer's, so UTC is the only stable answer.
        day: sql<string>`to_char(to_timestamp(${generations.createdAt} / 1000.0) at time zone 'UTC', 'YYYY-MM-DD')`,
        credits: sum(generations.creditsConsumed),
        runs: count(),
      })
      .from(generations)
      .where(recent)
      .groupBy(sql`1`)
      .orderBy(sql`1 desc`),
  ])

  return {
    balance: latest[0]?.balance ?? null,
    balanceRecordedAt: latest[0]?.recordedAt ?? null,
    totalSpent: Number(totals[0]?.total ?? 0),
    byModel: byModel.map((r) => ({
      modelSlug: r.modelSlug,
      credits: Number(r.credits ?? 0),
      runs: r.runs,
    })),
    byDay: byDay.map((r) => ({
      day: r.day,
      credits: Number(r.credits ?? 0),
      runs: r.runs,
    })),
  }
}

/**
 * Records a balance reading.
 *
 * Throttled: the header asks for the balance on every page load, and a row per
 * request would bury the trend this table exists to show.
 */
const BALANCE_LOG_INTERVAL_MS = 15 * 60_000

export async function recordBalance(
  workspaceId: string,
  balance: number,
): Promise<void> {
  const db = getDb()
  const [latest] = await db
    .select()
    .from(creditLog)
    .where(eq(creditLog.workspaceId, workspaceId))
    .orderBy(desc(creditLog.recordedAt))
    .limit(1)

  if (
    latest &&
    latest.balance === balance &&
    Date.now() - latest.recordedAt < BALANCE_LOG_INTERVAL_MS
  ) {
    return
  }

  await db.insert(creditLog).values({
    id: crypto.randomUUID(),
    workspaceId,
    balance,
    recordedAt: Date.now(),
  })
}

/** Balance readings over time, oldest first, for a sparkline. */
export async function balanceHistory(workspaceId: string, limit = 200) {
  const rows = await getDb()
    .select()
    .from(creditLog)
    .where(eq(creditLog.workspaceId, workspaceId))
    .orderBy(desc(creditLog.recordedAt))
    .limit(limit)
  return rows.reverse()
}

/**
 * Row counts for the settings summary — one query, not three.
 *
 * Three `$count`s through `Promise.all` is three round trips for three integers.
 * That is cheap against a local file and wasteful against a pooled connection on
 * another continent, where Settings already fans out enough work to contend for
 * the pool.
 */
export async function libraryCounts(workspaceId: string) {
  const [row] = await getDb().execute<{
    presets: string
    prompts: string
    input_assets: string
  }>(sql`
    select
      (select count(*)::text from presets       where workspace_id = ${workspaceId}) as presets,
      (select count(*)::text from prompts       where workspace_id = ${workspaceId}) as prompts,
      (select count(*)::text from input_assets  where workspace_id = ${workspaceId}) as input_assets
  `)

  return {
    presets: Number(row?.presets ?? 0),
    prompts: Number(row?.prompts ?? 0),
    inputAssets: Number(row?.input_assets ?? 0),
  }
}

/**
 * Generations parked in a recoverable state, for the Settings recovery panel.
 *
 * Counted rather than listed: the question Settings answers is "is anything
 * waiting on me", and the gallery's `state=` filter is where you go to look at
 * them one by one.
 */
export async function parkedCounts(workspaceId: string): Promise<{
  total: number
  byState: Record<string, number>
}> {
  const rows = await getDb()
    .select({ state: generations.state, n: count() })
    .from(generations)
    .where(
      and(
        eq(generations.workspaceId, workspaceId),
        inArray(generations.state, [...RECOVERABLE_STATES]),
      ),
    )
    .groupBy(generations.state)

  return {
    total: rows.reduce((sum, row) => sum + row.n, 0),
    byState: Object.fromEntries(rows.map((row) => [row.state, row.n])),
  }
}

/** Guards a delete of an asset still referenced by a recent generation. */
export async function inputAssetUsage(
  workspaceId: string,
  fileUrl: string,
): Promise<number> {
  const [row] = await getDb()
    .select({ total: count() })
    .from(generations)
    .where(
      and(
        eq(generations.workspaceId, workspaceId),
        sql`${generations.inputJson} LIKE ${'%' + fileUrl + '%'}`,
      ),
    )
  return row?.total ?? 0
}
