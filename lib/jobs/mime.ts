/**
 * Extension to MIME mapping.
 *
 * Pure module. Used twice: as the downloader's fallback when Kie's CDN omits or
 * generalizes `Content-Type`, and by the asset route, which serves files off
 * disk where the extension is all there is to go on.
 */

const MIME_BY_EXTENSION: Record<string, string> = {
  // image
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  tiff: 'image/tiff',
  // video
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  // audio
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac',
  // other
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
}

export function mimeForExtension(ext: string | undefined): string {
  if (!ext) return 'application/octet-stream'
  return MIME_BY_EXTENSION[ext.toLowerCase()] ?? 'application/octet-stream'
}

/** The extension a MIME type implies, for naming a browser-uploaded file. */
export function extensionForMime(mime: string | undefined): string | undefined {
  if (!mime) return undefined
  const bare = mime.split(';')[0]!.trim().toLowerCase()
  for (const [ext, value] of Object.entries(MIME_BY_EXTENSION)) {
    if (value.split(';')[0] === bare) return ext
  }
  return undefined
}

/** The `assets.kind` bucket a MIME type belongs to. */
export function kindForMime(mime: string | undefined): 'image' | 'video' | 'audio' | undefined {
  if (!mime) return undefined
  const bare = mime.split('/')[0]?.toLowerCase()
  if (bare === 'image' || bare === 'video' || bare === 'audio') return bare
  return undefined
}
