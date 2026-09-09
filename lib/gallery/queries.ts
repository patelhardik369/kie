import 'server-only'

import { and, asc, count, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'

import { assets, generations, getDb, type Asset, type Generation } from '../db/index.ts'
import { statesFor, type GalleryFilter } from './filters.ts'

/**
 * Reads for the gallery.
 *
 * Server-only. Every query here is driven by a `GalleryFilter` parsed from the
 * URL, so what the grid shows is always a function of the address bar.
 *
 * One rule shapes the shape of these results: **a generation with no assets is
 * still a row.** Failed, stalled and running generations join to zero assets,
 * and an inner join would silently drop exactly the ones worth seeing.
 */

export interface GalleryItem {
  generation: Generation
  /** The first downloaded output, for the tile. Absent while running or failed. */
  thumbnail?: Asset
  /** Total outputs, so a tile can say "1 of 4". */
  assetCount: number
}

export interface GalleryPage {
  items: GalleryItem[]
  total: number
  page: number
  pageSize: number
  pageCount: number
}

/**
 * Translates a filter into a WHERE clause.
 *
 * The workspace clause is added first and unconditionally, before anything the
 * URL can influence. It is not a filter — it is the boundary of what exists as
 * far as this caller is concerned, and nothing parsed from a query string is
 * allowed to widen it.
 */
function whereFor(workspaceId: string, filter: GalleryFilter): SQL | undefined {
  const clauses: SQL[] = [eq(generations.workspaceId, workspaceId)]

  if (filter.family) clauses.push(eq(generations.family, filter.family))
  if (filter.capability) clauses.push(eq(generations.capability, filter.capability))
  if (filter.model) clauses.push(eq(generations.modelSlug, filter.model))
  if (filter.favorite) clauses.push(eq(generations.favorite, true))
  // Unconditional, and the one clause with no "any" option: without an explicit
  // ?nsfw=1 the grid shows unmarked generations only. A filter that could be
  // widened to "everything" would put marked work back into an ordinary browse.
  clauses.push(eq(generations.nsfw, filter.nsfw === true))

  const states = statesFor(filter)
  if (states) clauses.push(inArray(generations.state, [...states]))

  if (filter.createdFrom !== undefined) {
    clauses.push(gte(generations.createdAt, filter.createdFrom))
  }
  if (filter.createdTo !== undefined) {
    clauses.push(lte(generations.createdAt, filter.createdTo))
  }

  if (filter.search) {
    // Searched against the stored input_json rather than a denormalized prompt
    // column: the prompt field is named differently across families, and
    // input_json is the one place guaranteed to hold whatever was sent.
    const term = `%${escapeLike(filter.search)}%`
    const match = or(
      likeLiteral(generations.inputJson, term),
      likeLiteral(generations.modelSlug, term),
      likeLiteral(generations.notes, term),
    )
    if (match) clauses.push(match)
  }

  return and(...clauses)
}

/** LIKE treats these as wildcards; a literal search for them must still work. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * LIKE with an explicit ESCAPE clause.
 *
 * Neither SQLite nor Postgres assumes an escape character, so without this the
 * backslashes added by `escapeLike` are matched as literal backslashes — and a
 * search for "100%" quietly returns nothing instead of the row containing it.
 */
function likeLiteral(column: AnyColumn, pattern: string): SQL {
  return sql`${column} LIKE ${pattern} ESCAPE '\\'`
}

/**
 * One page of the grid, newest first.
 *
 * Assets are fetched in a second query keyed on the page's ids, rather than as
 * a join. A join would multiply generation rows by their asset count and make
 * both the page size and the total wrong.
 */
export async function listGenerations(
  workspaceId: string,
  filter: GalleryFilter,
): Promise<GalleryPage> {
  const db = getDb()
  const where = whereFor(workspaceId, filter)

  const [{ total }] = await db
    .select({ total: count() })
    .from(generations)
    .where(where)

  const rows = await db
    .select()
    .from(generations)
    .where(where)
    .orderBy(desc(generations.createdAt), desc(generations.id))
    .limit(filter.pageSize)
    .offset((filter.page - 1) * filter.pageSize)

  const byGeneration = await assetsFor(rows.map((r) => r.id))

  return {
    items: rows.map((generation) => {
      const owned = byGeneration.get(generation.id) ?? []
      return {
        generation,
        thumbnail: owned[0],
        assetCount: owned.length,
      }
    }),
    total: total ?? 0,
    page: filter.page,
    pageSize: filter.pageSize,
    pageCount: Math.max(1, Math.ceil((total ?? 0) / filter.pageSize)),
  }
}

async function assetsFor(ids: string[]): Promise<Map<string, Asset[]>> {
  const byGeneration = new Map<string, Asset[]>()
  if (ids.length === 0) return byGeneration

  const rows = await getDb()
    .select()
    .from(assets)
    .where(inArray(assets.generationId, ids))
    .orderBy(asc(assets.idx))

  for (const asset of rows) {
    const list = byGeneration.get(asset.generationId)
    if (list) list.push(asset)
    else byGeneration.set(asset.generationId, [asset])
  }
  return byGeneration
}

export interface GenerationDetail {
  generation: Generation
  assets: Asset[]
  /** What this was re-run or tweaked from. */
  parent?: Generation
  /** Everything re-run or tweaked from this one. */
  children: Generation[]
  /** The other runs of the same sweep, this one excluded. */
  siblings: Generation[]
}

/**
 * A generation with everything needed to understand where it came from.
 *
 * Lineage is one hop in each direction, deliberately: the detail view answers
 * "what produced this, and what came of it", and a full ancestry walk would be
 * a graph nobody reads.
 */
export async function getGenerationDetail(
  workspaceId: string,
  id: string,
): Promise<GenerationDetail | undefined> {
  const db = getDb()

  const [generation] = await db
    .select()
    .from(generations)
    .where(and(eq(generations.id, id), eq(generations.workspaceId, workspaceId)))
    .limit(1)

  if (!generation) return undefined

  const [ownAssets, children, parentRows, siblings] = await Promise.all([
    db.select().from(assets).where(eq(assets.generationId, id)).orderBy(asc(assets.idx)),
    db
      .select()
      .from(generations)
      .where(and(eq(generations.parentId, id), eq(generations.workspaceId, workspaceId)))
      .orderBy(desc(generations.createdAt)),
    generation.parentId
      ? db
          .select()
          .from(generations)
          .where(
            and(
              eq(generations.id, generation.parentId),
              eq(generations.workspaceId, workspaceId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
    generation.batchId
      ? db
          .select()
          .from(generations)
          .where(
            and(
              eq(generations.batchId, generation.batchId),
              eq(generations.workspaceId, workspaceId),
            ),
          )
          .orderBy(asc(generations.createdAt))
      : Promise.resolve([]),
  ])

  return {
    generation,
    assets: ownAssets,
    parent: parentRows[0],
    children,
    siblings: siblings.filter((s) => s.id !== id),
  }
}

export interface Facet<T extends string = string> {
  value: T
  count: number
}

export interface GalleryFacets {
  families: Facet[]
  capabilities: Facet[]
  models: Facet[]
  states: Facet[]
  total: number
  favorites: number
  /** How many are marked private. The count is visible; the rows are not. */
  nsfw: number
}

/**
 * Counts for the filter bar.
 *
 * Computed over the WHOLE library, not the current filter: a facet count that
 * reacts to the filter it belongs to can only ever read as its own selection,
 * and a count of zero next to an option is more useful than hiding it.
 */
export async function getGalleryFacets(workspaceId: string): Promise<GalleryFacets> {
  const db = getDb()
  const mine = eq(generations.workspaceId, workspaceId)

  const [families, capabilities, models, states, totals] = await Promise.all([
    db
      .select({ value: generations.family, count: count() })
      .from(generations)
      .where(mine)
      .groupBy(generations.family),
    db
      .select({ value: generations.capability, count: count() })
      .from(generations)
      .where(mine)
      .groupBy(generations.capability),
    db
      .select({ value: generations.modelSlug, count: count() })
      .from(generations)
      .where(mine)
      .groupBy(generations.modelSlug)
      .orderBy(desc(count())),
    db
      .select({ value: generations.state, count: count() })
      .from(generations)
      .where(mine)
      .groupBy(generations.state),
    db
      .select({
        total: count(),
        favorites: sql<number>`sum(case when ${generations.favorite} then 1 else 0 end)`,
        nsfw: sql<number>`sum(case when ${generations.nsfw} then 1 else 0 end)`,
      })
      .from(generations)
      .where(mine),
  ])

  return {
    families,
    capabilities,
    models,
    states,
    total: totals[0]?.total ?? 0,
    favorites: Number(totals[0]?.favorites ?? 0),
    nsfw: Number(totals[0]?.nsfw ?? 0),
  }
}

/**
 * The most recent generations, for the home screen's queue.
 *
 * Never includes anything marked private. The home page is the one screen you
 * do not choose to look at — it is what loads when someone else is watching the
 * screen — so this is the surface where the exclusion matters most.
 */
export async function recentGenerations(
  workspaceId: string,
  limit = 8,
): Promise<GalleryItem[]> {
  const rows = await getDb()
    .select()
    .from(generations)
    .where(and(eq(generations.workspaceId, workspaceId), eq(generations.nsfw, false)))
    .orderBy(desc(generations.createdAt))
    .limit(limit)

  const byGeneration = await assetsFor(rows.map((r) => r.id))
  return rows.map((generation) => {
    const owned = byGeneration.get(generation.id) ?? []
    return { generation, thumbnail: owned[0], assetCount: owned.length }
  })
}
