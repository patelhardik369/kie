import 'server-only'

import { asc, eq, inArray } from 'drizzle-orm'

import { favoriteModels, getDb } from '../db/index.ts'
import { getModel } from '../kie/registry/index.ts'
import { applyOrder, resolvePins, type PinnedModel } from '../models/favorites.ts'

/**
 * Reads and writes for pinned models.
 *
 * Every function returns the WHOLE resolved list rather than the row it touched.
 * The pin bar is the same list on four surfaces at once (the picker, the home
 * page, the nav popover, the model page's star), and handing back a diff would
 * make each of them responsible for replaying the write correctly. One list, one
 * source of truth, one render.
 *
 * Positions are rewritten contiguously on every mutation. A sparse column would
 * work, but "the third pin" then means something different in the database than
 * on screen, and reordering by arrow keys turns into gap arithmetic.
 */

async function slugsInOrder(): Promise<string[]> {
  const rows = await getDb()
    .select({ slug: favoriteModels.slug, position: favoriteModels.position })
    .from(favoriteModels)
    .orderBy(asc(favoriteModels.position), asc(favoriteModels.slug))
  return rows.map((row) => row.slug)
}

/** Writes `slugs` as positions 0..n-1. Assumes every slug already has a row. */
async function renumber(slugs: readonly string[]): Promise<void> {
  const db = getDb()
  for (const [position, slug] of slugs.entries()) {
    await db
      .update(favoriteModels)
      .set({ position })
      .where(eq(favoriteModels.slug, slug))
  }
}

export async function listPins(): Promise<PinnedModel[]> {
  const rows = await getDb()
    .select({ slug: favoriteModels.slug, position: favoriteModels.position })
    .from(favoriteModels)
  return resolvePins(rows, getModel)
}

/**
 * Pins a model at the END of the list.
 *
 * Idempotent: pinning something already pinned leaves its position alone rather
 * than moving it to the bottom. The star is a toggle on three different screens,
 * and a double click that silently reordered the bar would be indistinguishable
 * from a bug.
 */
export async function addPin(slug: string): Promise<PinnedModel[]> {
  const existing = await slugsInOrder()
  if (!existing.includes(slug)) {
    await getDb()
      .insert(favoriteModels)
      .values({ slug, position: existing.length, createdAt: Date.now() })
      // Two tabs racing on the same star must not 500.
      .onConflictDoNothing()
  }
  return listPins()
}

export async function removePin(slug: string): Promise<PinnedModel[]> {
  await getDb().delete(favoriteModels).where(eq(favoriteModels.slug, slug))
  // Closes the gap the removal left, so positions stay 0..n-1.
  await renumber(await slugsInOrder())
  return listPins()
}

/**
 * Applies a requested order.
 *
 * The request is reconciled against what is actually pinned (see `applyOrder`),
 * so a reorder sent from a stale tab can neither resurrect an unpinned model nor
 * drop one it had not heard about.
 */
export async function reorderPins(requested: readonly string[]): Promise<PinnedModel[]> {
  await renumber(applyOrder(await slugsInOrder(), requested))
  return listPins()
}

/** Which of these slugs are pinned — for a page that renders many stars. */
export async function pinnedAmong(slugs: readonly string[]): Promise<Set<string>> {
  if (slugs.length === 0) return new Set()
  const rows = await getDb()
    .select({ slug: favoriteModels.slug })
    .from(favoriteModels)
    .where(inArray(favoriteModels.slug, [...slugs]))
  return new Set(rows.map((row) => row.slug))
}
