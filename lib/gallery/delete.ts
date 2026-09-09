import 'server-only'

import { and, eq, inArray } from 'drizzle-orm'

import { assets, generations, getDb, inputAssets } from '../db/index.ts'
import { removeObjects } from '../storage/objects.ts'
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
 *   1. **The bytes go too.** `assets.storage_path` is the only record of where
 *      an output landed, so deleting the row without the object would strand it
 *      in the bucket with nothing left that knows it exists. On a 1 GB plan that
 *      is not untidiness, it is the quota — reclaiming space is the reason
 *      people delete things.
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
  /** Objects removed from the bucket. */
  filesDeleted: number
  /** Asset rows that had no object to remove — oversize ones, counted not failed. */
  filesMissing: number
  /** Storage reclaimed, from the recorded byte counts. */
  bytesFreed: number
  /** Children re-pointed at the deleted generation's own parent. */
  childrenRelinked: number
  /** Input-library rows that pointed at these files, removed with them. */
  inputsForgotten: number
}

export type DeleteOutcome =
  | { ok: true; deleted: DeletedGeneration }
  | { ok: false; reason: 'not_found' | 'in_flight'; message: string }

export async function deleteGeneration(
  workspaceId: string,
  id: string,
): Promise<DeleteOutcome> {
  const db = getDb()

  const [generation] = await db
    .select()
    .from(generations)
    .where(and(eq(generations.id, id), eq(generations.workspaceId, workspaceId)))
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
    workspaceId,
    owned.map((asset) => ({ storagePath: asset.storagePath, bytes: asset.bytes })),
  )

  /*
   * An output reused as an INPUT is registered against the output's own key —
   * no second copy is made (see lib/jobs/uploads.ts). The object has just gone,
   * so the row that points at it would be a library entry that can never be
   * renewed and never explain why. It goes with the object.
   *
   * Rows under `_inputs/` are untouched: those are uploads with their own copy,
   * and they were never this generation's to delete.
   */
  const reusedPaths = owned
    .map((asset) => asset.storagePath)
    .filter((key): key is string => key !== null)
  const inputsForgotten = reusedPaths.length
    ? await db
        .delete(inputAssets)
        .where(
          and(
            eq(inputAssets.workspaceId, workspaceId),
            inArray(inputAssets.storagePath, reusedPaths),
          ),
        )
        .returning({ id: inputAssets.id })
    : []

  // Re-point before the delete: a child left pointing at a missing row would
  // read as "no lineage", which is a different and wrong claim.
  const relinked = await db
    .update(generations)
    .set({ parentId: generation.parentId })
    .where(eq(generations.parentId, id))
    .returning({ id: generations.id })

  // Explicit rather than leaning on ON DELETE CASCADE. Postgres would honour the
  // cascade, but the asset rows have already been read and their objects
  // removed — doing the delete here keeps the whole operation legible in one
  // place rather than half here and half in a constraint.
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
      inputsForgotten: inputsForgotten.length,
    },
  }
}

/** Deletes several generations, stopping at nothing — one refusal is not the rest. */
export async function deleteGenerations(
  workspaceId: string,
  ids: string[],
): Promise<{
  deleted: DeletedGeneration[]
  refused: { id: string; reason: 'not_found' | 'in_flight'; message: string }[]
}> {
  const deleted: DeletedGeneration[] = []
  const refused: { id: string; reason: 'not_found' | 'in_flight'; message: string }[] = []

  for (const id of ids) {
    const outcome = await deleteGeneration(workspaceId, id)
    if (outcome.ok) deleted.push(outcome.deleted)
    else refused.push({ id, reason: outcome.reason, message: outcome.message })
  }

  return { deleted, refused }
}

/**
 * Removes an asset's objects from the bucket.
 *
 * The workspace-prefix check is the guard `resolveWithin` used to be: a
 * `storage_path` is data, and data naming another workspace's object is not
 * something this delete gets to act on. A row with no object — an oversize
 * output that was never stored — is counted as missing rather than failed,
 * which is exactly what it is.
 *
 * A failure to remove is deliberately NOT fatal. The rows are going either way:
 * a stray object costs quota and can be swept later, where a gallery row
 * pointing at a deleted generation is a permanently broken tile.
 */
async function removeFiles(
  workspaceId: string,
  files: { storagePath: string | null; bytes: number | null }[],
): Promise<{ filesDeleted: number; filesMissing: number; bytesFreed: number }> {
  const keys: string[] = []
  let filesMissing = 0
  let bytesFreed = 0

  for (const file of files) {
    if (!file.storagePath || !file.storagePath.startsWith(workspaceId + '/')) {
      filesMissing += 1
      continue
    }
    keys.push(file.storagePath)
    bytesFreed += file.bytes ?? 0
  }

  let filesDeleted = 0
  try {
    filesDeleted = await removeObjects(keys)
  } catch (error) {
    console.error('[kie-studio] could not remove objects:', error)
    filesMissing += keys.length
    bytesFreed = 0
  }

  return { filesDeleted, filesMissing, bytesFreed }
}
