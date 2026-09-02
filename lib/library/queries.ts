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
 */

// ------------------------------------------------------------------ presets

export async function listPresets(modelSlug?: string): Promise<Preset[]> {
  const db = getDb()
  const query = db.select().from(presets)
  const rows = modelSlug
    ? await query.where(eq(presets.modelSlug, modelSlug)).orderBy(desc(presets.updatedAt))
    : await query.orderBy(asc(presets.modelSlug), desc(presets.updatedAt))
  return rows
}

export async function getPreset(id: string): Promise<Preset | undefined> {
  const rows = await getDb().select().from(presets).where(eq(presets.id, id)).limit(1)
  return rows[0]
}

export async function createPreset(input: {
  name: string
  modelSlug: string
  params: Record<string, unknown>
}): Promise<Preset> {
  const now = Date.now()
  const row = {
    id: crypto.randomUUID(),
    name: input.name,
    // Model-scoped, always. A preset is never applied across models — the
    // parameters mean different things, when they exist at all.
    modelSlug: input.modelSlug,
    paramsJson: JSON.stringify(input.params),
    createdAt: now,
    updatedAt: now,
  }
  await getDb().insert(presets).values(row)
  return row
}

export async function updatePreset(
  id: string,
  patch: { name?: string; params?: Record<string, unknown> },
): Promise<Preset | undefined> {
  const values: Record<string, unknown> = { updatedAt: Date.now() }
  if (patch.name !== undefined) values.name = patch.name
  if (patch.params !== undefined) values.paramsJson = JSON.stringify(patch.params)

  const rows = await getDb()
    .update(presets)
    .set(values)
    .where(eq(presets.id, id))
    .returning()
  return rows[0]
}

export async function deletePreset(id: string): Promise<boolean> {
  const rows = await getDb().delete(presets).where(eq(presets.id, id)).returning({
    id: presets.id,
  })
  return rows.length > 0
}

// ------------------------------------------------------------------ prompts

