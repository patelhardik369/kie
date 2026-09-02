/**
 * Parsing for `recordInfo`'s `resultJson`.
 *
 * Pure module — unit-testable, no env.
 *
 * The trap this file exists for: **`resultJson` is a JSON-encoded STRING**, not
 * an object, and it is `null` on every non-terminal state. Everything else here
 * is defensive handling of the shapes Kie actually returns.
 */

/** One layer from `seedream/5-pro-layer-decomposition`. */
export interface LayerData {
  z_index?: number
  size?: string
  output_format?: string
  bounding_box?: {
    absolute?: number[]
    normalized?: number[]
  }
  name?: string
  description?: string
  url: string
}

export interface ParsedResult {
  /** Every downloadable URL, deduped and in order. */
  urls: string[]
  /** `resultObject` when the model returns structured output. */
  object?: Record<string, unknown>
  /**
   * Layer metadata when present. Reading only `urls` would silently discard the
   * z-ordering and names that make layer decomposition useful.
   */
  layers?: LayerData[]
}

const EMPTY: ParsedResult = { urls: [] }

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0)
}

function extractLayers(object: Record<string, unknown> | undefined): LayerData[] | undefined {
  const raw = object?.layers_data
  if (!Array.isArray(raw)) return undefined

  const layers = raw
    .map(asRecord)
    .filter((l): l is Record<string, unknown> => Boolean(l))
    .filter((l) => typeof l.url === 'string' && l.url.length > 0)
    .map((l) => l as unknown as LayerData)

  return layers.length > 0 ? layers : undefined
}

/**
 * Parses `resultJson` into a uniform shape.
 *
 * Accepts a JSON string (the normal case), an already-parsed object (defensive —
 * some clients pre-parse), or null/undefined on non-terminal states.
 *
 * Never throws: malformed JSON yields an empty result rather than killing a poll
 * loop. Callers distinguish "no output" from "not finished" via task state.
 */
export function parseResultJson(raw: unknown): ParsedResult {
  if (raw === null || raw === undefined || raw === '') return EMPTY

  let parsed: unknown = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return EMPTY
    }
  }

  const root = asRecord(parsed)
  if (!root) return EMPTY

  const object = asRecord(root.resultObject)
  const layers = extractLayers(object)

  // Layer URLs come first: their order carries the z-ordering, and resultUrls
  // repeats them without it.
  const urls = dedupe([
    ...(layers?.map((l) => l.url) ?? []),
    ...asStringArray(root.resultUrls),
  ])

  const result: ParsedResult = { urls }
  if (object) result.object = object
  if (layers) result.layers = layers
  return result
}

function dedupe(urls: string[]): string[] {
  return [...new Set(urls)]
}

/** Best-effort media kind from a URL's extension, for the `assets.kind` column. */
export function inferAssetKind(url: string): 'image' | 'video' | 'audio' {
  const path = url.split('?')[0]?.toLowerCase() ?? ''
  const ext = path.slice(path.lastIndexOf('.') + 1)

  if (['mp4', 'mov', 'webm', 'mkv', 'm4v', 'avi'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma'].includes(ext)) return 'audio'
  return 'image'
}
