import 'server-only'

import { and, asc, eq, sql } from 'drizzle-orm'

import { assets, generations, getDb, inputAssets, workspaces } from '../db/index.ts'
import { getEnv } from '../env.ts'

/**
 * How much of the storage plan is spent, and what to do when it runs out.
 *
 * This module exists because Supabase Free gives 1 GB in total and a single
 * 1080p video is 10–50 MB of it. On a laptop, running out of disk announced
 * itself; here the failure arrives as a 413 from a storage API in the middle of
 * a generation that has already been paid for, which is the worst possible
 * moment to discover it.
 *
 * So the quota is checked BEFORE a generation is submitted, not after it
 * returns. A run refused up front costs nothing; one refused after Kie has
 * billed for it costs credits and leaves an output that can never be stored.
 *
 * Usage is summed from `assets.bytes` and `input_assets.bytes` rather than
 * asked of Supabase, for two reasons: the Storage API has no cheap "how big is
 * this bucket" call, and the database is what the eviction path has to act on
 * anyway. It can drift if an object is removed outside the app, which
 * `recomputeUsage` is for.
 */

/** Warn from here on. Below it, the meter is informational. */
export const WARN_FRACTION = 0.8

export interface StorageUsage {
  /** Bytes stored by this workspace. */
  workspaceBytes: number
  /** Bytes stored across every workspace — what actually fills the plan. */
  totalBytes: number
  quotaBytes: number
  /** 0–1, against the whole-project quota. */
  fraction: number
  warn: boolean
  full: boolean
  /** Per-object ceiling, surfaced so the UI can say why a video was refused. */
  maxFileBytes: number
  /** Outputs never stored because they exceeded the per-object ceiling. */
  oversizeCount: number
}

export async function readUsage(workspaceId: string): Promise<StorageUsage> {
  const env = getEnv()
  const db = getDb()

  const [[outputs], [inputs], [mine], [myInputs], [oversize]] = await Promise.all([
    db
      .select({ total: sql<string>`coalesce(sum(${assets.bytes}), 0)` })
      .from(assets)
      .where(eq(assets.storageState, 'stored')),
    db.select({ total: sql<string>`coalesce(sum(${inputAssets.bytes}), 0)` }).from(inputAssets),
    db
      .select({ total: sql<string>`coalesce(sum(${assets.bytes}), 0)` })
      .from(assets)
      .where(and(eq(assets.workspaceId, workspaceId), eq(assets.storageState, 'stored'))),
    db
      .select({ total: sql<string>`coalesce(sum(${inputAssets.bytes}), 0)` })
      .from(inputAssets)
      .where(eq(inputAssets.workspaceId, workspaceId)),
    db
      .select({ n: sql<string>`count(*)` })
      .from(assets)
      .where(and(eq(assets.workspaceId, workspaceId), eq(assets.storageState, 'too_large'))),
  ])

  // sum() over bigint comes back as a string from pg — Number() on it is exact
  // well past any plausible bucket size, but the cast has to be explicit or the
  // arithmetic below concatenates.
  const totalBytes = num(outputs?.total) + num(inputs?.total)
  const workspaceBytes = num(mine?.total) + num(myInputs?.total)
  const quotaBytes = env.storageQuotaBytes
  const fraction = quotaBytes > 0 ? totalBytes / quotaBytes : 0

  return {
    workspaceBytes,
    totalBytes,
    quotaBytes,
    fraction,
    warn: fraction >= WARN_FRACTION,
    full: totalBytes >= quotaBytes,
    maxFileBytes: env.maxFileBytes,
    oversizeCount: num(oversize?.n),
  }
}

export type QuotaVerdict =
  | { ok: true; usage: StorageUsage }
  | { ok: false; usage: StorageUsage; message: string }

/**
 * Whether there is room to start something.
 *
 * `estimatedBytes` is a guess by design — nothing knows how big a video will be
 * until it exists. It is there so a run started at 990 MB of 1024 MB is refused
 * rather than allowed to fail on the way back.
 */
export async function checkQuota(
  workspaceId: string,
  estimatedBytes = 0,
): Promise<QuotaVerdict> {
  const usage = await readUsage(workspaceId)

  if (usage.totalBytes + estimatedBytes <= usage.quotaBytes) return { ok: true, usage }

  return {
    ok: false,
    usage,
    message:
      `Storage is full — ${format(usage.totalBytes)} of ${format(usage.quotaBytes)} used. ` +
      'Delete some generations from the gallery to make room, or raise ' +
      'STORAGE_QUOTA_BYTES if the Supabase plan behind it has grown.',
  }
}

/**
 * The oldest stored outputs of one workspace, for the "free up space" flow.
 *
 * Oldest-first and complete-only. It never returns anything from a generation
 * still in flight: the downloader is writing to those, and evicting an object
 * out from under it produces a `complete` generation pointing at nothing.
 */
export async function evictionCandidates(workspaceId: string, limit = 20) {
  return getDb()
    .select({
      assetId: assets.id,
      generationId: assets.generationId,
      storagePath: assets.storagePath,
      bytes: assets.bytes,
      kind: assets.kind,
      downloadedAt: assets.downloadedAt,
      modelSlug: generations.modelSlug,
    })
    .from(assets)
    .innerJoin(generations, eq(assets.generationId, generations.id))
    .where(
      and(
        eq(assets.workspaceId, workspaceId),
        eq(assets.storageState, 'stored'),
        eq(generations.state, 'complete'),
      ),
    )
    .orderBy(asc(assets.downloadedAt))
    .limit(limit)
}

/**
 * Re-derives `workspaces.stored_bytes` from the asset rows.
 *
 * The cached column is a convenience for listing workspaces without five
 * aggregate queries; this is what makes it true again after objects are removed
 * outside the app.
 */
export async function recomputeUsage(workspaceId: string): Promise<number> {
  const usage = await readUsage(workspaceId)
  await getDb()
    .update(workspaces)
    .set({ storedBytes: usage.workspaceBytes })
    .where(eq(workspaces.id, workspaceId))
  return usage.workspaceBytes
}

function num(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

export function format(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
