import type { Capability, Family, ModelDefinition } from '../kie/registry/types.ts'

/**
 * Pinned models — the shortlist that sits above the 97.
 *
 * Pure module. No env, no db, no React: the same functions run in the API route
 * that persists an order and in the client store that predicts it, so a pin that
 * moves optimistically lands exactly where the server puts it.
 *
 * The reconciliation rules below exist because a pin list has TWO authorities
 * that can disagree. The database says which slugs are pinned; the compiled
 * registry says which slugs exist. Neither is allowed to overrule the other:
 *
 *   - A pinned slug the registry no longer knows is kept and flagged `missing`,
 *     never dropped. A pin is a statement about how you work, and deleting it
 *     because a model was renamed would lose that silently — the row stays, the
 *     UI says so, and unpinning is one click.
 *   - A reorder naming slugs that are not pinned ignores them rather than
 *     pinning them. Two tabs open on the same list must not resurrect a pin the
 *     other one removed.
 */

export interface PinnedModel {
  /** Verbatim registry slug. */
  slug: string
  /** The registry's label, or the slug itself when the model is gone. */
  label: string
  family: Family | null
  capability: Capability | null
  /** Ascending, contiguous from 0 after any write. */
  position: number
  /** Pinned, but no longer in the registry. Still listed, still unpinnable. */
  missing: boolean
}

/** A pinned row as stored: slug plus its place in the order. */
export interface PinnedRow {
  slug: string
  position: number
}

/**
 * Resolves stored pins against the registry, in stored order.
 *
 * `lookup` is passed in rather than imported so this stays free of the registry
 * barrel — the client store calls it with nothing to resolve at all.
 */
export function resolvePins(
  rows: readonly PinnedRow[],
  lookup: (slug: string) => ModelDefinition | undefined,
): PinnedModel[] {
  return [...rows]
    .sort((a, b) => a.position - b.position || a.slug.localeCompare(b.slug))
    .map((row, index) => {
      const model = lookup(row.slug)
      return {
        slug: row.slug,
        label: model?.label ?? row.slug,
        family: model?.family ?? null,
        capability: model?.capability ?? null,
        // Renumbered on read: stored positions may have gaps from removals, and
        // every consumer wants an index it can compare against a sibling's.
        position: index,
        missing: model === undefined,
      }
    })
}

/**
 * The order a reorder request actually produces.
 *
 * Requested slugs that are not pinned are ignored; pinned slugs the request
 * omits keep their relative order at the end. So a stale tab reordering three
 * of four pins cannot delete the fourth, and cannot re-add one it still shows.
 */
export function applyOrder(
  pinned: readonly string[],
  requested: readonly string[],
): string[] {
  const known = new Set(pinned)
  const placed = new Set<string>()
  const ordered: string[] = []

  for (const slug of requested) {
    if (known.has(slug) && !placed.has(slug)) {
      ordered.push(slug)
      placed.add(slug)
    }
  }
  for (const slug of pinned) {
    if (!placed.has(slug)) ordered.push(slug)
  }
  return ordered
}

/**
 * One step up or down, for the reorder arrows.
 *
 * A move off either end is a no-op rather than a wrap: an arrow that teleports
 * the top item to the bottom is a bug report, not a feature.
 */
export function move(
  slugs: readonly string[],
  slug: string,
  delta: -1 | 1,
): string[] {
  const from = slugs.indexOf(slug)
  if (from < 0) return [...slugs]

  const to = from + delta
  if (to < 0 || to >= slugs.length) return [...slugs]

  const next = [...slugs]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next
}
