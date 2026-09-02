import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { mergeProbes, probeBuffer } from './probe.ts'

/**
 * Synthetic headers, built to the container specs. Each builder writes only the
 * fields the probe reads, which is also the clearest statement of what those
 * offsets are.
 */

function buffer(size: number): Uint8Array {
  return new Uint8Array(size)
}

function writeU16BE(b: Uint8Array, at: number, value: number) {
  b[at] = (value >> 8) & 0xff
  b[at + 1] = value & 0xff
}

function writeU16LE(b: Uint8Array, at: number, value: number) {
  b[at] = value & 0xff
  b[at + 1] = (value >> 8) & 0xff
}

function writeU24LE(b: Uint8Array, at: number, value: number) {
  b[at] = value & 0xff
  b[at + 1] = (value >> 8) & 0xff
  b[at + 2] = (value >> 16) & 0xff
}

function writeU32BE(b: Uint8Array, at: number, value: number) {
  b[at] = (value >>> 24) & 0xff
  b[at + 1] = (value >>> 16) & 0xff
  b[at + 2] = (value >>> 8) & 0xff
  b[at + 3] = value & 0xff
}

function writeAscii(b: Uint8Array, at: number, text: string) {
  for (let i = 0; i < text.length; i++) b[at + i] = text.charCodeAt(i)
}

function png(width: number, height: number): Uint8Array {
  const b = buffer(64)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  writeU32BE(b, 8, 13)
  writeAscii(b, 12, 'IHDR')
  writeU32BE(b, 16, width)
  writeU32BE(b, 20, height)
  return b
}

function jpeg(width: number, height: number, { withApp0 = true } = {}): Uint8Array {
  const b = buffer(64)
  b.set([0xff, 0xd8], 0)
  let pos = 2

  if (withApp0) {
    // An APP0 segment the walker has to skip over to reach the frame header.
    b.set([0xff, 0xe0], pos)
    writeU16BE(b, pos + 2, 16)
    pos += 18
  }

  b.set([0xff, 0xc0], pos)
  writeU16BE(b, pos + 2, 17)
  b[pos + 4] = 8
  writeU16BE(b, pos + 5, height)
  writeU16BE(b, pos + 7, width)
  return b
}

function gif(width: number, height: number): Uint8Array {
  const b = buffer(32)
  writeAscii(b, 0, 'GIF89a')
  writeU16LE(b, 6, width)
  writeU16LE(b, 8, height)
  return b
}

function webpVp8x(width: number, height: number): Uint8Array {
  const b = buffer(64)
  writeAscii(b, 0, 'RIFF')
  writeAscii(b, 8, 'WEBP')
  writeAscii(b, 12, 'VP8X')
  // Canvas dimensions are stored minus one.
  writeU24LE(b, 24, width - 1)
  writeU24LE(b, 27, height - 1)
  return b
}

interface Mp4Options {
  timescale?: number
  duration?: number
  width?: number
  height?: number
  /** Puts the moov atom at the end, as a file not written faststart has it. */
  moovAtEnd?: boolean
}

function mp4(options: Mp4Options = {}): Uint8Array {
  const { timescale = 1000, duration = 5500, width = 1920, height = 1080 } = options
  const b = buffer(400)
  writeAscii(b, 4, 'ftyp')
  writeAscii(b, 8, 'isom')

  const moovAt = options.moovAtEnd ? 200 : 32
  writeAscii(b, moovAt, 'moov')

  const mvhdAt = moovAt + 8
  writeAscii(b, mvhdAt, 'mvhd')
  b[mvhdAt + 4] = 0 // version 0
  writeU32BE(b, mvhdAt + 16, timescale)
  writeU32BE(b, mvhdAt + 20, duration)

  const tkhdAt = mvhdAt + 40
  writeAscii(b, tkhdAt, 'tkhd')
  b[tkhdAt + 4] = 0 // version 0
  // 16.16 fixed point, so the integer part is the high half-word.
  writeU32BE(b, tkhdAt + 80, width << 16)
  writeU32BE(b, tkhdAt + 84, height << 16)

  return b
}

describe('probeBuffer — images', () => {
  it('reads PNG dimensions from IHDR', () => {
    assert.deepEqual(probeBuffer(png(1024, 768)), { width: 1024, height: 768 })
  })

  it('reads JPEG dimensions from the first SOF0', () => {
    assert.deepEqual(probeBuffer(jpeg(640, 480)), { width: 640, height: 480 })
  })

  it('walks past intervening JPEG segments to reach the frame header', () => {
    assert.deepEqual(probeBuffer(jpeg(800, 600, { withApp0: true })), {
      width: 800,
      height: 600,
    })
  })

  it('reads GIF dimensions, which are little-endian', () => {
    assert.deepEqual(probeBuffer(gif(320, 240)), { width: 320, height: 240 })
  })

  it('reads a VP8X WebP canvas, stored minus one', () => {
    assert.deepEqual(probeBuffer(webpVp8x(2048, 1152)), { width: 2048, height: 1152 })
  })
})

describe('probeBuffer — video', () => {
  it('derives duration from the mvhd timescale', () => {
    const probed = probeBuffer(mp4({ timescale: 1000, duration: 5500 }))
    assert.equal(probed.durationMs, 5500)
  })

  it('handles a non-millisecond timescale', () => {
    // 90kHz is the common MPEG timescale; 450000 ticks is 5 seconds.
    const probed = probeBuffer(mp4({ timescale: 90_000, duration: 450_000 }))
    assert.equal(probed.durationMs, 5000)
  })

  it('reads tkhd dimensions as 16.16 fixed point', () => {
    const probed = probeBuffer(mp4({ width: 1920, height: 1080 }))
    assert.equal(probed.width, 1920)
    assert.equal(probed.height, 1080)
  })

  it('finds a moov atom at the end of the file', () => {
    // The reason the downloader probes the tail as well as the head: a file not
    // written faststart keeps its metadata after the media data.
    const probed = probeBuffer(mp4({ moovAtEnd: true, duration: 12_000 }))
    assert.equal(probed.durationMs, 12_000)
  })
})

describe('probeBuffer — resilience', () => {
  it('returns nothing rather than throwing on a truncated file', () => {
    assert.deepEqual(probeBuffer(png(100, 100).slice(0, 18)), {})
  })

  it('returns nothing for an unrecognized container', () => {
    assert.deepEqual(probeBuffer(new Uint8Array(64).fill(0x7a)), {})
  })

  it('returns nothing for a buffer too small to hold any header', () => {
    assert.deepEqual(probeBuffer(new Uint8Array(4)), {})
  })

  it('treats the unknown-duration sentinel as unknown', () => {
    const probed = probeBuffer(mp4({ duration: 0xffffffff }))
    assert.equal(probed.durationMs, undefined)
  })
})

describe('mergeProbes', () => {
  it('combines dimensions from the head with duration from the tail', () => {
    assert.deepEqual(
      mergeProbes({ width: 1920, height: 1080 }, { durationMs: 8000 }),
      { width: 1920, height: 1080, durationMs: 8000 },
    )
  })

  it('prefers the first real value', () => {
    assert.deepEqual(mergeProbes({ width: 100 }, { width: 200 }), { width: 100 })
  })

  it('skips zeroes, which mean "absent" in these containers', () => {
    assert.deepEqual(mergeProbes({ width: 0 }, { width: 640 }), { width: 640 })
  })
})
