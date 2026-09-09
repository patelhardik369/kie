import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  dateSegment,
  downloadName,
  extensionFromUrl,
  inputObjectKey,
  outputObjectKey,
  safeSegment,
} from './paths.ts'

const WORKSPACE = 'wk_0123456789abcdef0123456789abcdef'

describe('safeSegment', () => {
  it('collapses the slash inside a model slug', () => {
    assert.equal(safeSegment('kling-3.0-omni/text-to-video'), 'kling-3.0-omni-text-to-video')
  })

  it('keeps the dots that distinguish model versions', () => {
    assert.equal(safeSegment('bytedance/seedance-1.5-pro'), 'bytedance-seedance-1.5-pro')
  })

  it('removes characters that break a saved filename', () => {
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

describe('outputObjectKey', () => {
  const base = {
    workspaceId: WORKSPACE,
    generationId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    family: 'kling',
    modelSlug: 'kling-3.0-omni/text-to-video',
    // Noon UTC, so the date segment cannot drift across a timezone boundary and
    // make this assertion depend on where the test runs.
    at: Date.UTC(2026, 8, 1, 12, 0),
  }

  it('lays out workspace / date / family / model / generation-index', () => {
    assert.equal(
      outputObjectKey({
        ...base,
        index: 0,
        url: 'https://cdn.kie.ai/x.mp4',
        kind: 'video',
      }),
      `${WORKSPACE}/2026-09-01/kling/kling-3.0-omni-text-to-video/` +
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-0.mp4',
    )
  })

  it('numbers each output of a multi-file generation', () => {
    const second = outputObjectKey({
      ...base,
      index: 3,
      url: 'https://cdn.kie.ai/x.png',
      kind: 'image',
    })
    assert.ok(second.endsWith('-3.png'))
  })

  it('falls back to the kind when the URL carries no extension', () => {
    assert.ok(
      outputObjectKey({
        ...base,
        index: 0,
        url: 'https://cdn.kie.ai/opaque-id',
        kind: 'video',
      }).endsWith('.mp4'),
    )
  })

  /**
   * The workspace prefix is the ONLY thing separating one browser's objects from
   * another's in a bucket the server opens with a key that can read all of it.
   * If this assertion ever fails, isolation is gone.
   */
  it('always begins with the owning workspace', () => {
    const key = outputObjectKey({
      ...base,
      index: 0,
      url: 'https://cdn.kie.ai/x.mp4',
      kind: 'video',
    })
    assert.ok(key.startsWith(`${WORKSPACE}/`))
    assert.ok(!key.includes('\\'))
    assert.ok(!key.startsWith('/'))
  })
})

describe('dateSegment', () => {
  it('zero-pads to YYYY-MM-DD', () => {
    assert.equal(dateSegment(Date.UTC(2026, 0, 5, 12)), '2026-01-05')
  })

  it('is UTC, so a key does not depend on the server it was minted on', () => {
    // 23:30 UTC on the 5th is already the 6th in Asia/Kolkata. A local-time
    // segment would file the same generation under two different days depending
    // on which region the function happened to run in.
    assert.equal(dateSegment(Date.UTC(2026, 0, 5, 23, 30)), '2026-01-05')
  })
})

describe('inputObjectKey', () => {
  it('names an input by its hash, under the workspace', () => {
    assert.equal(
      inputObjectKey(WORKSPACE, 'abc123', 'png'),
      `${WORKSPACE}/_inputs/abc123.png`,
    )
  })

  it('omits an implausible extension rather than trusting it', () => {
    assert.equal(
      inputObjectKey(WORKSPACE, 'abc123', 'not-an-extension'),
      `${WORKSPACE}/_inputs/abc123`,
    )
    assert.equal(inputObjectKey(WORKSPACE, 'abc123'), `${WORKSPACE}/_inputs/abc123`)
  })
})

describe('downloadName', () => {
  it('is the last segment of the key', () => {
    assert.equal(downloadName(`${WORKSPACE}/2026-09-01/kling/m/gen-0.mp4`), 'gen-0.mp4')
  })

  it('never returns an empty name', () => {
    assert.equal(downloadName('trailing/'), 'download')
  })
})
