import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

// A fixed 32-byte key, so the tokens below are deterministic across runs.
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key'
process.env.CRON_SECRET = 'cron-secret-test'
delete process.env.KIE_PUBLIC_URL
delete process.env.KIE_WEBHOOK_HMAC_KEY

const { assetToken, assetTokenMatches, assetUrl } = await import('./asset-token.ts')
const { assetHref } = await import('./display.ts')

const KEY = 'wk_0123456789abcdef0123456789abcdef/2026-09-02/wan/wan-2-7-image/abc-0.png'

/**
 * The lock on `/api/assets`.
 *
 * An object key is guessable — a workspace id, a date, a family, a model slug
 * and a generation id — and the route it feeds cannot read a workspace header,
 * because `<img src>` and `<video src>` do not send one. So the token in the URL
 * is the entire authorisation, and every asset carries one.
 */
describe('asset capability tokens', () => {
  it('is stable for a key, so a link does not rot between renders', () => {
    // An expiring token would break a video mid-scrub and a tab left open
    // overnight, for no gain against the thing this defends: a pasted key.
    assert.equal(assetToken(KEY), assetToken(KEY))
  })

  it('is bound to the key it was minted for', () => {
    const other = KEY.replace('abc-0.png', 'abc-1.png')
    assert.notEqual(assetToken(KEY), assetToken(other))
    // The token for sibling output #1 must not unlock output #0.
    assert.equal(assetTokenMatches(KEY, assetToken(other)), false)
  })

  /**
   * The isolation property, stated as a test: one workspace's token must not
   * open another workspace's object, even for an otherwise identical path.
   */
  it('does not carry across workspaces', () => {
    const theirs = KEY.replace('wk_0123456789abcdef0123456789abcdef', 'wk_ffffffffffffffffffffffffffffffff')
    assert.equal(assetTokenMatches(theirs, assetToken(KEY)), false)
  })

  it('rejects a missing, empty, wrong or truncated token', () => {
    const good = assetToken(KEY)

    assert.equal(assetTokenMatches(KEY, undefined), false)
    assert.equal(assetTokenMatches(KEY, null), false)
    assert.equal(assetTokenMatches(KEY, ''), false)
    assert.equal(assetTokenMatches(KEY, 'not-a-token'), false)
    // A length mismatch must be a rejection, not the throw timingSafeEqual
    // raises when the buffers differ in size.
    assert.equal(assetTokenMatches(KEY, good.slice(0, -1)), false)
    assert.equal(assetTokenMatches(KEY, good + 'x'), false)

    assert.equal(assetTokenMatches(KEY, good), true)
  })

  it('is long enough that guessing is not a strategy', () => {
    // 128 bits, base64url.
    assert.ok(assetToken(KEY).length >= 21, assetToken(KEY))
    assert.match(assetToken(KEY), /^[A-Za-z0-9_-]+$/)
  })

  it('never leaks the key it is derived from', () => {
    const secret = process.env.APP_ENCRYPTION_KEY!
    assert.equal(assetToken(KEY).includes(secret), false)
  })
})

describe('assetUrl', () => {
  it('always carries a token — every object needs one now', () => {
    assert.equal(assetUrl(KEY), `/api/assets/${KEY}?k=${assetToken(KEY)}`)
  })

  it('is null for an output that was never stored', () => {
    // `storage_path` is null when a file was past the plan's per-object ceiling.
    // A URL for it would 404; null lets the caller render the honest explanation.
    assert.equal(assetUrl(null), null)
    assert.equal(assetUrl(undefined), null)
  })
})

describe('assetHref', () => {
  it('carries the token as ?k= when there is one', () => {
    const token = assetToken(KEY)
    assert.equal(assetHref(KEY, token), `/api/assets/${KEY}?k=${token}`)
  })

  it('still encodes each segment separately', () => {
    // Whole-key encoding would turn the slashes into %2F and the catch-all
    // route would see one segment.
    assert.equal(assetHref('a b/c d.png'), '/api/assets/a%20b/c%20d.png')
  })
})
