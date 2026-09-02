/**
 * Media dimensions and duration, read from container headers.
 *
 * Pure module — takes bytes, returns numbers, never throws — so it is
 * unit-testable and cannot break a download.
 *
 * WHY NOT ffprobe: it would be a external binary dependency for three nullable
 * columns. `assets.width` / `height` / `duration_ms` power the gallery's grid
 * layout (docs/DATA-MODEL.md); a header parse gets them for every format these
 * three families actually emit, and anything it cannot read stays null.
 *
 * Every reader is defensive by construction: a truncated or unexpected buffer
 * yields undefined, never an exception, because a probe failure must not turn a
 * successfully downloaded file into a failed generation.
 */

export interface Probed {
  width?: number
  height?: number
  durationMs?: number
}

const EMPTY: Probed = {}

function u16be(b: Uint8Array, at: number): number | undefined {
  if (at + 2 > b.length) return undefined
  return (b[at]! << 8) | b[at + 1]!
}

function u16le(b: Uint8Array, at: number): number | undefined {
  if (at + 2 > b.length) return undefined
  return b[at]! | (b[at + 1]! << 8)
}

function u24le(b: Uint8Array, at: number): number | undefined {
  if (at + 3 > b.length) return undefined
  return b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16)
}

function u32be(b: Uint8Array, at: number): number | undefined {
  if (at + 4 > b.length) return undefined
  // >>> 0 keeps the top bit from making this negative.
  return ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0
}

function u32le(b: Uint8Array, at: number): number | undefined {
  if (at + 4 > b.length) return undefined
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0
}

function u64be(b: Uint8Array, at: number): number | undefined {
  const hi = u32be(b, at)
  const lo = u32be(b, at + 4)
  if (hi === undefined || lo === undefined) return undefined
  const value = hi * 2 ** 32 + lo
  return Number.isSafeInteger(value) ? value : undefined
}

function ascii(b: Uint8Array, at: number, length: number): string {
  let out = ''
  for (let i = at; i < at + length && i < b.length; i++) out += String.fromCharCode(b[i]!)
  return out
}

function startsWith(b: Uint8Array, bytes: number[]): boolean {
  if (b.length < bytes.length) return false
  return bytes.every((byte, i) => b[i] === byte)
}

/** Byte offset of a four-character box type, or -1. */
function indexOfTag(b: Uint8Array, tag: string, from = 0): number {
  const t0 = tag.charCodeAt(0)
  for (let i = from; i + 4 <= b.length; i++) {
    if (
      b[i] === t0 &&
      b[i + 1] === tag.charCodeAt(1) &&
      b[i + 2] === tag.charCodeAt(2) &&
      b[i + 3] === tag.charCodeAt(3)
    ) {
      return i
    }
  }
  return -1
}

// ---------------------------------------------------------------- images

function probePng(b: Uint8Array): Probed {
  // 8-byte signature, then the IHDR chunk: length(4) type(4) width(4) height(4).
  if (ascii(b, 12, 4) !== 'IHDR') return EMPTY
  const width = u32be(b, 16)
  const height = u32be(b, 20)
  return width && height ? { width, height } : EMPTY
}

function probeJpeg(b: Uint8Array): Probed {
  // Walk the marker chain to the first Start-Of-Frame, which carries the size.
  let pos = 2
  while (pos + 9 < b.length) {
    if (b[pos] !== 0xff) {
      pos++
      continue
    }
    const marker = b[pos + 1]!
    // SOF0-SOF3, SOF5-SOF7, SOF9-SOF11, SOF13-SOF15. C4/C8/CC are not frames.
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isSof) {
      const height = u16be(b, pos + 5)
      const width = u16be(b, pos + 7)
      return width && height ? { width, height } : EMPTY
    }
    // Standalone markers (RSTn, SOI, EOI) carry no length field.
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01 || marker === 0xff) {
      pos += 2
      continue
    }
    const length = u16be(b, pos + 2)
    if (!length || length < 2) return EMPTY
    pos += 2 + length
  }
  return EMPTY
}

function probeGif(b: Uint8Array): Probed {
  const width = u16le(b, 6)
  const height = u16le(b, 8)
  return width && height ? { width, height } : EMPTY
}

