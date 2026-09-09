'use client'

import { getApiKey, getWorkspaceId } from './credentials.ts'

/**
 * The one way the browser talks to this app's API.
 *
 * Everything that reaches `/api/**` goes through here so the two headers that
 * identify the caller — the Kie key and the workspace — are attached in exactly
 * one place. A component that called bare `fetch` would work for reads (the
 * workspace cookie rides along on its own) and then fail on the first write that
 * needs a key, which is the kind of bug that only shows up in the one flow
 * nobody clicked before shipping.
 */

export class ApiError extends Error {
  readonly status: number
  readonly detail?: string
  /** Field-level problems from the validator, when the route reported them. */
  readonly issues?: unknown[]

  constructor(status: number, message: string, detail?: string, issues?: unknown[]) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
    this.issues = issues
  }

  /** True when the fix is "add or correct your API key", not "try again". */
  get isCredentialProblem(): boolean {
    return this.status === 401 || this.status === 402
  }
}

export interface StudioFetchOptions extends Omit<RequestInit, 'body'> {
  /** Serialized as JSON unless it is already a FormData or a string. */
  body?: unknown
}

/**
 * Performs one API call and returns the parsed body.
 *
 * Throws `ApiError` for any non-2xx, with the route's own message where there is
 * one. Routes in this app answer errors as `{ error, detail?, issues? }`, and
 * surfacing that shape unchanged is what lets a form show "seedream/5-pro
 * rejects width above 4096" instead of "Request failed".
 */
export async function studioFetch<T = unknown>(
  path: string,
  options: StudioFetchOptions = {},
): Promise<T> {
  const { body, headers, ...rest } = options

  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const merged = new Headers(headers)

  if (!merged.has('x-studio-workspace')) {
    merged.set('x-studio-workspace', getWorkspaceId())
  }

  // A caller-supplied key wins. That is what lets the settings form test the key
  // currently in the input box rather than the one already saved — without it,
  // "Test & save" would always validate the old key.
  if (!merged.has('x-kie-key')) {
    const apiKey = getApiKey()
    // Omitted rather than sent empty when absent: a deployment with a
    // server-side KIE_API_KEY should fall back to it, and an empty header would
    // read as a caller insisting on a key that cannot work.
    if (apiKey) merged.set('x-kie-key', apiKey)
  }

  if (body !== undefined && !isForm && typeof body !== 'string') {
    merged.set('content-type', 'application/json')
  }

  const response = await fetch(path, {
    ...rest,
    headers: merged,
    body:
      body === undefined
        ? undefined
        : isForm || typeof body === 'string'
          ? (body as BodyInit)
          : JSON.stringify(body),
  })

  const text = await response.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      // A non-JSON body from our own API means something upstream of the route
      // answered — a platform error page, usually. Keep the text for the message.
      parsed = { error: text.slice(0, 300) }
    }
  }

  if (!response.ok) {
    const payload = (parsed ?? {}) as {
      error?: string
      detail?: string
      issues?: unknown[]
    }
    throw new ApiError(
      response.status,
      payload.error ?? `${response.status} ${response.statusText}`,
      payload.detail,
      payload.issues,
    )
  }

  return parsed as T
}

/** True when the error is one the user fixes by entering a key in Settings. */
export function isCredentialProblem(error: unknown): boolean {
  return error instanceof ApiError && error.isCredentialProblem
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail ? `${error.message} — ${error.detail}` : error.message
  }
  return error instanceof Error ? error.message : String(error)
}
