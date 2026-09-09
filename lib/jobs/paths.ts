/**
 * Where a downloaded output lands in the bucket.
 *
 * Pure module — string math only, no I/O, no env — so it is unit-testable and
 * usable from the downloader, the uploader and the asset-serving route alike.
 *
 *   <workspaceId>/YYYY-MM-DD/<family>/<model-slug-safe>/<generationId>-<n>.<ext>
 *
 * Workspace-first, because that prefix is the only thing separating one
 * browser's files from another's in a bucket the server opens with a key that
 * can read all of it (see lib/storage/objects.ts). Dated so the bucket stays
 * navigable in the Supabase dashboard, model-named so a file is identifiable
 * once downloaded, generation-id'd so a file always maps back to its parameters.
 */

/** Fallback extensions when a result URL carries none. */
export const EXTENSION_BY_KIND = {
  image: 'png',
  video: 'mp4',
  audio: 'mp3',
} as const

export type AssetKind = keyof typeof EXTENSION_BY_KIND

/**
 * Makes one key segment safe.
 *
 * Model slugs contain `/` (`kling-3.0-omni/text-to-video`) and dots that must
 * survive (`seedance-1.5-pro`), so separators collapse to `-` and the dots stay.
 *
 * The Windows-hostile characters are still stripped even though the destination
 * is object storage rather than a filesystem: these names end up as download
 * filenames on someone's machine, and a `?` in one is a file they cannot save.
 */
export function safeSegment(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\s]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'unnamed'
}

/**
 * UTC YYYY-MM-DD.
 *
 * UTC, where the local build used local time: the folder is now read by a server
 * whose timezone is not the viewer's, and a key that depends on where the
 * request came from would put two files from one afternoon in two different
 * folders.
 */
export function dateSegment(at: Date | number = Date.now()): string {
  const d = at instanceof Date ? at : new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/**
 * The extension a result URL implies, without its query string.
 *
 * Returns undefined rather than guessing when the URL has no usable extension —
 * the caller falls back to the asset kind.
 */
export function extensionFromUrl(url: string): string | undefined {
  const withoutQuery = url.split(/[?#]/)[0] ?? ''
  const base = withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot < 1) return undefined

  const ext = base.slice(dot + 1).toLowerCase()
  // Anything longer or non-alphanumeric is a path artifact, not an extension.
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : undefined
}

export interface OutputKeyParams {
  workspaceId: string
  generationId: string
  family: string
  modelSlug: string
  /** Ordinal within the generation — a model may return several files. */
  index: number
  url: string
  kind: AssetKind
  at?: Date | number
}

/** The object key of one output. */
export function outputObjectKey(params: OutputKeyParams): string {
  const { workspaceId, generationId, family, modelSlug, index, url, kind, at } = params
  const ext = extensionFromUrl(url) ?? EXTENSION_BY_KIND[kind]

  return [
    safeSegment(workspaceId),
    dateSegment(at),
    safeSegment(family),
    safeSegment(modelSlug),
    `${safeSegment(generationId)}-${index}.${ext}`,
  ].join('/')
}

/** Where an uploaded INPUT file is cached. Content-addressed, so re-adds collide. */
export function inputObjectKey(
  workspaceId: string,
  sha256: string,
  ext?: string,
): string {
  const suffix = ext && /^[a-z0-9]{1,5}$/.test(ext) ? `.${ext}` : ''
  return `${safeSegment(workspaceId)}/_inputs/${safeSegment(sha256)}${suffix}`
}

/** The filename a browser should save an object as. */
export function downloadName(key: string): string {
  return key.slice(key.lastIndexOf('/') + 1) || 'download'
}