function probeWebp(b: Uint8Array): Probed {
  const chunk = ascii(b, 12, 4)

  if (chunk === 'VP8X') {
    // Extended: 24-bit canvas dimensions, stored minus one.
    const w = u24le(b, 24)
    const h = u24le(b, 27)
    return w !== undefined && h !== undefined ? { width: w + 1, height: h + 1 } : EMPTY
  }

  if (chunk === 'VP8 ') {
    // Lossy: a 3-byte frame tag, a 3-byte start code, then 14-bit dimensions.
    const w = u16le(b, 26)
    const h = u16le(b, 28)
    return w !== undefined && h !== undefined
      ? { width: w & 0x3fff, height: h & 0x3fff }
      : EMPTY
  }

  if (chunk === 'VP8L') {
    // Lossless: a 0x2f signature, then 14 bits of width and 14 of height.
    if (b[20] !== 0x2f) return EMPTY
    const bits = u32le(b, 21)
    if (bits === undefined) return EMPTY
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }

  return EMPTY
}

// ---------------------------------------------------------------- video

/** `mvhd` carries the movie timescale and duration. */
function probeMp4Duration(b: Uint8Array): number | undefined {
  const at = indexOfTag(b, 'mvhd')
  if (at < 0) return undefined

  const version = b[at + 4]
  const timescale = version === 1 ? u32be(b, at + 24) : u32be(b, at + 16)
  const duration = version === 1 ? u64be(b, at + 28) : u32be(b, at + 20)

  if (!timescale || duration === undefined) return undefined
  // 0xFFFFFFFF is the documented "unknown duration" sentinel.
  if (version !== 1 && duration === 0xffffffff) return undefined
  return Math.round((duration / timescale) * 1000)
}

/**
 * `tkhd` carries per-track display dimensions as 16.16 fixed point.
 * Audio tracks report 0x0, so the first non-zero track wins.
 */
function probeMp4Dimensions(b: Uint8Array): Probed {
  let from = 0
  for (;;) {
    const at = indexOfTag(b, 'tkhd', from)
    if (at < 0) return EMPTY
    from = at + 4

    const version = b[at + 4]
    // From the version byte: version+flags (4), the fixed header (20 in v0, 32
    // in v1), an 8-byte reserve, layer/alt/volume/reserved (8), and the 36-byte
    // display matrix — then the 16.16 width and height.
    const sizeAt = at + 4 + (version === 1 ? 88 : 76)
    const w = u32be(b, sizeAt)
    const h = u32be(b, sizeAt + 4)
    if (w && h) return { width: w >> 16, height: h >> 16 }
  }
}

function probeMp4(b: Uint8Array): Probed {
  const durationMs = probeMp4Duration(b)
  const dims = probeMp4Dimensions(b)
  return { ...dims, ...(durationMs !== undefined ? { durationMs } : {}) }
}

/**
 * Reads what the container header exposes.
 *
 * `buffer` should be the file's head; for MP4 the caller should also pass the
 * tail, since `moov` sits at the end of a file that was not written faststart.
 */
export function probeBuffer(buffer: Uint8Array): Probed {
  try {
    if (buffer.length < 16) return EMPTY

    if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47])) return probePng(buffer)
    if (startsWith(buffer, [0xff, 0xd8])) return probeJpeg(buffer)
    if (ascii(buffer, 0, 3) === 'GIF') return probeGif(buffer)
    if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 4) === 'WEBP') {
      return probeWebp(buffer)
    }
    // ftyp identifies MP4/MOV/M4V; the box types are the same for all of them.
    if (ascii(buffer, 4, 4) === 'ftyp' || indexOfTag(buffer, 'moov') >= 0) {
      return probeMp4(buffer)
    }

    return EMPTY
  } catch {
    // A probe is a nice-to-have. Three null columns beat a failed download.
    return EMPTY
  }
}

/** Merges a head-of-file probe with a tail-of-file one, preferring real values. */
export function mergeProbes(...results: Probed[]): Probed {
  const merged: Probed = {}
  for (const result of results) {
    if (merged.width === undefined && result.width) merged.width = result.width
    if (merged.height === undefined && result.height) merged.height = result.height
    if (merged.durationMs === undefined && result.durationMs) {
      merged.durationMs = result.durationMs
    }
  }
  return merged
}
