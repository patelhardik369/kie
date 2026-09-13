import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  isImageContentType,
  isPrivateAddress,
  looksLikeAddress,
  parseSourceUrl,
} from './source-guard.ts'

describe('parsing a caller-supplied source URL', () => {
  it('accepts an ordinary https image URL', () => {
    const parsed = parseSourceUrl('https://tempfile.aiquickdraw.com/s/abc.png')
    assert.ok(parsed instanceof URL)
  })

  it('refuses http, which would launder an unauthenticated fetch through our origin', () => {
    assert.equal(parseSourceUrl('http://example.com/a.png'), 'not-https')
  })

  it('refuses other schemes outright', () => {
    assert.equal(parseSourceUrl('file:///etc/passwd'), 'not-https')
    assert.equal(parseSourceUrl('data:image/png;base64,AAAA'), 'not-https')
  })

  it('refuses junk and nothing', () => {
    assert.equal(parseSourceUrl('not a url'), 'not-a-url')
    assert.equal(parseSourceUrl(null), 'not-a-url')
    assert.equal(parseSourceUrl(''), 'not-a-url')
  })

  it('refuses a literal private address without needing DNS', () => {
    assert.equal(parseSourceUrl('https://127.0.0.1/a.png'), 'private-host')
    assert.equal(parseSourceUrl('https://169.254.169.254/latest/meta-data/'), 'private-host')
    assert.equal(parseSourceUrl('https://[::1]/a.png'), 'private-host')
  })
})

describe('recognising an address literal', () => {
  it('spots v4 and v6 literals', () => {
    assert.ok(looksLikeAddress('10.0.0.1'))
    assert.ok(looksLikeAddress('[fe80::1]'))
  })

  it('leaves a hostname to DNS', () => {
    assert.ok(!looksLikeAddress('tempfile.aiquickdraw.com'))
  })
})

describe('private address classification', () => {
  it('blocks the cloud metadata endpoint', () => {
    // The single most valuable SSRF target on any cloud host.
    assert.ok(isPrivateAddress('169.254.169.254'))
  })

  it('blocks loopback, RFC1918 and CGNAT', () => {
    for (const ip of [
      '127.0.0.1',
      '127.1.2.3',
      '10.0.0.1',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '100.64.0.1',
      '0.0.0.0',
    ]) {
      assert.ok(isPrivateAddress(ip), ip)
    }
  })

  it('allows ordinary public addresses', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '104.18.0.1', '172.32.0.1', '192.169.0.1']) {
      assert.ok(!isPrivateAddress(ip), ip)
    }
  })

  it('blocks v4-mapped v6 forms, the usual way a blocklist is walked around', () => {
    assert.ok(isPrivateAddress('::ffff:127.0.0.1'))
    assert.ok(isPrivateAddress('::ffff:169.254.169.254'))
    assert.ok(isPrivateAddress('::ffff:10.0.0.1'))
  })

  it('allows a v4-mapped public address', () => {
    assert.ok(!isPrivateAddress('::ffff:8.8.8.8'))
  })

  it('blocks v6 loopback, unique-local, link-local and multicast', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1']) {
      assert.ok(isPrivateAddress(ip), ip)
    }
  })

  it('allows a public v6 address', () => {
    assert.ok(!isPrivateAddress('2606:4700:4700::1111'))
  })

  it('treats anything malformed as private, erring closed', () => {
    for (const ip of ['', '   ', '999.1.1.1', '1.2.3', '1.2.3.4.5', 'nonsense', '01.02.03.04.05']) {
      assert.ok(isPrivateAddress(ip), JSON.stringify(ip))
    }
  })
})

describe('content types the editor can draw', () => {
  it('accepts the raster formats', () => {
    assert.ok(isImageContentType('image/png'))
    assert.ok(isImageContentType('image/jpeg'))
    assert.ok(isImageContentType('image/webp; charset=binary'))
  })

  it('refuses SVG, which is a scriptable document and taints a canvas anyway', () => {
    assert.ok(!isImageContentType('image/svg+xml'))
  })

  it('refuses everything else, including a missing header', () => {
    assert.ok(!isImageContentType('text/html'))
    assert.ok(!isImageContentType('application/json'))
    assert.ok(!isImageContentType(null))
  })
})
