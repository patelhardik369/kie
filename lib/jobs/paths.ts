/**
 * Where a downloaded output lands on disk.
 *
 * Pure module — path math only, no fs, no env — so it is unit-testable and
 * usable from both the downloader and the asset-serving route.
 *
 *   KIE_OUTPUT_DIR/YYYY-MM-DD/<family>/<model-slug-safe>/<generationId>-<n>.<ext>
 *
 * Dated so the folder stays navigable, model-named so a file is identifiable
 * outside the app, generation-id'd so a file always maps back to its parameters.
 */

import path from 'node:path'

/** Fallback extensions when a result URL carries none. */
export const EXTENSION_BY_KIND = {
  image: 'png',
  video: 'mp4',
  audio: 'mp3',
} as const

export type AssetKind = keyof typeof EXTENSION_BY_KIND

/**
 * Makes one path segment safe on Windows as well as POSIX.
 *
 * Model slugs contain `/` (`kling-3.0-omni/text-to-video`) and dots that must
 * survive (`seedance-1.5-pro`), so separators collapse to `-` and the dots stay.
 */
export function safeSegment(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\s]+/g, '-')
    .replace(/-{2,}/g, '-')
    // Windows rejects a trailing dot or space on a path segment.
    .replace(/^[-.]+|[-.]+$/g, '')
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'unnamed'
}

/** Local-time YYYY-MM-DD. Local, not UTC: the folder is browsed by a human. */
export function dateSegment(at: Date | number = Date.now()): string {
  const d = at instanceof Date ? at : new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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

export interface OutputPathParams {
  generationId: string
  family: string
  modelSlug: string
  /** Ordinal within the generation — a model may return several files. */
  index: number
  url: string
  kind: AssetKind
  at?: Date | number
}

/**
 * The path of one output, RELATIVE to KIE_OUTPUT_DIR.
 *
 * Relative on purpose: `assets.local_path` never stores an absolute path, so the
 * output folder can be moved without rewriting the database.
 */
export function outputRelativePath(params: OutputPathParams): string {
  const { generationId, family, modelSlug, index, url, kind, at } = params
  const ext = extensionFromUrl(url) ?? EXTENSION_BY_KIND[kind]

  return [
    dateSegment(at),
    safeSegment(family),
    safeSegment(modelSlug),
    `${safeSegment(generationId)}-${index}.${ext}`,
  ].join('/')
}

/** Where an uploaded INPUT file is cached, relative to KIE_OUTPUT_DIR. */
export function inputRelativePath(sha256: string, ext?: string): string {
  const suffix = ext && /^[a-z0-9]{1,5}$/.test(ext) ? `.${ext}` : ''
  return `_inputs/${safeSegment(sha256)}${suffix}`
}

/**
 * Resolves a relative path inside `baseDir`, or null if it escapes.
 *
 * The guard for `app/api/assets/[...path]`, which serves files by a path that
 * arrives from the browser. `..`, an absolute path, and a Windows drive letter
 * all resolve outside the base and are rejected.
 */
export function resolveWithin(baseDir: string, relative: string): string | null {
  const base = path.resolve(baseDir)
  const target = path.resolve(base, relative)

  if (target === base) return null
  const prefix = base.endsWith(path.sep) ? base : base + path.sep
  return target.startsWith(prefix) ? target : null
}
