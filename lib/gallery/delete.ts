import 'server-only'

import fs from 'node:fs/promises'
import path from 'node:path'
import { eq, inArray } from 'drizzle-orm'

import { assets, generations, getDb } from '../db/index.ts'
import { getEnv } from '../env.ts'
import { resolveWithin } from '../jobs/paths.ts'
import { isInFlight } from './display.ts'

/**
 * Throwing a generation away.
 *
 * Everything else in the gallery is additive — a record, once made, is kept and
 * annotated. This is the one operation that removes one, and it exists because
 * a studio accumulates work that is simply bad, and a grid you have to scroll
 * past your own mistakes to read is worse than one missing a row.
 *
 * Three rules shape it:
 *
 *   1. **The bytes go too.** `assets.local_path` is the only record of where an
 *      output landed, so deleting the row without the file would strand it on
 *      disk with nothing left that knows it exists. Disk is the reason people
 *      delete things.
 *   2. **Nothing in flight.** The runner is still writing to a generation it is
 *      polling, and its downloader would recreate rows and files under a row
 *      that no longer exists. Wait for it to finish or fail — then delete it.
 *   3. **The chain survives.** Children re-run from the deleted generation are
 *      re-pointed at its own parent rather than left holding a dangling
 *      `parent_id`. Deleting a middle link shortens the lineage; it does not
 *      break it.
 *
 * It is not reversible, and deliberately not soft: `nsfw` already covers "keep
 * it but stop showing it", so a delete that only hid the row would be a second,
 * confusing way to do the thing the mark already does.
 */

export interface DeletedGeneration {
  id: string
  /** Files removed from KIE_OUTPUT_DIR. */
  filesDeleted: number
  /** Asset rows whose file was already gone — counted, not an error. */
  filesMissing: number
  /** Disk reclaimed, from the recorded byte counts. */
  bytesFreed: number
  /** Children re-pointed at the deleted generation's own parent. */
  childrenRelinked: number
}

export type DeleteOutcome =
  | { ok: true; deleted: DeletedGeneration }
  | { ok: false; reason: 'not_found' | 'in_flight'; message: string }

export async function deleteGeneration(id: string): Promise<DeleteOutcome> {
  const db = getDb()

  const [generation] = await db
    .select()
    .from(generations)
    .where(eq(generations.id, id))
    .limit(1)

  if (!generation) {
    return { ok: false, reason: 'not_found', message: 'No such generation.' }
  }

  if (isInFlight(generation.state)) {
    return {
      ok: false,
      reason: 'in_flight',
      message:
        'This generation is still running — the poller is writing to it, and its ' +
        'output has not landed yet. Delete it once it completes or fails.',
    }
  }

  const owned = await db.select().from(assets).where(eq(assets.generationId, id))

  const { filesDeleted, filesMissing, bytesFreed } = await removeFiles(
    owned.map((asset) => ({ localPath: asset.localPath, bytes: asset.bytes })),
  )

  // Re-point before the delete: a child left pointing at a missing row would
  // read as "no lineage", which is a different and wrong claim.
  const relinked = await db
    .update(generations)
    .set({ parentId: generation.parentId })
    .where(eq(generations.parentId, id))
    .returning({ id: generations.id })

  // Explicit rather than leaning on ON DELETE CASCADE: whether SQLite enforces
  // foreign keys depends on a per-connection pragma, and orphaned asset rows
  // pointing at files that are already gone is not a state worth risking.
  await db.delete(assets).where(eq(assets.generationId, id))
  await db.delete(generations).where(eq(generations.id, id))

  return {
    ok: true,
    deleted: {
      id,
      filesDeleted,
      filesMissing,
      bytesFreed,
      childrenRelinked: relinked.length,
    },
  }
}

/** Deletes several generations, stopping at nothing — one refusal is not the rest. */
export async function deleteGenerations(ids: string[]): Promise<{
  deleted: DeletedGeneration[]
  refused: { id: string; reason: 'not_found' | 'in_flight'; message: string }[]
}> {
  const deleted: DeletedGeneration[] = []
  const refused: { id: string; reason: 'not_found' | 'in_flight'; message: string }[] = []

  for (const id of ids) {
    const outcome = await deleteGeneration(id)
    if (outcome.ok) deleted.push(outcome.deleted)
    else refused.push({ id, reason: outcome.reason, message: outcome.message })
  }

  return { deleted, refused }
}

/**
 * Removes output files, then any folder the removal emptied.
 *
 * `resolveWithin` is the guard: `local_path` is stored relative to
 * KIE_OUTPUT_DIR, and anything that resolves outside it is left alone rather
 * than deleted. A missing file is not an error — the point of the call is that
 * the file should not exist afterwards.
 */
async function removeFiles(
  files: { localPath: string; bytes: number | null }[],
): Promise<{ filesDeleted: number; filesMissing: number; bytesFreed: number }> {
  const root = path.resolve(getEnv().outputDir)
  let filesDeleted = 0
  let filesMissing = 0
  let bytesFreed = 0

  const touchedDirs = new Set<string>()

  for (const file of files) {
    const absolute = resolveWithin(root, file.localPath)
    if (!absolute) continue

    try {
      await fs.unlink(absolute)
      filesDeleted += 1
      bytesFreed += file.bytes ?? 0
      touchedDirs.add(path.dirname(absolute))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') filesMissing += 1
      // Anything else — a lock, a permission — leaves the file and is not fatal:
      // the row is still going, and a stray file is recoverable where a stuck
      // gallery row is not.
    }
  }

  for (const dir of touchedDirs) await pruneEmpty(dir, root)

  return { filesDeleted, filesMissing, bytesFreed }
}

/** Walks up from `dir`, removing empty folders, and stops at `root` itself. */
async function pruneEmpty(dir: string, root: string): Promise<void> {
  let current = dir
  while (current !== root && current.startsWith(root + path.sep)) {
    try {
      await fs.rmdir(current)
    } catch {
      // Not empty, or gone already. Either way there is nothing above to prune.
      return
    }
    current = path.dirname(current)
  }
}
