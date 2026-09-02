import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { inferAssetKind, parseResultJson } from './result.ts'

describe('parseResultJson', () => {
  it('parses the JSON-encoded string Kie actually returns', () => {
    // The trap: resultJson is a string, not an object.
    const raw = JSON.stringify({
      resultUrls: ['https://cdn.example/a.mp4'],
    })
    assert.deepEqual(parseResultJson(raw).urls, ['https://cdn.example/a.mp4'])
  })

  it('returns empty for the non-terminal states', () => {
    for (const value of [null, undefined, '']) {
      assert.deepEqual(parseResultJson(value), { urls: [] })
    }
  })

  it('does not throw on malformed JSON', () => {
    // A poll loop must survive a garbage payload rather than die mid-generation.
    assert.deepEqual(parseResultJson('{not json').urls, [])
    assert.deepEqual(parseResultJson('null').urls, [])
    assert.deepEqual(parseResultJson('[]').urls, [])
    assert.deepEqual(parseResultJson(42).urls, [])
  })

  it('accepts an already-parsed object', () => {
    const parsed = parseResultJson({ resultUrls: ['https://cdn.example/a.png'] })
    assert.deepEqual(parsed.urls, ['https://cdn.example/a.png'])
  })

  it('keeps multiple urls in order for multi-image models', () => {
    const raw = JSON.stringify({
      resultUrls: ['https://x/1.png', 'https://x/2.png', 'https://x/3.png'],
    })
    assert.deepEqual(parseResultJson(raw).urls, [
      'https://x/1.png',
      'https://x/2.png',
      'https://x/3.png',
    ])
  })

  it('exposes resultObject for structured output', () => {
    const raw = JSON.stringify({ resultObject: { subject_status: 1 } })
    const parsed = parseResultJson(raw)
    assert.deepEqual(parsed.object, { subject_status: 1 })
    assert.deepEqual(parsed.urls, [])
  })

  it('preserves layer metadata for seedream/5-pro-layer-decomposition', () => {
    // Reading only resultUrls would discard z-ordering and layer names.
    const raw = JSON.stringify({
      resultObject: {
        layers_data: [
          {
            z_index: 0,
            name: 'background',
            url: 'https://x/bg.png',
            bounding_box: { absolute: [0, 0, 100, 100] },
          },
          { z_index: 1, name: 'subject', url: 'https://x/subject.png' },
        ],
      },
      resultUrls: ['https://x/bg.png', 'https://x/subject.png'],
    })

    const parsed = parseResultJson(raw)
    assert.equal(parsed.layers?.length, 2)
    assert.equal(parsed.layers?.[0]?.name, 'background')
    assert.equal(parsed.layers?.[1]?.z_index, 1)
    // Deduped — resultUrls repeats the layer urls without the ordering.
    assert.deepEqual(parsed.urls, ['https://x/bg.png', 'https://x/subject.png'])
  })

  it('drops non-string and empty url entries', () => {
    const raw = JSON.stringify({ resultUrls: ['https://x/a.png', '', null, 7] })
    assert.deepEqual(parseResultJson(raw).urls, ['https://x/a.png'])
  })
})

describe('inferAssetKind', () => {
  it('classifies by extension', () => {
    assert.equal(inferAssetKind('https://x/a.mp4'), 'video')
    assert.equal(inferAssetKind('https://x/a.mov'), 'video')
    assert.equal(inferAssetKind('https://x/a.mp3'), 'audio')
    assert.equal(inferAssetKind('https://x/a.wav'), 'audio')
    assert.equal(inferAssetKind('https://x/a.png'), 'image')
    assert.equal(inferAssetKind('https://x/a.webp'), 'image')
  })

  it('ignores query strings', () => {
    assert.equal(inferAssetKind('https://x/a.mp4?sig=abc.png'), 'video')
  })
})
