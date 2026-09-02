import {
  CAPABILITIES,
  FAMILIES,
  type Capability,
  type Family,
} from '../kie/registry/types.ts'
// Type-only: erased at runtime, so this module stays free of drizzle and safe
// to import from the client filter bar.
import type { GenerationState } from '../db/schema.ts'

/**
 * Gallery filter state, carried in the URL.
 *
 * Pure module — no env, no DB, no network — so the filter bar (a client
 * component) and the gallery page (a server component) can share one parser.
 *
 * The URL is the single source of truth for what the grid shows. That is what
 * makes a filtered view linkable, back-button-correct, and reloadable, and it
 * is why nothing here reads from component state.
 *
 * Every value is validated against the registry or the state list, and anything
 * unrecognized is DROPPED rather than passed through. A hand-edited `?state=xyz`
 * should show everything, not an empty grid that looks like data loss.
 */

/**
 * Mirrors `GENERATION_STATES` in the schema. Declared here rather than imported
 * so this module carries no runtime dependency on drizzle; `satisfies` proves
 * every member is a real state, and filters.test.ts proves none is missing.
 */
export const FILTERABLE_STATES = [
  'draft',
  'waiting',
  'queuing',
  'generating',
  'downloading',
  'complete',
  'failed',
  'needs_retry',
  'stalled',
  'orphaned',
] as const satisfies readonly GenerationState[]

/** The states worth one click, since "did anything break?" is the common question. */
export const STATE_GROUPS = {
  complete: ['complete'],
  running: ['waiting', 'queuing', 'generating', 'downloading'],
  // Everything that stopped short, recoverable or not — a failure you can read
  // is worth more than a clean grid (docs/UX-SPEC.md).
  problem: ['failed', 'needs_retry', 'stalled', 'orphaned'],
} as const satisfies Record<string, readonly GenerationState[]>

export type StateGroup = keyof typeof STATE_GROUPS

export const DEFAULT_PAGE_SIZE = 48
const MAX_PAGE_SIZE = 200

export interface GalleryFilter {
  family?: Family
  capability?: Capability
  /** Exact model slug. */
  model?: string
  /** A single state, or a named group of them. */
  state?: GenerationState
  stateGroup?: StateGroup
  favorite?: boolean
  /**
   * Show the generations marked private, and ONLY those.
   *
   * Deliberately not a "include them too" flag. Marked work stays out of every
   * ordinary browse — it appears when you go looking for it and at no other
   * time, which is the only version of this that cannot surprise someone.
   */
  nsfw?: boolean
  /** Free text, matched against the stored prompt and the model slug. */
  search?: string
  /** Inclusive epoch-ms bounds, from `YYYY-MM-DD` in the URL. */
  createdFrom?: number
  createdTo?: number
  /** 1-based. */
  page: number
  pageSize: number
}

/** What Next hands a server component as `searchParams`. */
export type RawParams =
  | URLSearchParams
  | Record<string, string | string[] | undefined>

function read(params: RawParams, key: string): string | undefined {
  const value =
    params instanceof URLSearchParams ? params.get(key) : params[key]
  const single = Array.isArray(value) ? value[0] : value
  const trimmed = single?.trim()
  return trimmed ? trimmed : undefined
}

function oneOf<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return value && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined
}

/** Midnight local time on a `YYYY-MM-DD`, or undefined. */
function startOfDay(value: string | undefined): number | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  const date = new Date(y, m - 1, d)
  // Rejects 2026-02-31 and friends, which Date would silently roll over.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return undefined
  }
  return date.getTime()
}

/** The last millisecond of a `YYYY-MM-DD`, so `to` is inclusive of that day. */
function endOfDay(value: string | undefined): number | undefined {
  const start = startOfDay(value)
  return start === undefined ? undefined : start + 24 * 60 * 60 * 1000 - 1
}

function positiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(Math.floor(parsed), max)
}

export function parseGalleryFilter(params: RawParams): GalleryFilter {
  const stateGroup = oneOf(
    read(params, 'state'),
    Object.keys(STATE_GROUPS) as StateGroup[],
  )

  return {
    family: oneOf(read(params, 'family'), FAMILIES),
    capability: oneOf(read(params, 'capability'), CAPABILITIES),
    model: read(params, 'model'),
    // `state` carries either a group name or one exact state; the group wins,
    // so the three common filters get short, memorable URLs.
    stateGroup,
    state: stateGroup ? undefined : oneOf(read(params, 'state'), FILTERABLE_STATES),
    favorite: read(params, 'favorite') === '1' ? true : undefined,
    nsfw: read(params, 'nsfw') === '1' ? true : undefined,
    search: read(params, 'q'),
    createdFrom: startOfDay(read(params, 'from')),
    createdTo: endOfDay(read(params, 'to')),
    page: positiveInt(read(params, 'page'), 1, 100_000),
    pageSize: positiveInt(read(params, 'pageSize'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  }
}

/** The states a filter selects, or undefined for "any". */
export function statesFor(filter: GalleryFilter): readonly GenerationState[] | undefined {
  if (filter.stateGroup) return STATE_GROUPS[filter.stateGroup]
  return filter.state ? [filter.state] : undefined
}

/** True when anything narrows the grid — drives the "Clear filters" affordance. */
export function isFilterActive(filter: GalleryFilter): boolean {
  return Boolean(
    filter.family ||
      filter.capability ||
      filter.model ||
      filter.state ||
      filter.stateGroup ||
      filter.favorite ||
      filter.nsfw ||
      filter.search ||
      filter.createdFrom !== undefined ||
      filter.createdTo !== undefined,
  )
}

/** `YYYY-MM-DD` for a date input, from an epoch-ms bound. */
export function toDateInput(at: number | undefined): string {
  if (at === undefined) return ''
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Back to a query string. Defaults are omitted, so an unfiltered gallery has a
 * clean `/gallery` URL rather than a row of empty parameters.
 */
export function serializeGalleryFilter(filter: Partial<GalleryFilter>): string {
  const params = new URLSearchParams()

  if (filter.family) params.set('family', filter.family)
  if (filter.capability) params.set('capability', filter.capability)
  if (filter.model) params.set('model', filter.model)
  if (filter.stateGroup) params.set('state', filter.stateGroup)
  else if (filter.state) params.set('state', filter.state)
  if (filter.favorite) params.set('favorite', '1')
  if (filter.nsfw) params.set('nsfw', '1')
  if (filter.search) params.set('q', filter.search)
  if (filter.createdFrom !== undefined) params.set('from', toDateInput(filter.createdFrom))
  if (filter.createdTo !== undefined) params.set('to', toDateInput(filter.createdTo))
  if (filter.page && filter.page > 1) params.set('page', String(filter.page))
  if (filter.pageSize && filter.pageSize !== DEFAULT_PAGE_SIZE) {
    params.set('pageSize', String(filter.pageSize))
  }

  return params.toString()
}

/** A gallery URL for a filter — `/gallery` when nothing is set. */
export function galleryHref(filter: Partial<GalleryFilter>): string {
  const query = serializeGalleryFilter(filter)
  return query ? `/gallery?${query}` : '/gallery'
}

/**
 * Changing any filter returns to page 1.
 *
 * Without this, narrowing a filter while on page 4 lands on an empty grid that
 * reads as "no results" when the results are simply on page 1.
 */
export function withFilter(
  filter: GalleryFilter,
  patch: Partial<GalleryFilter>,
): GalleryFilter {
  const next = { ...filter, ...patch }
  if (!('page' in patch)) next.page = 1
  return next
}
