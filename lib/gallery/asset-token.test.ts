import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.KIE_API_KEY = 'test-key-not-a-real-one'

const { assetToken, assetTokenFor, assetTokenMatches } = await import('./asset-token.ts')
const { assetHref } = await import('./display.ts')

const PATH = '2026-09-02/wan/wan-2-7-image/abc-0.png'

/**
 * The lock on `/api/assets` for a generation marked private.
 *
 * Hiding a generation from every listing is worth little while its bytes stay
 * one guessable URL away — the path is a date, a family, a model slug and an id.
 */
describe('asset capability tokens', () => {
  it('is stable for a path, so a link does not rot between renders', () => {
    // An expiring token would break a video mid-scrub and a tab left open
    // overnight, for no gain against the thing this defends: a pasted path.
    assert.equal(assetToken(PATH), assetToken(PATH))
  })

  it('is bound to the path it was minted for', () => {
    const other = '2026-09-02/wan/wan-2-7-image/abc-1.png'
    assert.notEqual(assetToken(PATH), assetToken(other))
    // The token for sibling output #1 must not unlock output #0.
    assert.equal(assetTokenMatches(PATH, assetToken(other)), false)
  })

  it('rejects a missing, empty, wrong or truncated token', () => {
    const good = assetToken(PATH)

    assert.equal(assetTokenMatches(PATH, undefined), false)
    assert.equal(assetTokenMatches(PATH, null), false)
    assert.equal(assetTokenMatches(PATH, ''), false)
    assert.equal(assetTokenMatches(PATH, 'not-a-token'), false)
    // A length mismatch must be a rejection, not the throw timingSafeEqual
    // raises when the buffers differ in size.
    assert.equal(assetTokenMatches(PATH, good.slice(0, -1)), false)
    assert.equal(assetTokenMatches(PATH, good + 'x'), false)

    assert.equal(assetTokenMatches(PATH, good), true)
  })

  it('is long enough that guessing is not a strategy', () => {
    // 128 bits, base64url.
    assert.ok(assetToken(PATH).length >= 21, assetToken(PATH))
    assert.match(assetToken(PATH), /^[A-Za-z0-9_-]+$/)
  })

  it('never leaks the API key it is derived from', () => {
    assert.equal(assetToken(PATH).includes('test-key'), false)
  })

  it('is minted only for private generations', () => {
    assert.equal(assetTokenFor(PATH, false), undefined)
    assert.equal(assetTokenFor(PATH, true), assetToken(PATH))
  })
})

describe('assetHref', () => {
  it('stays clean when no token is needed', () => {
    assert.equal(assetHref(PATH), `/api/assets/${PATH}`)
  })

  it('carries the token as ?k= when there is one', () => {
    const token = assetToken(PATH)
    assert.equal(assetHref(PATH, token), `/api/assets/${PATH}?k=${token}`)
  })

  it('still encodes each segment separately', () => {
    // Whole-path encoding would turn the slashes into %2F and the catch-all
    // route would see one segment.
    assert.equal(assetHref('a b/c d.png'), '/api/assets/a%20b/c%20d.png')
  })
})
