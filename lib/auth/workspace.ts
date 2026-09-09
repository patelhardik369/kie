import 'server-only'

import crypto from 'node:crypto'
import { cookies } from 'next/headers'

/**
 * Workspaces: who owns a row, without accounts.
 *
 * The studio used to be one person on one machine, so ownership was implicit —
 * every row in the database was yours because the database was on your laptop.
 * On a public URL that assumption becomes "everyone who finds the link shares
 * one gallery", which is not a studio, it is a lobby.
 *
 * A workspace id is 128 bits of randomness the BROWSER generates. Every row
 * carries it; every query filters on it. There is no signup, no password and no
 * email, and the server never issues one — it only ever recognises the shape.
 *
 * **It lives in two places, and the duplication is deliberate.** A cookie,
 * because server components render before any JavaScript of ours runs and
 * `localStorage` is not readable from them — without the cookie the gallery
 * would have to become a client component that renders empty and then fills in.
 * And `localStorage`, because that is what survives as the exportable copy the
 * Settings page can show you and let you paste into another browser. The client
 * writes both and treats the cookie as canonical.
 *
 * Be clear about what this is and is not:
 *
 *   - It is a **bearer secret**, exactly like the Kie key sitting next to it.
 *     Whoever holds the string is the workspace. That is the whole security
 *     model, and it is the same trust level the API key already has.
 *   - It is **not** authentication. It does not survive clearing site data on
 *     its own, which is why Settings can export it and import it elsewhere.
 *   - It **partitions**; it does not protect against someone with database
 *     access. If that matters, the answer is Supabase Auth and RLS, not a
 *     longer random string.
 */

/** `wk_` + 32 lowercase hex characters (128 bits). */
const WORKSPACE_PATTERN = /^wk_[0-9a-f]{32}$/

export const WORKSPACE_HEADER = 'x-studio-workspace'
export const WORKSPACE_COOKIE = 'kie_ws'

/** Mints a new workspace id. Used by the export/reset flow and by tests. */
export function newWorkspaceId(): string {
  return `wk_${crypto.randomBytes(16).toString('hex')}`
}

/**
 * Validates the shape of a workspace id.
 *
 * Shape only — there is nothing to check it against, since ids are minted by
 * browsers and never registered anywhere first. The check exists so a malformed
 * or hostile value cannot reach a query, and so a typo produces a clear error
 * rather than a silently empty gallery.
 */
export function isWorkspaceId(value: unknown): value is string {
  return typeof value === 'string' && WORKSPACE_PATTERN.test(value)
}

export class MissingWorkspaceError extends Error {
  readonly status = 400
  constructor() {
    super(
      'This request carried no workspace. Every browser generates one on first ' +
        'load and sends it as X-Studio-Workspace (and as the kie_ws cookie) — if ' +
        'you are calling the API directly, send a `wk_` id of your own.',
    )
    this.name = 'MissingWorkspaceError'
  }
}

/**
 * The workspace this request belongs to.
 *
 * Header first, cookie second. The header is what our own `fetch` calls send and
 * is the more explicit signal; the cookie covers a plain navigation and anything
 * the browser issues without our code in the loop.
 *
 * Throws rather than defaulting. A default would silently pool every caller who
 * sent neither into one shared gallery — precisely the failure this mechanism
 * exists to prevent, and it would do it invisibly.
 */
export function requireWorkspace(request: Request): string {
  const workspace = optionalWorkspace(request)
  if (!workspace) throw new MissingWorkspaceError()
  return workspace
}

/** The workspace if one was sent and well-formed, otherwise undefined. */
export function optionalWorkspace(request: Request): string | undefined {
  const header = request.headers.get(WORKSPACE_HEADER)
  if (isWorkspaceId(header)) return header

  const fromCookie = readCookie(request.headers.get('cookie'), WORKSPACE_COOKIE)
  return isWorkspaceId(fromCookie) ? fromCookie : undefined
}

/**
 * The workspace for a server component, read from the cookie jar.
 *
 * Returns undefined on a first visit, before the client has written one. Pages
 * treat that as "empty studio" and render the setup prompt rather than failing —
 * a brand-new visitor has no rows, which is the same thing an empty workspace
 * looks like.
 */
export async function currentWorkspace(): Promise<string | undefined> {
  const jar = await cookies()
  const value = jar.get(WORKSPACE_COOKIE)?.value
  return isWorkspaceId(value) ? value : undefined
}

/** Parses one cookie out of a raw `Cookie` header. */
function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() !== name) continue
    return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}