export async function listPrompts(search?: string): Promise<Prompt[]> {
  const rows = await getDb().select().from(prompts).orderBy(desc(prompts.createdAt))
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

export async function createPrompt(input: {
  title: string
  body: string
  tags: string[]
}): Promise<Prompt> {
  const row = {
    id: crypto.randomUUID(),
    title: input.title,
    body: input.body,
    tagsJson: JSON.stringify(normalizeTags(input.tags)),
    createdAt: Date.now(),
  }
  await getDb().insert(prompts).values(row)
  return row
}

export async function updatePrompt(
  id: string,
  patch: { title?: string; body?: string; tags?: string[] },
): Promise<Prompt | undefined> {
  const values: Record<string, unknown> = {}
  if (patch.title !== undefined) values.title = patch.title
  if (patch.body !== undefined) values.body = patch.body
  if (patch.tags !== undefined) values.tagsJson = JSON.stringify(normalizeTags(patch.tags))

  if (Object.keys(values).length === 0) return getPrompt(id)

  const rows = await getDb().update(prompts).set(values).where(eq(prompts.id, id)).returning()
  return rows[0]
}

async function getPrompt(id: string): Promise<Prompt | undefined> {
  const rows = await getDb().select().from(prompts).where(eq(prompts.id, id)).limit(1)
  return rows[0]
}

export async function deletePrompt(id: string): Promise<boolean> {
  const rows = await getDb().delete(prompts).where(eq(prompts.id, id)).returning({
    id: prompts.id,
  })
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
export async function promptTags(): Promise<{ tag: string; count: number }[]> {
  const rows = await getDb().select({ tagsJson: prompts.tagsJson }).from(prompts)
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
  /** Whether the local copy still exists to re-upload FROM. */
  expiresInMs: number | null
}

/**
 * Assets usable as model inputs.
 *
 * `live` is the thing the UI needs: an expired upload is not a broken asset,
 * because the local copy is kept and `storeUpload` re-uploads transparently on
 * next use. It only means the cached URL cannot be pasted straight into a field.
 */
export async function listInputAssets(kind?: string): Promise<LibraryAsset[]> {
  const db = getDb()
  const rows = kind
    ? await db
        .select()
        .from(inputAssets)
        .where(eq(inputAssets.kind, kind as InputAsset['kind']))
        .orderBy(desc(inputAssets.createdAt))
    : await db.select().from(inputAssets).orderBy(desc(inputAssets.createdAt))

  const now = Date.now()
  return rows.map((row) => ({
    ...row,
    live: Boolean(row.kieFileUrl && row.expiresAt && row.expiresAt > now),
    expiresInMs: row.expiresAt ? row.expiresAt - now : null,
  }))
}

export async function deleteInputAsset(id: string): Promise<boolean> {
  const rows = await getDb().delete(inputAssets).where(eq(inputAssets.id, id)).returning({
    id: inputAssets.id,
  })
  return rows.length > 0
}

export { UPLOAD_TTL_MS }

// ----------------------------------------------------------------- credits

export interface SpendSummary {
  /** Latest recorded account balance, if one has been fetched. */
  balance: number | null
  balanceRecordedAt: number | null
  /** Sum of `credits_consumed` across all generations. */
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
export async function getSpendSummary(days = 30): Promise<SpendSummary> {
  const db = getDb()
  const since = Date.now() - days * 24 * 60 * 60 * 1000

  const [latest, totals, byModel, byDay] = await Promise.all([
    db.select().from(creditLog).orderBy(desc(creditLog.recordedAt)).limit(1),
    db
      .select({ total: sum(generations.creditsConsumed) })
      .from(generations),
    db
      .select({
        modelSlug: generations.modelSlug,
        credits: sum(generations.creditsConsumed),
        runs: count(),
      })
      .from(generations)
      .where(gte(generations.createdAt, since))
      .groupBy(generations.modelSlug)
      .orderBy(desc(sum(generations.creditsConsumed))),
    db
      .select({
        // Local-time day, so the chart matches the folder layout on disk.
        day: sql<string>`date(${generations.createdAt} / 1000, 'unixepoch', 'localtime')`,
        credits: sum(generations.creditsConsumed),
        runs: count(),
      })
      .from(generations)
      .where(gte(generations.createdAt, since))
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

export async function recordBalance(balance: number): Promise<void> {
  const db = getDb()
  const [latest] = await db
    .select()
    .from(creditLog)
    .orderBy(desc(creditLog.recordedAt))
    .limit(1)

  if (
    latest &&
    latest.balance === balance &&
    Date.now() - latest.recordedAt < BALANCE_LOG_INTERVAL_MS
  ) {
    return
  }

  await db.insert(creditLog).values({ balance, recordedAt: Date.now() })
}

/** Balance readings over time, oldest first, for a sparkline. */
export async function balanceHistory(limit = 200) {
  const rows = await getDb()
    .select()
    .from(creditLog)
    .orderBy(desc(creditLog.recordedAt))
    .limit(limit)
  return rows.reverse()
}

/** Rows a generation-count query needs, for the settings summary. */
export async function libraryCounts() {
  const db = getDb()
  const [presetCount, promptCount, assetCount] = await Promise.all([
    db.$count(presets),
    db.$count(prompts),
    db.$count(inputAssets),
  ])
  return { presets: presetCount, prompts: promptCount, inputAssets: assetCount }
}

/**
 * Generations parked in a recoverable state, for the Settings recovery panel.
 *
 * Counted rather than listed: the question Settings answers is "is anything
 * waiting on me", and the gallery's `state=` filter is where you go to look at
 * them one by one.
 */
export async function parkedCounts(): Promise<{
  total: number
  byState: Record<string, number>
}> {
  const rows = await getDb()
    .select({ state: generations.state, n: count() })
    .from(generations)
    .where(inArray(generations.state, [...RECOVERABLE_STATES]))
    .groupBy(generations.state)

  return {
    total: rows.reduce((sum, row) => sum + row.n, 0),
    byState: Object.fromEntries(rows.map((row) => [row.state, row.n])),
  }
}

/** Guards a delete of an asset still referenced by a recent generation. */
export async function inputAssetUsage(fileUrl: string): Promise<number> {
  const [row] = await getDb()
    .select({ total: count() })
    .from(generations)
    .where(and(sql`${generations.inputJson} LIKE ${'%' + fileUrl + '%'}`))
  return row?.total ?? 0
}
