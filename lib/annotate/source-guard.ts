/**
 * What `/api/annotate/source` is allowed to fetch.
 *
 * Pure module — no DNS, no network — so the address classification is unit
 * tested rather than reasoned about. The route does the lookups and calls in
 * here for every verdict.
 *
 * ## Why this route exists at all
 *
 * The markup editor has to call `canvas.toDataURL()`, and that throws on a
 * canvas any cross-origin image has touched. The source is either a Kie
 * `downloadUrl` on a host we do not control, or a Supabase signed URL reached
 * through the 302 in `app/api/assets/[...path]/route.ts` — either taints. Moving
 * the bytes through our own origin is the only reliable fix, and it is a fix
 * that does not depend on a third party's CORS configuration staying put.
 *
 * ## Why it needs a guard
 *
 * The route takes a URL from the browser and fetches it server-side, which is
 * the definition of SSRF. The overwhelmingly common case never gets here — a URL
 * that matches one of this workspace's own rows is served from our bucket. The
 * outbound path exists only for a URL someone pasted by hand, and it is narrow
 * on purpose: https only, public addresses only, image content types only,
 * bounded size, bounded redirects.
 */

/** Images only, and a hand-pasted one should be well under this. */
export const MAX_SOURCE_BYTES = 32 * 1024 * 1024

/** A redirect chain longer than this is not a real image host. */
export const MAX_REDIRECTS = 3

export type SourceRejection =
  | 'not-a-url'
  | 'not-https'
  | 'private-host'
  | 'not-an-image'
  | 'too-large'

export const REJECTION_MESSAGES: Record<SourceRejection, string> = {
  'not-a-url': 'That is not a URL this editor can open.',
  'not-https': 'Only https URLs can be opened for markup.',
  'private-host': 'That URL points inside a private network, so it will not be fetched.',
  'not-an-image': 'That URL did not return an image.',
  'too-large': `That image is larger than the ${MAX_SOURCE_BYTES / (1024 * 1024)} MB the editor will load.`,
}

/**
 * Parses a caller-supplied URL, or returns why it was refused.
 *
 * https only. A plain-http source would be fetched by the server and handed back
 * over our own https origin, which quietly launders an unauthenticated fetch
 * into something the browser treats as trusted.
 */
export function parseSourceUrl(raw: string | null): URL | SourceRejection {
  if (!raw) return 'not-a-url'
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'not-a-url'
  }
  if (url.protocol !== 'https:') return 'not-https'
  // A literal private address needs no DNS round trip to refuse.
  if (looksLikeAddress(url.hostname) && isPrivateAddress(stripBrackets(url.hostname))) {
    return 'private-host'
  }
  return url
}

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

/** Whether a hostname is already an IP literal rather than a name to resolve. */
export function looksLikeAddress(host: string): boolean {
  const bare = stripBrackets(host)
  return /^[0-9.]+$/.test(bare) || bare.includes(':')
}

/**
 * Whether an address is one the server must not be talked into reaching.
 *
 * Covers the ranges that actually matter on a cloud host: loopback, RFC1918,
 * link-local (169.254.169.254 is the cloud metadata endpoint and the single
 * most valuable SSRF target there is), carrier-grade NAT, and the IPv6
 * equivalents including v4-mapped forms, which are the usual way a blocklist
 * gets bypassed.
 */
export function isPrivateAddress(address: string): boolean {
  const ip = address.trim().toLowerCase()
  if (ip.length === 0) return true

  if (ip.includes(':')) return isPrivateV6(ip)
  return isPrivateV4(ip)
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length !== 4) return true
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return NaN
    return Number(part)
  })
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true

  const [a, b] = octets as [number, number, number, number]
  if (a === 0) return true // "this network"
  if (a === 10) return true // RFC1918
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // RFC1918
  if (a === 192 && b === 168) return true // RFC1918
  if (a === 192 && b === 0) return true // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a >= 224) return true // multicast and reserved
  return false
}

function isPrivateV6(ip: string): boolean {
  const bare = stripBrackets(ip).split('%')[0]!
  if (bare === '::' || bare === '::1') return true

  // v4-mapped and v4-compatible forms — ::ffff:10.0.0.1 and friends. Classified
  // by their embedded v4 address, which is the whole point of the notation and
  // the usual way a naive blocklist is walked around.
  const embedded = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(bare)
  if (embedded) return isPrivateV4(embedded[1]!)

  const head = bare.split(':')[0] ?? ''
  if (head.length === 0) return true // any other :: form
  const leading = Number.parseInt(head.padEnd(4, '0').slice(0, 4), 16)
  if (!Number.isFinite(leading)) return true
  if ((leading & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((leading & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((leading & 0xff00) === 0xff00) return true // ff00::/8 multicast
  return false
}

/** Whether a response's content type is an image we can draw on a canvas. */
export function isImageContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const type = contentType.split(';')[0]!.trim().toLowerCase()
  // SVG is excluded deliberately: it is a document that can carry script and
  // remote references, and drawing one into a canvas taints it anyway.
  if (type === 'image/svg+xml') return false
  return type.startsWith('image/')
}
