'use client'

/**
 * The browser's own credentials: a Kie API key and a workspace id.
 *
 * **This module is the only place either value is read or written.** That is not
 * tidiness — it is what makes "where does my key live and who can see it" a
 * question with one answer rather than fifteen call sites to audit.
 *
 * What is stored, and the honest security position:
 *
 *   - The key is in `localStorage`, in the clear. Encrypting it there would be
 *     theatre: the page would have to hold the decryption key to use it, so
 *     anything able to read the ciphertext could read that too. What
 *     `localStorage` genuinely gives is origin isolation — no other site can
 *     read it, and it is never sent anywhere except to this app's own API over
 *     HTTPS.
 *   - The real threat is a script running on this origin. The defence against
 *     that is not to load any, which is why this app has no third-party
 *     analytics, no tag manager and no CDN-hosted widgets.
 *   - The key is never put in a URL, never logged, and never rendered — Settings
 *     shows a masked preview built from the first and last few characters.
 *
 * The workspace id is written to BOTH `localStorage` and a cookie. Server
 * components render before any of our JavaScript runs and cannot read
 * `localStorage`, so the cookie is what lets the gallery come back filled in on
 * a first paint rather than empty-then-populated.
 */

const KEY_STORAGE = 'kie.apiKey'
const WORKSPACE_STORAGE = 'kie.workspace'
export const WORKSPACE_COOKIE = 'kie_ws'

/** Ten years. The cookie is an identity, not a session. */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 10

export interface Credentials {
  apiKey: string | null
  workspaceId: string
}

/**
 * Every read is guarded.
 *
 * `localStorage` throws rather than returning null in a surprising number of
 * real situations — Safari private browsing, a browser set to block site data,
 * an iframe with third-party storage partitioned off. An app that assumes it
 * works renders a blank page in all of them.
 */
function read(name: string): string | null {
  try {
    return window.localStorage.getItem(name)
  } catch {
    return null
  }
}

function write(name: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(name)
    else window.localStorage.setItem(name, value)
  } catch {
    // Storage is unavailable or full. The value stays in memory for this page,
    // which is enough to finish what the user is doing.
  }
}

// --------------------------------------------------------------- workspace

const WORKSPACE_PATTERN = /^wk_[0-9a-f]{32}$/

export function isWorkspaceId(value: unknown): value is string {
  return typeof value === 'string' && WORKSPACE_PATTERN.test(value)
}

function mintWorkspaceId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `wk_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]*)`),
  )
  return match ? decodeURIComponent(match[1]!) : null
}

function writeCookie(name: string, value: string): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  // Lax, not Strict: a link into the gallery from anywhere else must still
  // arrive with the workspace attached, or the page renders as a stranger's.
  document.cookie =
    `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`
}

/**
 * This browser's workspace id, minting and persisting one on first call.
 *
 * The cookie wins over `localStorage` when the two disagree, because the cookie
 * is what the server already used to render whatever is on screen. Trusting
 * `localStorage` instead would mean the page shows one workspace's rows while
 * every subsequent write goes to another's.
 */
export function getWorkspaceId(): string {
  const fromCookie = readCookie(WORKSPACE_COOKIE)
  if (isWorkspaceId(fromCookie)) {
    if (read(WORKSPACE_STORAGE) !== fromCookie) write(WORKSPACE_STORAGE, fromCookie)
    return fromCookie
  }

  const fromStorage = read(WORKSPACE_STORAGE)
  if (isWorkspaceId(fromStorage)) {
    // The cookie was cleared but the backup survived — restore it rather than
    // stranding a whole gallery behind an id nothing sends any more.
    writeCookie(WORKSPACE_COOKIE, fromStorage)
    return fromStorage
  }

  const minted = mintWorkspaceId()
  write(WORKSPACE_STORAGE, minted)
  writeCookie(WORKSPACE_COOKIE, minted)
  return minted
}

/**
 * Adopts an existing workspace id — the import half of Settings' export string.
 *
 * How you move a studio to another browser, and how you get one back after
 * clearing site data. Returns false on a malformed id rather than adopting
 * something no query will ever match.
 */
export function adoptWorkspaceId(value: string): boolean {
  const trimmed = value.trim()
  if (!isWorkspaceId(trimmed)) return false
  write(WORKSPACE_STORAGE, trimmed)
  writeCookie(WORKSPACE_COOKIE, trimmed)
  return true
}

// ------------------------------------------------------------------- key

/**
 * Kie keys are opaque, so this checks only what can be checked: that the value
 * is a plausible credential rather than a pasted URL or a stray fragment.
 * Rejecting early turns "the generation failed with 401 twenty seconds in" into
 * "that does not look like a key".
 */
export function looksLikeKieKey(value: string): boolean {
  const bare = value.trim()
  return bare.length >= 16 && bare.length <= 512 && /^[\x21-\x7e]+$/.test(bare)
}

export function getApiKey(): string | null {
  const value = read(KEY_STORAGE)
  return value && looksLikeKieKey(value) ? value : null
}

/** Stores a key, or clears it when passed null. Strips a pasted `Bearer `. */
export function setApiKey(value: string | null): boolean {
  if (value === null) {
    write(KEY_STORAGE, null)
    return true
  }
  const bare = value.trim().replace(/^Bearer\s+/i, '').trim()
  if (!looksLikeKieKey(bare)) return false
  write(KEY_STORAGE, bare)
  return true
}

export function hasApiKey(): boolean {
  return getApiKey() !== null
}

/**
 * A key as it is safe to show on screen.
 *
 * Enough characters to recognise which key it is, never enough to use it.
 */
export function maskKey(key: string): string {
  if (key.length <= 12) return '•'.repeat(key.length)
  return `${key.slice(0, 6)}${'•'.repeat(12)}${key.slice(-4)}`
}

/** Everything this browser holds, for the header and the settings page. */
export function getCredentials(): Credentials {
  return { apiKey: getApiKey(), workspaceId: getWorkspaceId() }
}
