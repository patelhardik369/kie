import assert from 'node:assert/strict'
import path from 'node:path'
import { describe, it } from 'node:test'

import {
  dateSegment,
  extensionFromUrl,
  inputRelativePath,
  outputRelativePath,
  resolveWithin,
  safeSegment,
} from './paths.ts'

describe('safeSegment', () => {
  it('collapses the slash inside a model slug', () => {
    assert.equal(safeSegment('kling-3.0-omni/text-to-video'), 'kling-3.0-omni-text-to-video')
  })

  it('keeps the dots that distinguish model versions', () => {
    assert.equal(safeSegment('bytedance/seedance-1.5-pro'), 'bytedance-seedance-1.5-pro')
  })

  it('removes characters Windows rejects in a filename', () => {
    assert.equal(safeSegment('a<b>c:d"e|f?g*h'), 'a-b-c-d-e-f-g-h')
  })

  it('strips a trailing dot, which Windows will not store', () => {
    assert.equal(safeSegment('name.'), 'name')
  })

  it('never returns an empty segment', () => {
    assert.equal(safeSegment('///'), 'unnamed')
    assert.equal(safeSegment(''), 'unnamed')
  })
})

describe('extensionFromUrl', () => {
  it('ignores the query string Kie signs its URLs with', () => {
    assert.equal(
      extensionFromUrl('https://cdn.kie.ai/out/abc.mp4?X-Amz-Signature=deadbeef'),
      'mp4',
    )
  })

  it('lowercases', () => {
    assert.equal(extensionFromUrl('https://cdn.kie.ai/a.PNG'), 'png')
  })

  it('returns undefined rather than guessing when there is no extension', () => {
    assert.equal(extensionFromUrl('https://cdn.kie.ai/out/abc'), undefined)
    assert.equal(extensionFromUrl('https://cdn.kie.ai/v1.2/file'), undefined)
  })

  it('rejects a long tail that is not really an extension', () => {
    assert.equal(extensionFromUrl('https://cdn.kie.ai/a.somethinglong'), undefined)
  })
})

describe('outputRelativePath', () => {
  const base = {
    generationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    family: 'kling',
    modelSlug: 'kling-3.0-omni/text-to-video',
    at: new Date(2026, 8, 1, 13, 30),
  }

  it('lays out date / family / model / generation-index', () => {
    assert.equal(
      outputRelativePath({
        ...base,
        index: 0,
        url: 'https://cdn.kie.ai/x.mp4',
        kind: 'video',
      }),
      '2026-09-01/kling/kling-3.0-omni-text-to-video/' +
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-0.mp4',
    )
  })

  it('numbers each output of a multi-file generation', () => {
    const second = outputRelativePath({
      ...base,
      index: 3,
      url: 'https://cdn.kie.ai/x.png',
      kind: 'image',
    })
    assert.ok(second.endsWith('-3.png'))
  })

  it('falls back to the kind when the URL carries no extension', () => {
    assert.ok(
      outputRelativePath({
        ...base,
        index: 0,
        url: 'https://cdn.kie.ai/opaque-id',
        kind: 'video',
      }).endsWith('.mp4'),
    )
  })

  it('stays relative — assets.local_path is never absolute', () => {
    const relative = outputRelativePath({
      ...base,
      index: 0,
      url: 'https://cdn.kie.ai/x.mp4',
      kind: 'video',
    })
    assert.equal(path.isAbsolute(relative), false)
    assert.ok(!relative.includes('\\'))
  })
})

describe('dateSegment', () => {
  it('zero-pads to YYYY-MM-DD', () => {
    assert.equal(dateSegment(new Date(2026, 0, 5)), '2026-01-05')
  })
})

describe('inputRelativePath', () => {
  it('names an input by its hash, under _inputs', () => {
    assert.equal(inputRelativePath('abc123', 'png'), '_inputs/abc123.png')
  })

  it('omits an implausible extension rather than trusting it', () => {
    assert.equal(inputRelativePath('abc123', 'not-an-extension'), '_inputs/abc123')
    assert.equal(inputRelativePath('abc123'), '_inputs/abc123')
  })
})

describe('resolveWithin', () => {
  const base = path.resolve('C:/outputs')

  it('resolves an ordinary relative path', () => {
    assert.equal(
      resolveWithin(base, '2026-09-01/kling/model/gen-0.mp4'),
      path.join(base, '2026-09-01', 'kling', 'model', 'gen-0.mp4'),
    )
  })

  it('rejects traversal out of the output directory', () => {
    assert.equal(resolveWithin(base, '../secrets.env'), null)
    assert.equal(resolveWithin(base, 'a/../../secrets.env'), null)
  })

  it('rejects an absolute path', () => {
    assert.equal(resolveWithin(base, path.resolve('C:/windows/system32/config')), null)
  })

  it('rejects the base directory itself', () => {
    assert.equal(resolveWithin(base, '.'), null)
    assert.equal(resolveWithin(base, ''), null)
  })

  it('rejects a sibling whose name merely starts with the base', () => {
    assert.equal(resolveWithin(base, '../outputs-other/file.mp4'), null)
  })
})
